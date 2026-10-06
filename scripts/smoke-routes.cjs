#!/usr/bin/env node
// 同一实例多路由冒烟测试（2026-10-05 生产事故后新增的验收维度）。
//
// 背景：同 isolate 内多路由连打才能暴露跨路由的运行时冲突。历史事故一（Pages 时代）：
// next-on-pages 的共享 chunk 重复执行 Object.defineProperty("__import_unsupported")，
// 守卫缺失时第二个及以后加载的路由 500。历史事故二：路由表丢根映射时 `GET /` 返回
// 200 + text/plain "Not Found"。批次 9 迁 OpenNext Workers 后两项断言保留——
// 多路由冲突的构造性测试与"状态码对但内容错"的检测在任何架构下都成立。
//
// 用法：node scripts/smoke-routes.cjs <baseUrl> [--rounds=3]
//   本地：node scripts/smoke-routes.cjs http://127.0.0.1:8787
//   线上：node scripts/smoke-routes.cjs https://warm-journey.hl7235659.workers.dev
// workers.dev 在国内直连被墙：HTTPS_PROXY=http://127.0.0.1:7897 node scripts/smoke-routes.cjs ...
// （脚本检测到 HTTPS_PROXY 时自动走代理）
//
// 判定：
//   - 任意 500，或响应体含 __import_unsupported / Cannot redefine → FAIL
//   - GET 公开路由必须 200；confirm 无 token 必须 4xx（200 = 还在跑修复前代码）
//   - 标记为 html 的路由还必须真的返回 HTML（防"状态码对但内容错"）。

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base || !/^https?:\/\//.test(base)) {
  console.error('用法: node scripts/smoke-routes.cjs <baseUrl> [--rounds=3]');
  process.exit(2);
}
let rounds = 3;
for (let k = 2; k < process.argv.length; k++) {
  const a = process.argv[k];
  if (a.startsWith('--rounds=')) rounds = Number.parseInt(a.slice(9), 10) || rounds;
  else if (a === '--rounds') rounds = Number.parseInt(process.argv[++k], 10) || rounds;
}

// 国内直连 workers.dev 被墙：有 HTTPS_PROXY 时让 node fetch 走代理。
// 根级没有直接依赖 undici，用 wrangler 带的那份（版本随 wrangler 走，API 稳定）。
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const undiciPath = require('path').join(__dirname, '..', 'node_modules', 'wrangler', 'node_modules', 'undici');
  const { EnvHttpProxyAgent, setGlobalDispatcher } = require(undiciPath);
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const GET_ROUTES = [
  ['/', [200], 'html'],
  ['/api/points', [200]],
  ['/api/cities', [200]],
  ['/api/visits/demo000visit01', [200]],
  ['/api/ai/context?lat=23.04&lng=113.40', [200]],
];
// POST 路由：不带凭证，预期 4xx（证明新校验代码在跑且路由可执行，而非 500）
const POST_ROUTES = [
  ['/api/visits/active', [400, 401, 403, 404, 405, 422]],
  ['/api/points/point001/confirm', [400, 401, 403, 422, 429]],
];

let total = 0;
let failed = 0;

async function hit(method, path, accept, expect) {
  total++;
  const tag = `${method.padEnd(4)} ${path}`;
  try {
    const res = await fetch(base + path, { method });
    const body = await res.text();
    const redefine = /__import_unsupported|Cannot redefine property/i.test(body);
    const htmlBad = expect === 'html' && (
      !(res.headers.get('content-type') || '').includes('text/html') || body.trim() === 'Not Found'
    );
    if (redefine) {
      failed++;
      console.log(`  ${tag} → ${res.status} ✗ 响应含 __import_unsupported 错误签名`);
    } else if (res.status === 500) {
      failed++;
      console.log(`  ${tag} → 500 ✗ ${body.replace(/\s+/g, ' ').slice(0, 110)}`);
    } else if (htmlBad) {
      failed++;
      console.log(`  ${tag} → ${res.status} ✗ 未返回真实 HTML（content-type=${res.headers.get('content-type')}，` +
        `路由表可能缺该路径的映射）`);
    } else if (!accept.includes(res.status)) {
      failed++;
      const hint = path.includes('confirm') && res.status === 200
        ? '（200 = 修复前代码，rider_token 校验未生效）' : `（预期 ${accept.join('/')}）`;
      console.log(`  ${tag} → ${res.status} ✗ ${hint}`);
    } else {
      console.log(`  ${tag} → ${res.status} ✓`);
    }
  } catch (e) {
    failed++;
    console.log(`  ${tag} → 网络错误 ✗ ${e.message}`);
  }
}

(async () => {
  console.log(`目标：${base}`);
  console.log(`${rounds} 轮 × ${GET_ROUTES.length + POST_ROUTES.length} 请求，同一实例顺序连打\n`);
  for (let r = 1; r <= rounds; r++) {
    console.log(`—— 第 ${r}/${rounds} 轮 ——`);
    for (const [p, acc, expect] of GET_ROUTES) await hit('GET', p, acc, expect);
    for (const [p, acc] of POST_ROUTES) await hit('POST', p, acc);
  }
  console.log(`\n结果：${total - failed}/${total} 通过，${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})();
