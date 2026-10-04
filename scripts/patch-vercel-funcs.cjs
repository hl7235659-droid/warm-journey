// Windows-only workaround: vercel build deduplicates .func dirs via symlinks,
// but Windows requires Developer Mode for fs.symlink(). Use mklink /J (junctions)
// instead — they work without elevated rights or Developer Mode.
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const base = 'C:\\Users\\tebbit\\.claude\\warm-journey\\.vercel\\output\\functions';

// Scan for all .func directories and create junctions to the first one found
function scanAndLink() {
  if (!fs.existsSync(base)) {
    console.log('✗ functions directory does not exist yet');
    return;
  }

  const allFuncs = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.endsWith('.func')) {
          allFuncs.push(full);
        } else {
          walk(full);
        }
      }
    }
  }
  walk(base);

  if (allFuncs.length === 0) {
    console.log('✗ no .func directories found');
    return;
  }

  // Use the first .func as the canonical target
  const canonical = allFuncs[0];
  console.log(`Using ${path.basename(canonical)} as canonical target\n`);

  // For each symlink that vercel tried to create, replace it with a junction
  for (const funcDir of allFuncs.slice(1)) {
    if (fs.lstatSync(funcDir).isSymbolicLink()) {
      // Remove the broken symlink
      fs.rmSync(funcDir, { force: true });
      try {
        execSync(`mklink /J "${funcDir}" "${canonical}"`, { shell: 'cmd.exe', stdio: 'pipe' });
        console.log('✓ junction:', path.relative(base, funcDir));
      } catch (e) {
        console.error('✗ failed:', path.relative(base, funcDir), e.message);
      }
    }
  }

  console.log('\nDone.');
}

scanAndLink();
