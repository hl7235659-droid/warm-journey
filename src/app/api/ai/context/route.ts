import { getRequestContext } from '@cloudflare/next-on-pages';
import { getNearbyPoints, checkRateLimit } from '@/lib/db';
import { getClientIp } from '@/lib/http';
import { fetchWeather } from '@/lib/ai/weather';
import type { AiContext } from '@/lib/ai/types';

export const runtime = 'edge';

// Asia/Shanghai 固定时区格式化：'2026-10-05 14:30 周一'
// 单实例 + 一次 formatToParts（此前每次请求现造两个 formatter）。
// hourCycle:'h23' 写死而不用 hour12:false：后者在部分 ICU 版本会让 zh-CN 把午夜排成
// '24:00'，前者按规范锁定 00–23。
const SH_FMT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function nowShanghai(): string {
  const p = SH_FMT.formatToParts(new Date());
  const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('weekday')}`;
}

// GET /api/ai/context?lat=23.04&lng=113.40
// 聚合动态上下文：时间 + 天气 + 附近 3 个开放站点（含在店人数与 crowdHint）。
// 天气失败不拖垮整体（内部 allSettled）；无 lat/lng 时只返回时间 + 天气（wttr.in 按 IP 定位）。
export async function GET(req: Request) {
  const { env } = getRequestContext();

  // 匿名可触发服务端出站请求与 D1 写操作：必须限流
  if (!(await checkRateLimit(env.DB, `ctx:${getClientIp(req)}`, { limit: 20, windowSec: 60 }))) {
    return Response.json({ ok: false, error: '请求过于频繁，请稍后再试' }, { status: 429 });
  }

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
    fetchWeather(lat, lng),
    hasLocation ? getNearbyPoints(env.DB, lat as number, lng as number, 3) : Promise.resolve([]),
  ]);

  const context: AiContext = {
    now: nowShanghai(),
    weather: weather.status === 'fulfilled' ? weather.value : null,
    nearby: nearby.status === 'fulfilled' ? nearby.value : [],
  };
  return Response.json({ ok: true, data: context });
}
