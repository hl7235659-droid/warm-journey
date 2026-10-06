// AI 助手「小暖」共享类型（前后端通用，无环境依赖）

// 客户端历史窗口：发送时携带「本次提问之外」的最近 N 条，服务端在其后追加本次提问，
// 共 N+1 条。改动此值必须与 AiDock 的发送链路一起看：窗口取早一条会丢上下文，
// 取晚一条（含本次提问）会让服务端重复追加——即 2026-10 修复的双发缺陷（B1）。
export const HISTORY_WINDOW = 11;

// ---------- 提供商（仅存本机 localStorage，永不落服务端） ----------
export interface AiProvider {
  id: string;              // 本机生成
  name: string;            // 用户起的名字，如 "DeepSeek 官方"
  baseUrl: string;         // OpenAI 兼容，如 https://api.deepseek.com/v1
  apiKey: string;          // 仅存本机，不回显
  model: string;           // deepseek-chat 等
  temperature: number;     // 0-2，默认 0.3
  createdAt: number;
}

export interface ProviderStore {
  providers: AiProvider[];
  activeId: string | null;
}

// ---------- 命令操作 ----------
export type AiActionType =
  | 'navigate'        // 跳转站点详情页
  | 'filter'          // 回首页按条件筛选
  | 'reserve'         // 带路发起预约（写操作，需确认）
  | 'report'          // 带路打开问题上报（写操作，需确认）
  | 'route'           // 打开地图导航
  | 'list_knowledge'; // 展示某类知识条目

export interface AiActionParams {
  pointId?: string;
  city?: string;
  service?: string;
  category?: string;   // 上报类型或知识库类别
}

export interface AiAction {
  type: AiActionType;
  params: AiActionParams;
}

// ---------- 会话（localStorage: wj_ai_sessions） ----------
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  action?: AiAction;          // assistant 消息可带操作卡
  actionDone?: boolean;        // 操作卡是否已执行
  mode?: 'remote' | 'local';   // 本地降级消息标注
  ts: number;
}

export interface ChatSession {
  id: string;
  title: string;              // 首条用户消息前 30 字自动生成（setSessionTitle），可重命名
  pointId?: string;           // 详情页"问小暖"打开时绑定站点上下文
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ---------- 动态上下文（/api/ai/context） ----------
export interface NearbyPointInfo {
  id: string;
  name: string;
  dist: string;               // '850m' | '1.2km'
  inStore: number;
  openHours: string;
  services: string[];
  crowdHint: string;          // '当前较空' | '高峰时段' | '暂无历史规律'
}

export interface WeatherInfo {
  city: string;
  text: string;
  temp: number;
  warning?: string;
}

export interface AiContext {
  now: string;                // '2026-10-05 14:30 周一'
  weather: WeatherInfo | null;
  // 可选：/api/ai/chat 的入参 zod 里 nearby 本就是 optional，公开端点可以被只发
  // {context:{}} 打进来，读 .length 会 TypeError 变 500（消费点一律用 ?.length）
  nearby?: NearbyPointInfo[];  // 最近 3 个开放站点（无定位时为空）
}

// ---------- 服务端兜底提供商状态（GET /api/ai/status） ----------
// 徽章要区分"本机没配 Key"和"整站没接大模型"：前者仍可用（走服务端兜底），
// 后者才是真离线。只有这一个布尔值——用的哪家模型属服务器实现细节，不下发。
export interface AiServerStatus {
  ready: boolean;
}

// ---------- 聊天 API 契约（/api/ai/chat） ----------
// 请求体的形状由 chat/route.ts 的 BodySchema（zod）单点定义，客户端 AiDock 按它拼 body；
// 这里只声明响应——曾经的 ChatRequest/ChatProviderConfig 两份手抄契约零引用，已删。
export interface ChatResponse {
  ok: boolean;
  mode: 'remote' | 'local';
  text: string;
  action?: AiAction;
  error?: string;
}
