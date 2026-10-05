// 分页参数钳制：与 HTTP/Cloudflare 运行时无关，便于单元测试直接覆盖
export function clampInt(value: string | null, def: number, min: number, max: number): number {
  // 缺省与非法都必须回落到 def：Number(null) === 0 会被当成合法值，
  // 曾经让"不带 page_size 的请求"退化成每页 1 条
  if (value === null || value.trim() === '') return def;
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.floor(n), min), max);
}

// NaN / 越界一律收敛到合法区间：防 D1 抛错打穿成 500，也防超大 page_size 全表拉取。
// 上限 200 与管理端「AI 周报」单次拉取量对齐（再大即视为滥用）。
export function pageParams(sp: URLSearchParams, defaultSize = 20, maxSize = 200) {
  return {
    page: clampInt(sp.get('page'), 1, 1, 100000),
    page_size: clampInt(sp.get('page_size'), defaultSize, 1, maxSize),
  };
}
