import { getRequestContext } from '@cloudflare/next-on-pages';
import { getNearbyPoints } from '@/lib/db';
import { fetchWeather } from '@/lib/ai/weather';
import type { AiContext } from '@/lib/ai/types';

export const runtime = 'edge';

// Asia/Shanghai 固定时区格式化：'2026-10-05 14:30 周一'
function nowShanghai(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(new Date());
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${weekday}`;
}

// GET /api/ai/context?lat=23.04&lng=113.40
// 聚合动态上下文：时间 + 天气 + 附近 3 个开放站点（含在店人数与 crowdHint）。
// 天气失败不拖垮整体（内部 allSettled）；无 lat/lng 时只返回时间 + 天气（wttr.in 按 IP 定位）。
export async function GET(req: Request) {
  const { env } = getRequestContext();
  const url = new URL(req.url);
  const latRaw = url.searchParams.get('lat');
  const lngRaw = url.searchParams.get('lng');
  let lat: number | undefined;
  let lng: number | undefined;
  if (latRaw !== null && lngRaw !== null) {
    lat = Number(latRaw);
    lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return Response.json({ ok: false, error: '坐标无效' }, { status: 422 });
    }
  }

  const hasLocation = lat !== undefined && lng !== undefined;

  const [weather, nearby] = await Promise.allSettled([
    fetchWeather(env as { WEATHER_API_KEY?: string }, lat, lng),
    hasLocation ? getNearbyPoints(env.DB, lat as number, lng as number, 3) : Promise.resolve([]),
  ]);

  const context: AiContext = {
    now: nowShanghai(),
    weather: weather.status === 'fulfilled' ? weather.value : null,
    nearby: nearby.status === 'fulfilled' ? nearby.value : [],
  };
  return Response.json({ ok: true, data: context });
}
