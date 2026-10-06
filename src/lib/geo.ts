// 距离计算（Haversine，km）：首页排序与卡片标注共用同一实现。
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 按到用户点的距离升序（不改原数组）
export function byDistance<T extends { lat: number; lng: number }>(
  items: readonly T[], userLat: number, userLng: number,
): T[] {
  return [...items].sort(
    (a, b) => haversine(userLat, userLng, a.lat, a.lng) - haversine(userLat, userLng, b.lat, b.lng),
  );
}

// haversine（米）——DB 侧邻近检索与口碑聚合用；与前端 km 版同口径，仅单位不同
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
