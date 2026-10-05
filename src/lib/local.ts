// localStorage / sessionStorage 读写的唯一入口：SSR 安全、异常一律静默、列表读写带上限裁剪。
// 键名集中在此，避免同一键在多个文件各抄一遍。
// AI 侧的存储分层（provider Key 只落 sessionStorage）见 @/components/ai/ai-store。

export const LS_KEYS = {
  favs: 'wj_favs',
  myReports: 'wj_my_reports',
  confirmed: (id: string) => `wj_confirmed_${id}`,
} as const;

/** 本机上报记录（查询码 + 落点）：只保留最近 MY_REPORTS_MAX 条 */
export interface MyReport {
  code: string;
  point_id: string;
  ts: number;
}

export const MY_REPORTS_MAX = 20;

export function readItem(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeItem(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, value); } catch { /* 配额满 / 隐私模式：静默 */ }
}

export function readSessionItem(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function writeSessionItem(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(key, value); } catch { /* 配额满 / 隐私模式：静默 */ }
}

/** 读 JSON 数组：损坏 / 非数组 / SSR 一律空数组；max 只裁剪读到的条数 */
export function readList<T>(key: string, max = 50): T[] {
  try {
    const v = JSON.parse(readItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? v.slice(0, max) as T[] : [];
  } catch {
    return [];
  }
}

/** 写 JSON 数组：保留前 max 条（调用方按"新在前"或"足够小"的语义传值） */
export function writeList<T>(key: string, list: T[], max = 50): void {
  writeItem(key, JSON.stringify(list.slice(0, max)));
}
