#!/usr/bin/env node
// 同一实例多路由冒烟测试（2026-10-05 生产事故后新增的验收维度）。
//
// 背景：Cloudflare Pages 把所有函数跑在同一个 worker/isolate。next-on-pages 的
// 共享 webpack chunk 会重复执行 Object.defineProperty("__import_unsupported")，
// 若守卫缺失，第二个及以后加载的路由会抛 "Cannot redefine property" → 500。
// 逐路由单独冷启动的测试从构造上发现不了该问题——必须同一 server 实例内
// 连打多个不同路由。本脚本就是干这个的。
//
// 用法：node scripts/smoke-routes.cjs <baseUrl> [--rounds=3]
//   本地：node scripts/smoke-routes.cjs http://127.0.0.1:8899
//   线上：node scripts/smoke-routes.cjs https://warm-journey.pages.dev
//
// 判定：
//   - 任意 500，或响应体含 __import_unsupported / Cannot redefine → FAIL
//   - GET 公开路由必须 200；confirm 无 token 必须 4xx（200 = 还在跑修复前代码）
//   - 标记为 html 的路由还必须真的返回 HTML：next-on-pages 1.13.10 丢根路由映射时，
//     `GET /` 是 HTTP 200 + text/plain "Not Found"，只看状态码会漏掉整站首页。

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
