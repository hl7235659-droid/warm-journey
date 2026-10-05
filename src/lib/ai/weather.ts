// 天气通道：和风天气（有 key 优先）→ wttr.in（免 key 兜底，支持坐标或按 IP 自动定位）
// 任何失败都返回 null，绝不拖垮 /api/ai/context。
import { fetchWithTimeout } from './fetch';
import type { WeatherInfo } from './types';

const TIMEOUT_MS = 5000;

interface WeatherEnv {
  WEATHER_API_KEY?: string;
}

async function qweather(env: WeatherEnv, lat?: number, lng?: number): Promise<WeatherInfo | null> {
  const key = env.WEATHER_API_KEY;
  if (!key) return null;
  if (lat === undefined || lng === undefined) return null; // 和风不支持按 IP，无坐标时交给 wttr.in
  const loc = `${lng.toFixed(2)},${lat.toFixed(2)}`;
  // 城市名与实况并行取
  const [geoRes, nowRes] = await Promise.allSettled([
    fetchWithTimeout(
      `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(loc)}&key=${encodeURIComponent(key)}`,
      TIMEOUT_MS,
    ),
    fetchWithTimeout(
      `https://devapi.qweather.com/v7/weather/now?location=${encodeURIComponent(loc)}&key=${encodeURIComponent(key)}`,
      TIMEOUT_MS,
    ),
  ]);
  if (nowRes.status !== 'fulfilled' || !nowRes.value.ok) return null;
  let nowPayload: { now?: { temp?: string; text?: string } };
  try {
    nowPayload = await nowRes.value.json();
  } catch {
    return null;
  }
  if (!nowPayload.now) return null;
  let city = '当前位置';
  if (geoRes.status === 'fulfilled' && geoRes.value.ok) {
    try {
      const geo = (await geoRes.value.json()) as { location?: Array<{ name?: string; adm2?: string }> };
      city = geo.location?.[0]?.adm2 || geo.location?.[0]?.name || city;
    } catch { /* 城市名取不到不影响返回 */ }
  }
  const temp = Number(nowPayload.now.temp);
  return {
    city,
    text: nowPayload.now.text || '未知',
    temp: Number.isFinite(temp) ? temp : 0,
  };
}

interface WttrJ1 {
  current_condition?: Array<{
    temp_C?: string;
    weatherDesc?: Array<{ value?: string }>;
    lang_zh?: Array<{ value?: string }>;
  }>;
  nearest_area?: Array<{ areaName?: Array<{ value?: string }>; country?: Array<{ value?: string }> }>;
}

// wttr.in 描述为英文，常见天气中译（未命中则原样返回，可接受）
const WTTR_ZH: Record<string, string> = {
  'Sunny': '晴', 'Clear': '晴', 'Partly cloudy': '多云转晴', 'Partly Cloudy': '多云转晴',
  'Cloudy': '多云', 'Overcast': '阴', 'Mist': '薄雾', 'Fog': '雾', 'Haze': '霾',
  'Patchy rain possible': '可能有零星小雨', 'Patchy light rain': '零星小雨',
  'Light rain': '小雨', 'Light rain shower': '阵雨', 'Rain shower': '阵雨',
  'Moderate rain': '中雨', 'Heavy rain': '大雨', 'Light drizzle': '毛毛雨', 'Drizzle': '毛毛雨',
  'Thundery shower in vicinity': '附近有雷阵雨', 'Thunder': '雷', 'Thunderstorm': '雷阵雨',
  'Patchy light snow': '零星小雪', 'Light snow': '小雪', 'Snow': '雪', 'Heavy snow': '大雪',
  'Light sleet': '小雨夹雪', 'Sleet': '雨夹雪', 'Freezing fog': '冻雾',
  'Blowing snow': '吹雪', 'Blizzard': '暴风雪',
};

function zhWeather(desc: string | undefined): string {
  if (!desc) return '未知';
  return WTTR_ZH[desc] ?? desc;
}

async function wttr(lat?: number, lng?: number): Promise<WeatherInfo | null> {
  const path = lat !== undefined && lng !== undefined ? `/${lat.toFixed(3)},${lng.toFixed(3)}` : '';
  const res = await fetchWithTimeout(`https://wttr.in${path}?format=j1&lang=zh`, TIMEOUT_MS, {
    headers: { 'User-Agent': 'curl/8.0' }, // wttr.in 对浏览器 UA 返回 HTML
  });
  if (!res.ok) return null;
  let data: WttrJ1;
  try {
    data = JSON.parse(await res.text()) as WttrJ1; // wttr.in 有时用 text/plain 发 JSON
  } catch {
    return null;
  }
  const cur = data.current_condition?.[0];
  if (!cur) return null;
  const temp = Number(cur.temp_C);
  const area = data.nearest_area?.[0]?.areaName?.[0]?.value;
  return {
    city: area || '当前位置',
    text: zhWeather(cur.lang_zh?.[0]?.value || cur.weatherDesc?.[0]?.value),
    temp: Number.isFinite(temp) ? temp : 0,
  };
}

// 主入口：和风 → wttr.in → null。带坐标用坐标，不带坐标 wttr.in 按请求 IP 自动定位。
export async function fetchWeather(env: WeatherEnv, lat?: number, lng?: number): Promise<WeatherInfo | null> {
  const results = await Promise.allSettled([qweather(env, lat, lng), wttr(lat, lng)]);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return null;
}
