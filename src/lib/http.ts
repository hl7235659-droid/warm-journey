// 公共路由层：鉴权收敛 + 请求解析 + 分页钳制 + 客户端 IP。
// 所有 admin 路由必须经 withAdmin 包裹，从机制上杜绝漏写鉴权 / 角色不一致。
import { getRequestContext } from '@cloudflare/next-on-pages';
import { requireAdmin, requireActiveAdmin, requireRole, type AdminPayload } from '@/lib/auth';
import type { z } from 'zod';

export interface CloudflareEnvLike {
  DB: D1Database;
  BUCKET?: R2Bucket;
  JWT_SECRET?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_ALLOWED_HOSTS?: string;
  WEATHER_API_KEY?: string;
}

type RouteCtx<P> = { params: Promise<P> };

export function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}

export function jsonErr(error: string, status: number, details?: unknown): Response {
  return Response.json(
    details === undefined ? { ok: false, error } : { ok: false, error, details },
    { status },
  );
}

interface WithAdminArgs<P> {
  req: Request;
  env: CloudflareEnvLike;
  auth: AdminPayload;
  params: P;
}

// admin 路由统一入口：requireAdmin → 可选角色校验 → handler。
// opts.roles 缺省表示"任意已登录管理员"；写操作必须显式声明角色白名单。
// opts.active=true 用于账号管理等高风险操作：JWT 之外回查 DB，被删/降级账号立即失效。
// 注：第二参数按 Next 15 类型约定声明为必选（运行时仍做兼容兜底）。
export function withAdmin<P = Record<string, string>>(
  handler: (args: WithAdminArgs<P>) => Promise<Response>,
  opts: { roles?: string[]; active?: boolean } = {},
) {
  return async (req: Request, routeCtx: RouteCtx<P>): Promise<Response> => {
    const { env } = getRequestContext();
    const e = env as unknown as CloudflareEnvLike;
    const auth = opts.active
      ? await requireActiveAdmin(req, e)
      : await requireAdmin(req, e);
    if (auth instanceof Response) return auth;
    if (opts.roles) {
      const deny = requireRole(auth, opts.roles);
      if (deny) return deny;
    }
    const params = (routeCtx ? await routeCtx.params : {}) as P;
    try {
      return await handler({ req, env: e, auth, params });
    } catch (err) {
      if (err instanceof Response) return err; // 业务响应可直接抛出，勿被压成 500
      console.error('admin route error:', (err as { message?: string })?.message ?? 'unknown');
      return jsonErr('服务暂不可用，请稍后重试', 500);
    }
  };
}

// 解析 JSON body 并过 zod：格式错误 → 400，校验失败 → 422，否则返回数据
export async function readJson<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S> | Response> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return jsonErr('请求格式错误', 400); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return jsonErr('参数验证失败', 422, parsed.error.flatten());
  return parsed.data;
}

// 分页参数钳制：实现见 @/lib/pagination（纯函数，可单测）
export { pageParams } from '@/lib/pagination';

// 客户端 IP：只认 Cloudflare 设定的 cf-connecting-ip。
// 不回落 X-Forwarded-For——该头客户端可自造，会让全部限流被一键绕过；
// 非 CF 入口（本机 dev / 直连）统一归入 'local' 共享额度，宁可严格。
export function getClientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim() || 'local';
}

// 骑手匿名标识的统一校验（64-bit 随机 hex）
export function isValidRiderToken(token: string): boolean {
  return /^[0-9a-f]{16,32}$/.test(token);
}
