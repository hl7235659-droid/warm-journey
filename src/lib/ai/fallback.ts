// 本地降级回答（无 Key / 远端失败时的兜底，服务端与演示断网场景共用）
import { matchSiteHelp } from './site-help';
import type { AiContext, AiAction } from './types';

const NEARBY_INTENT = /(附近|周边|最近|哪有|哪里有|哪里能|有没有|休息|歇脚|充电|喝水|上厕所|躲雨|避雨|位置|有空|有位|挤|人多)/;
const POINT_REVIEW_INTENT = /(靠谱|口碑|评分|评价|怎么样|好吗|值得|反馈|建议)/;

export interface FallbackPointInfo {
  name: string;
  status: string;
  openHours: string;
  services: string[];
  inStore: number;
  feedbackSummary?: string;
}

export interface FallbackOptions {
  audience?: 'rider' | 'admin';
  dataText?: string;
}

export interface FallbackResult {
  text: string;
  action?: AiAction;
}

export function localFallback(
  userMessage: string,
  context?: AiContext,
  point?: FallbackPointInfo,
  options?: FallbackOptions,
): FallbackResult {
  const msg = (userMessage || '').trim();

  // 0) 管理端周报（T3）：无 Key 时返回统计骨架
  if (options?.audience === 'admin' && options.dataText) {
    return {
      text:
        `【离店反馈周报 · 统计摘要】\n${options.dataText}\n\n` +
        '—— 本地模式：仅输出统计摘要。配置 AI 提供商（悬浮窗设置或 Pages 环境变量 AI_*）后可生成带分析结论与行动建议的完整周报。',
    };
  }

  // 1) 站点功能说明命中 → 直接给操作指引
  const hits = matchSiteHelp(msg, 'rider', 2);
  if (hits.length > 0 && !NEARBY_INTENT.test(msg) && !POINT_REVIEW_INTENT.test(msg)) {
    const text = hits
      .map((h) => `【${h.title}】\n${h.content}`)
      .join('\n\n') + '\n\n—— 以上来自暖途同行本地功能手册（离线模式，未联网大模型）。';
    return { text };
  }

  // 2) 站点口碑/状态类提问（详情页"问小暖"离线场景）
  if (POINT_REVIEW_INTENT.test(msg) && point) {
    const lines = [
      `【${point.name}】状态：${point.status}，营业时间：${point.openHours}`,
      `服务项目：${point.services.join('、') || '无'}，当前在店 ${point.inStore} 人`,
      point.feedbackSummary
        ? `离店反馈：${point.feedbackSummary}`
        : '暂无离店反馈数据——如果你去过这家，离店时打个分就能帮到后面的骑手',
    ];
    return { text: lines.join('\n') + '\n\n—— 离线模式回答（基于站点实时数据），仅供参考。' };
  }

  // 3) 附近/休息意图 + 有定位 → 列最近 3 站 + 在店人数 + 高峰提示 + 一键前往
  if (NEARBY_INTENT.test(msg) && context && context.nearby.length > 0) {
    const lines = context.nearby
      .map((n, i) => {
        const hint = n.crowdHint && n.crowdHint !== '暂无历史规律' ? `，${n.crowdHint}` : '';
        return `${i + 1}. ${n.name}（${n.dist}）：营业 ${n.openHours}，当前在店 ${n.inStore} 人${hint}，服务：${n.services.join('、') || '无'}`;
      })
      .join('\n');
    const weather = context.weather ? `今天 ${context.weather.city} ${context.weather.text} ${context.weather.temp}°C，` : '';
    const action: AiAction = { type: 'navigate', params: { pointId: context.nearby[0].id } };
    return {
      text:
        `${weather}离你最近的开放驿站：\n${lines}\n\n` +
        '点下方「一键前往」可打开最近的驿站详情页；进去后可直接导航或预约进店。\n' +
        '—— 离线模式回答（未联网大模型），仅供参考。',
      action,
    };
  }

  // 4) 天气/时间类
  if (context && /(天气|气温|几度|热不热|冷不冷|现在几点|今天星期|下雨)/.test(msg)) {
    const w = context.weather
      ? `${context.weather.city}当前 ${context.weather.text}，气温 ${context.weather.temp}°C${context.weather.warning ? `，${context.weather.warning}` : ''}`
      : '天气信息暂时取不到';
    return { text: `现在是 ${context.now}。${w}。\n—— 离线模式回答，仅供参考。` };
  }

  // 5) 默认：礼貌说明 + 引导配置提供商
  return {
    text:
      '这个问题需要联网大模型才能回答得更准。当前处于离线模式，小暖可以：\n' +
      '1. 解答"这个网站怎么用"（预约、上报、查询进度等）；\n' +
      '2. 告诉你附近 3 个开放驿站和实时在店人数（需授权定位）。\n' +
      '想启用完整对话：点右上角提供商设置，添加任一 OpenAI 兼容接口（如 DeepSeek、通义、Kimi）和你自己的 Key 即可，Key 只保存在你的设备上。',
  };
}
