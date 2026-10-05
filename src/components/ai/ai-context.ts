'use client';
// 动态上下文采集：geolocation（6s 超时）→ GET /api/ai/context；60s 内存缓存。
// 拒绝授权或失败时只取时间 + 天气（不带坐标），任何失败返回 null，绝不阻塞发送。
import type { AiContext } from '@/lib/ai/types';
import { api } from '@/lib/api-client';

const CACHE_TTL_MS = 60_000;
let cache: { at: number; ctx: AiContext } | null = null;

function getPosition(timeoutMs = 6000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

export async function getContext(force = false): Promise<AiContext | null> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.ctx;
  const pos = await getPosition();
  const qs = pos ? `?lat=${pos.lat.toFixed(5)}&lng=${pos.lng.toFixed(5)}` : '';
  const json = await api<AiContext>(`/api/ai/context${qs}`);
  if (!json.ok || !json.data) return null;
  cache = { at: Date.now(), ctx: json.data };
  return json.data;
}
