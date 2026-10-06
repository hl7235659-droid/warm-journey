// 4-5 · AI 降级契约（质量清单 P0-5 的最小版）
// 三类失败输入（无 Key / 上游非 2xx / 网络异常·超时）都必须落回本地回答并且：
//   ① 响应仍是 ok:true 的 ChatResponse（前端不弹平台错误）
//   ② mode 如实标 'local'
//   ③ 不透传上游原文、不回显用户 Key
// 出站 fetch 用 stubGlobal 顶掉，全程不上真实网络。
import { env } from 'cloudflare:test';
import { POST as chatPost } from '@/app/api/ai/chat/route';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  adminToken, applySchema, installCloudflareContext, rawToken, seedAdmin, seedPoint,
} from './_helpers';

const API_KEY = 'sk-THIS-SHOULD-NEVER-COME-BACK';
const PROVIDER = { baseUrl: 'https://api.deepseek.com/v1', apiKey: API_KEY, model: 'deepseek-chat' };

type ChatBody = { ok: boolean; mode?: string; text?: string; action?: { type: string; params: Record<string, string> }; error?: string };

async function chat(payload: unknown): Promise<{ status: number; body: ChatBody }> {
  const res = await chatPost(new Request('http://warm-journey.test/api/ai/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }));
  return { status: res.status, body: await res.json() as ChatBody };
}

const ask = (content: string, over: Record<string, unknown> = {}) => ({
  messages: [{ role: 'user', content }], ...over,
});

// 记录被调用次数与最后一次请求，用于断言"根本没出门"
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  });
  return calls;
}

const jsonReply = (content: string) => new Response(
  JSON.stringify({ choices: [{ message: { content } }] }),
  { headers: { 'content-type': 'application/json' } },
);

beforeAll(async () => {
  installCloudflareContext();
  await applySchema();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('三类失败输入 → 本地降级', () => {
  it('无 Key 且服务端未配兜底提供商：mode=local，文案给配置指引', async () => {
    const calls = stubFetch(() => { throw new Error('不该发网络请求'); });
    const { status, body } = await chat(ask('附近哪有能歇脚的地方'));
    expect(status).toBe(200);
    expect(calls.length).toBe(0);
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('local');
    expect(body.text).toContain('离线模式');
    expect(body.text).toContain('Key');
  });

  it('上游 429：不透传上游原文，如实告知已切本地回答，且不回显 Key', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { message: 'UPSTREAM_LEAK_ME' } }), { status: 429 }));
    const { status, body } = await chat(ask('今天天气怎么样', { provider: PROVIDER }));
    expect(status).toBe(200);
    expect(body.mode).toBe('local');
    expect(body.text).toContain('联网模型调用失败：模型接口暂时不可用');
    expect(body.text).not.toContain('UPSTREAM_LEAK_ME');
    expect(JSON.stringify(body)).not.toContain(API_KEY);
  });

  it('网络异常 / 超时（AbortSignal 触发）：同样降级，不抛平台 500', async () => {
    stubFetch(() => { throw new DOMException('The operation timed out', 'TimeoutError'); });
    const { status, body } = await chat(ask('帮我推荐一个有热水的驿站', { provider: PROVIDER }));
    expect(status).toBe(200);
    expect(body.mode).toBe('local');
    expect(body.text).toContain('网络异常，暂时无法联网回答');
  });

  it('上游 200 但 choices 为空：按"返回异常"降级', async () => {
    stubFetch(() => new Response(JSON.stringify({ choices: [] }), {
      headers: { 'content-type': 'application/json' },
    }));
    const { body } = await chat(ask('小暖你知道我在哪吗', { provider: PROVIDER }));
    expect(body.mode).toBe('local');
    expect(body.text).toContain('模型接口返回异常');
  });

  it('降级回答仍带结构：附近意图 + 有定位 → navigate action 指向最近点位', async () => {
    stubFetch(() => { throw new Error('offline'); });
    const point = await seedPoint({ id: 'point0000nb01' });
    const { body } = await chat(ask('附近有没有能充电的地方', {
      context: {
        now: '周三 15:00',
        nearby: [{
          id: point, name: '测试驿站', dist: '300m', inStore: 2,
          openHours: '08:00-20:00', services: ['充电'], crowdHint: '暂无历史规律',
        }],
      },
    }));
    expect(body.mode).toBe('local');
    expect(body.text).toContain('测试驿站');
    expect(body.action).toEqual({ type: 'navigate', params: { pointId: point } });
  });

  it('窄请求（context 传空对象）不得炸成 500', async () => {
    stubFetch(() => { throw new Error('offline'); });
    const { status, body } = await chat(ask('现在几点了', { context: {} }));
    expect(status).toBe(200);
    expect(body.mode).toBe('local');
  });
});

describe('正常远端链路与 action 校验', () => {
  it('正常回复：mode=remote，围栏 action 被剥离并结构化', async () => {
    const point = await seedPoint({ id: 'point0000act1' });
    stubFetch(() => jsonReply(
      `为你找到 ${point}\n\`\`\`json\n{"action":{"type":"navigate","params":{"pointId":"${point}"}}}\n\`\`\``,
    ));
    const { status, body } = await chat(ask('带我去天河驿站', { provider: PROVIDER }));
    expect(status).toBe(200);
    expect(body.mode).toBe('remote');
    expect(body.text).toBe(`为你找到 ${point}`);
    expect(body.action?.type).toBe('navigate');
    expect(body.action?.params.pointId).toBe(point);
  });

  it('转发地址与鉴权头：走 /chat/completions，Key 只出门不上响应', async () => {
    const calls = stubFetch(() => jsonReply('好的'));
    await chat(ask('你好', { provider: PROVIDER }));
    expect(calls[0]?.url).toBe('https://api.deepseek.com/v1/chat/completions');
    const headers = new Headers(calls[0]?.init?.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
  });

  it('action 指向不存在的点位：整个 action 丢弃，正文照常返回', async () => {
    stubFetch(() => jsonReply(
      '请看```json\n{"action":{"type":"navigate","params":{"pointId":"nosuchpoint99"}}}\n```',
    ));
    const { body } = await chat(ask('去那个不存在的驿站', { provider: PROVIDER }));
    expect(body.mode).toBe('remote');
    expect(body.action).toBeUndefined();
    expect(body.text).toContain('请看');
  });

  it('provider 地址不在受信任域白名单 → 422，且不发网络请求（SSRF 面关闭）', async () => {
    const calls = stubFetch(() => jsonReply('不该被调用'));
    const { status, body } = await chat(ask(
      '你好', { provider: { baseUrl: 'https://evil.example.com/v1', apiKey: 'k', model: 'm' } },
    ));
    expect(status).toBe(422);
    expect(body.ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});

// 批次 9 从 Pages 迁 Workers 时 AI_BASE_URL / AI_API_KEY / AI_MODEL 三件套没跟过来，
// 线上"小暖"静默退化成离线模式却无人报错（wrangler.toml 里已记这条账）。
describe('服务端兜底提供商（AI_* 三件套）', () => {
  const withEnv = (extra: Record<string, string>) => {
    const key = Symbol.for('__cloudflare-context__');
    const scope = globalThis as Record<symbol, unknown>;
    const saved = scope[key];
    scope[key] = {
      env: { DB: env.DB, JWT_SECRET: env.JWT_SECRET, ...extra },
      ctx: { waitUntil: () => {}, passThroughOnException: () => {} },
    };
    return () => { scope[key] = saved; };
  };

  it('三件套齐全：请求不带 provider 也走服务端 Key 转发，且模型名不进响应体', async () => {
    const calls = stubFetch(() => jsonReply('服务端兜底回答'));
    const restore = withEnv({
      AI_BASE_URL: 'https://api.deepseek.com/v1',
      AI_API_KEY: 'server-side-secret-key',
      AI_MODEL: 'deepseek-chat',
    });
    try {
      const { status, body } = await chat(ask('在吗'));
      expect(status).toBe(200);
      expect(body.mode).toBe('remote');
      expect(body.text).toBe('服务端兜底回答');
      expect(calls[0]?.url).toBe('https://api.deepseek.com/v1/chat/completions');
      const headers = new Headers(calls[0]?.init?.headers as HeadersInit);
      expect(headers.get('authorization')).toBe('Bearer server-side-secret-key');
      expect(JSON.stringify(body)).not.toContain('deepseek-chat');
    } finally {
      restore();
    }
  });

  it('缺 AI_API_KEY：即使 BASE_URL 与 MODEL 都在，也只走本地降级（徽章离线模式的判据）', async () => {
    const calls = stubFetch(() => jsonReply('不该被调用'));
    const restore = withEnv({ AI_BASE_URL: 'https://api.deepseek.com/v1', AI_MODEL: 'deepseek-chat' });
    try {
      const { status, body } = await chat(ask('附近哪里有喝水的地方'));
      expect(status).toBe(200);
      expect(body.mode).toBe('local');
      expect(calls.length).toBe(0);
    } finally {
      restore();
    }
  });

  it('AI_BASE_URL 指向非受信任域：服务端兜底视为不可用，不因此出门', async () => {
    const calls = stubFetch(() => jsonReply('不该被调用'));
    const restore = withEnv({
      AI_BASE_URL: 'https://relay.evil.example/v1', AI_API_KEY: 'k', AI_MODEL: 'm',
    });
    try {
      const { body } = await chat(ask('你好呀'));
      expect(body.mode).toBe('local');
      expect(calls.length).toBe(0);
    } finally {
      restore();
    }
  });
});

describe('管理端受众', () => {
  it('AI 周报无 Key：返回统计骨架而不是报错', async () => {
    const payload = await seedAdmin({ sub: 'admin0000aiwk', username: 'weekly_admin', role: 'admin' });
    const token = await adminToken(payload);
    stubFetch(() => { throw new Error('offline'); });
    const res = await chatPost(new Request('http://warm-journey.test/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `__Host-wj_admin=${token}` },
      body: JSON.stringify({ audience: 'admin', dataText: '本周离店反馈 12 条，均分 4.3', messages: [{ role: 'user', content: '生成本周周报' }] }),
    }));
    const body = await res.json() as ChatBody;
    expect(res.status).toBe(200);
    expect(body.mode).toBe('local');
    expect(body.text).toContain('离店反馈周报 · 统计摘要');
    expect(body.text).toContain('本周离店反馈 12 条');
  });

  it('audience=admin 但无有效 token：鉴权先于降级逻辑（401）', async () => {
    stubFetch(() => jsonReply('x'));
    const res = await chatPost(new Request('http://warm-journey.test/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audience: 'admin', messages: [{ role: 'user', content: '周报' }] }),
    }));
    expect(res.status).toBe(401);
  });

  it('token 来自别的密钥：admin 受众同样被拒', async () => {
    const payload = await seedAdmin({ sub: 'admin0000aiwk2', username: 'forged_weekly_admin', role: 'admin' });
    const forged = await rawToken(payload, { secret: 'not-the-real-secret' });
    const res = await chatPost(new Request('http://warm-journey.test/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `__Host-wj_admin=${forged}` },
      body: JSON.stringify({ audience: 'admin', messages: [{ role: 'user', content: '周报' }] }),
    }));
    expect(res.status).toBe(401);
  });
});

// 放最后：这个用例会把 chat:local 的分钟桶打满（本文件同库共享计数）
describe('限流仍先行于降级（每 IP 每分钟 20 次）', () => {
  it('连发 25 次后拿到 429，而不是继续消耗上游', async () => {
    let upstreamCalls = 0;
    stubFetch(() => { upstreamCalls++; return jsonReply('好的'); });
    const codes: number[] = [];
    for (let n = 0; n < 25; n++) {
      const res = await chatPost(new Request('http://warm-journey.test/api/ai/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ask('你好', { provider: PROVIDER })),
      }));
      codes.push(res.status);
      await res.text();
    }
    expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(20);
    expect(codes).toContain(429);
    expect(upstreamCalls).toBeLessThanOrEqual(20);
  });
});
