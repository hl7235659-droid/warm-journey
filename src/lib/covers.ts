// 站点实景封面：按站点 ID 映射，未收录的站点回落到国风插画占位图
export const POINT_COVERS: Record<string, string> = {
  point001: '/images/station-01.webp',
  point002: '/images/station-02.webp',
};
export const COVER_FALLBACK = '/images/station-placeholder.webp';
