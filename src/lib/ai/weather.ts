// 天气通道：wttr.in 免费端点（免 key，支持坐标，无坐标时按请求 IP 自动定位）。
// 天气取不到只影响 prompt 里的一段文字，绝不拖垮 /api/ai/context。
//
// 曾并存第二条通道「和风天气」（geoapi 取城市名 + devapi 取实况，需一个可选的服务端密钥）：
// 生产实测该密钥从未配置（无密钥时第二条通道立即返回 null，白占两次调用的代码路径与
// 一份 env 类型），2026-10 批次 6 删除。删减范围的前置探测见计划 §9.3 执行回写：
// wttr.in 的 lang_zh 字段虽然恒有值，内容却是英文（"Clear "/"Smoky haze"），
// 因此下面的中译表是唯一的中文来源，必须保留。
import type { WeatherInfo } from './types';

const TIMEOUT_MS = 5000;

interface WttrJ1 {
  current_condition?: Array<{
    temp_C?: string;
    weatherDesc?: Array<{ value?: string }>;
    lang_zh?: Array<{ value?: string }>;
  }>;
  nearest_area?: Array<{ areaName?: Array<{ value?: string }>; country?: Array<{ value?: string }> }>;
}

// wttr.in 实况描述 → 中文。未命中则原样返回（表外的描述极少见）。
const WTTR_ZH: Record<string, string> = {
  'Sunny': '晴', 'Clear': '晴', 'Partly cloudy': '多云转晴', 'Partly Cloudy': '多云转晴',
  'Cloudy': '多云', 'Overcast': '阴', 'Mist': '薄雾', 'Fog': '雾', 'Haze': '霾',
  'Smoky haze': '烟霾', 'Widespread dust': '浮尘', 'Shallow fog': '薄雾',
  'Patchy rain possible': '可能有零星小雨', 'Patchy light rain': '零星小雨',
  'Patchy moderate rain': '零星中雨', 'Patchy heavy rain': '零星大雨',
  'Patchy snow possible': '可能有零星降雪', 'Patchy sleet possible': '可能有零星雨夹雪',
  'Patchy light snow': '零星小雪', 'Light snow': '小雪', 'Snow': '雪', 'Heavy snow': '大雪',
  'Light rain': '小雨', 'Moderate rain': '中雨', 'Moderate or heavy rain': '中到大雨',
  'Heavy rain': '大雨', 'Light drizzle': '毛毛雨', 'Drizzle': '毛毛雨',
  'Light rain shower': '阵雨', 'Moderate or heavy rain shower': '中大阵雨',
  'Torrential rain shower': '暴雨', 'Rain shower': '阵雨',
  'Thundery outbreaks possible': '可能有雷暴', 'Thundery shower in vicinity': '附近有雷阵雨',
  'Thunder': '雷', 'Thunderstorm': '雷阵雨',
  'Patchy light rain with thunder': '零星小雨伴雷', 'Moderate or heavy rain with thunder': '中到大雨伴雷',
  'Light snow showers': '小阵雪', 'Moderate or heavy snow showers': '中到大阵雪',
  'Light sleet': '小雨夹雪', 'Sleet': '雨夹雪', 'Moderate or heavy sleet': '中到大雨夹雪',
  'Freezing fog': '冻雾', 'Freezing drizzle': '冻毛毛雨',
  'Blowing snow': '吹雪', 'Blizzard': '暴风雪', 'Squalls': '阵风', 'Windy': '大风',
};

// wttr.in 的描述一律带尾随空格（"Clear "），不 trim 就永远查不中表——
// 生产首页天气此前显示英文 "Clear " 即源于此。
function zhWeather(desc: string | undefined): string {
  const d = (desc ?? '').trim();
  if (!d) return '未知';
  return WTTR_ZH[d] ?? d;
}

// 唯一入口：带坐标用坐标，不带坐标由 wttr.in 按请求 IP 定位。
// 取不到实况返回 null；网络层异常照常向上抛，由调用方（/api/ai/context 的
// Promise.allSettled）兜住——天气失败绝不能拖垮整个上下文响应。
export async function fetchWeather(lat?: number, lng?: number): Promise<WeatherInfo | null> {
  const path = lat !== undefined && lng !== undefined ? `/${lat.toFixed(3)},${lng.toFixed(3)}` : '';
  const res = await fetch(`https://wttr.in${path}?format=j1&lang=zh`, {
    headers: { 'User-Agent': 'curl/8.0' }, // wttr.in 对浏览器 UA 返回 HTML
    signal: AbortSignal.timeout(TIMEOUT_MS),
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
