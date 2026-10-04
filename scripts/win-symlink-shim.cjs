// Windows workaround for `vercel build`:
// The Vercel Next.js builder dedupes .func directories with fs.symlink(),
// which fails with EPERM unless Developer Mode is on or the shell is elevated.
// A directory *junction* (mklink /J) needs no privileges.
// Load this before vercel: NODE_OPTIONS="--require <this file>"
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'win32') return;

const LOG = process.env.WJ_SYMLINK_LOG || path.join(process.cwd(), '.vercel', 'symlink-shim.log');
function log(line) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch {}
}
log(`shim loaded (pid ${process.pid})`);

function isDirSync(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function makeJunction(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  let existing = null;
  try { existing = fs.lstatSync(linkPath); } catch {}
  if (existing) {
    if (!existing.isSymbolicLink()) {
      // Never clobber a real directory — that would destroy build output.
      throw new Error(`refusing to replace non-symlink path: ${linkPath}`);
    }
    fs.rmSync(linkPath, { recursive: true, force: true });
  }
  execFileSync('cmd.exe', ['/c', 'mklink', '/J', linkPath, target], { stdio: 'pipe' });
}

function resolveTarget(target, linkPath) {
  return path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target);
}

function fallback(err, target, linkPath) {
  if (!(err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'UNKNOWN' || err.code === 'EEXIST')) {
    log(`passthrough ${err.code} ${target} -> ${linkPath}`);
    return false;
  }
  const resolved = resolveTarget(target, linkPath);
  if (!isDirSync(resolved)) {
    log(`skip (target not a dir) ${err.code} ${target} -> ${linkPath}`);
    return false;
  }
  makeJunction(resolved, linkPath);
  log(`junction ${linkPath} -> ${resolved}`);
  return true;
}

const origSymlinkSync = fs.symlinkSync;
fs.symlinkSync = function (target, linkPath, type) {
  try {
    return origSymlinkSync.call(fs, target, linkPath, type);
  } catch (e) {
    if (fallback(e, target, linkPath)) return;
    throw e;
  }
};

const origSymlink = fs.symlink;
fs.symlink = function (target, linkPath, type, cb) {
  if (typeof type === 'function') { cb = type; type = undefined; }
  origSymlink.call(fs, target, linkPath, type, (err) => {
    if (err && fallback(err, target, linkPath)) return cb(null);
    cb(err);
  });
};

const origPromiseSymlink = fs.promises.symlink;
fs.promises.symlink = async function (target, linkPath, type) {
  try {
    return await origPromiseSymlink.call(fs.promises, target, linkPath, type);
  } catch (e) {
    if (fallback(e, target, linkPath)) return;
    throw e;
  }
};
