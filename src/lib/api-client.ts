// 客户端唯一的 API 信封入口：所有 fetch+json 经此，禁止再手抄 `{ ok: … }` 形状。
// 语义：网络/解析失败 → NETWORK_ERR；业务失败 → 透传服务端 error。
// 不判 HTTP 状态码（与既有调用点一致）——服务端 4xx/5xx 一律带 { ok:false, error } body。
import type { ApiResponse } from '@/lib/types';

export const NETWORK_ERR = '网络异常，请稍后重试';
export const ACTION_ERR = '操作失败，请重试';

export async function api<T = unknown>(input: string, init?: RequestInit): Promise<ApiResponse<T>> {
  try {
    return await (await fetch(input, init)).json() as ApiResponse<T>;
  } catch {
    return { ok: false, error: NETWORK_ERR };
  }
}
