# 暖途同行 · AI 助手「小暖」完整开发方案

> **状态：✅ 已全部落地（2026-10-05 收尾核对）**，逐项验证见文末「收尾核对表」。
> 本文档自此作为已交付功能的**设计说明与维护参考**，改动功能时先回读对应章节。

> 依据《产品蓝图-终版.md》(v2 校准版)。形态：**全站悬浮窗**，多自定义提供商、多会话、
> 内置站点功能知识库 + 命令操作 + 动态上下文（天气/时间/附近）。
> 全部代码跑在现有 Next.js 15 + Cloudflare Pages/Edge 架构内，不引入新平台。

---

## 0. 总体架构

```
┌─ 前端（client components）────────────────────────────────┐
│ <AiDock /> 悬浮窗（挂 layout.tsx，C 端全站可见）             │
│  ├─ 会话列表 + 多会话（localStorage: wj_ai_sessions）       │
│  ├─ 提供商管理（localStorage: wj_ai_providers）             │
│  ├─ 上下文采集（定位/时间 → 随消息发送）                    │
│  └─ 命令执行器（白名单 action，写操作弹确认）               │
└──────────────┬────────────────────────────────────────────┘
               │ POST /api/ai/*
┌─ 后端（edge routes）───────────────────────────────────────┐
│ /api/ai/chat     组装 prompt（系统+知识库+动态上下文+消息） │
│                  → 转发 OpenAI 兼容接口 → 解析 action 指令  │
│ /api/ai/context  聚合动态上下文：附近站点/在店人数/天气      │
│ /api/ai/test     提供商连通性测试                           │
│ （可选）/api/admin/ai/knowledge  知识库 CRUD（管理端）      │
└──────────────┬────────────────────────────────────────────┘
               │
┌─ 数据层 ──────────────────────────────────────────────────┐
│ D1 新增表：ai_knowledge（知识条目，管理端维护）             │
│ 只读复用：service_points / visits / visit_feedback / cities │
│ localStorage：提供商配置 / 会话 / API Key（不落服务器）     │
└────────────────────────────────────────────────────────────┘
```

**关键决策**
- **API Key 存用户本机 localStorage，永不写入 D1、永不回显**——C 端免登录理念的延续；服务端无需存任何用户密钥
- Edge 中转而非浏览器直连 provider：避免 CORS，且能在服务端注入知识库/上下文、做截断与超时
- AI 产生的**写操作一律前端二次确认后走现有 API**（/api/visits、/api/reports），AI 不直接写库

---

## 1. 悬浮窗组件 `<AiDock />`

### 1.1 UI 结构（国风适配 globals.css 现有变量）

```
右下角圆形印章按钮「暖」（朱砂底，48px，z-index 900）
  ↓ 点击展开
面板（360×520，移动端全屏抽屉）
┌────────────────────────────┐
│ 顶栏：小暖 · [当前提供商▾] │ ← 点提供商名进设置页
│      [会话列表▾] [＋新会话] │
├────────────────────────────┤
│ 消息区（用户右/AI左，印章头像）│
│  · AI 消息底部可附「操作卡」 │ ← action 确认按钮
│  · 降级消息标注"本地回答"    │
├────────────────────────────┤
│ 快捷指令 chips（首屏空态显示）：│
│  附近哪有位置 / 这站靠谱吗 /  │
│  帮我上报问题 / 我需要法律援助 │
├────────────────────────────┤
│ 输入框 [🎤远期] [发送]       │
└────────────────────────────┘
设置抽屉（从顶栏滑出）：提供商列表/新增/编辑/测试/删除
会话抽屉：会话列表/重命名/删除/清空全部
```

### 1.2 文件

```
src/components/ai/
  AiDock.tsx          入口：悬浮按钮 + 面板开关（挂 src/app/layout.tsx body 尾部）
  ChatPanel.tsx       消息区 + 输入框 + 快捷 chips
  SessionDrawer.tsx   会话列表
  ProviderDrawer.tsx  提供商管理
  ActionCard.tsx      AI 返回的操作确认卡
  ai-store.ts         localStorage 读写（providers/sessions），纯函数便于测试
  ai-context.ts       定位/时间采集，调 /api/ai/context
```

layout.tsx 挂载（仅 C 端；管理端 `/admin/*` 不渲染——用 `usePathname()` 判断）：

```tsx
// src/app/layout.tsx（节选）
{!pathname?.startsWith('/admin') && <AiDock />}
```

---

## 2. 多自定义提供商

### 2.1 数据结构（localStorage `wj_ai_providers`）

```ts
interface AiProvider {
  id: string;            // 本机生成 nanoid 风格
  name: string;          // 用户起的名字，如 "DeepSeek 官方"
  baseUrl: string;       // OpenAI 兼容，如 https://api.deepseek.com/v1
  apiKey: string;        // 仅存本机
  model: string;         // deepseek-chat
  temperature: number;   // 默认 0.3
  createdAt: number;
}
interface ProviderStore {
  providers: AiProvider[];
  activeId: string | null;
}
```

内置一条**只读示例**（workers-ai 占位，key 为空时走降级），用户自行添加真实提供商。

### 2.2 管理 UI 行为

- 列表：显示 name / baseUrl 域名 / model / key 掩码（`sk-…****` 只显示前 4 位）
- 新增/编辑：表单校验（baseUrl 必须 http(s)、model 非空、temperature 0-2）
- **测试连接**：调 `POST /api/ai/test`（带 baseUrl+key+model），后端发一条 `请只回复：连接成功`，返回 ok/错误信息
- 设为当前：切换 `activeId`，顶栏即时刷新
- 删除：若正在使用则提示先切换

### 2.3 后端 `/api/ai/chat` 的 key 来源优先级

```
请求体携带的 provider（baseUrl+apiKey+model，前端从 localStorage 读出随请求发）
  → 否则服务端环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL（Pages 环境变量配置，用于演示兜底）
    → 都没有 → 走本地降级回答，响应头标 X-Ai-Mode: local
```

> Key 随请求体传输而非存服务端：HTTPS 下可接受，且服务端 `console` 严禁打印请求体（写进开发规范）。

---

## 3. 多会话

### 3.1 数据结构（localStorage `wj_ai_sessions`）

```ts
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  action?: AiAction;        // assistant 消息可带操作卡
  mode?: 'remote' | 'local';
  ts: number;
}
interface ChatSession {
  id: string;
  title: string;            // 首条用户消息前 20 字自动生成，可重命名
  pointId?: string;         // 从详情页"问小暖"打开时绑定站点上下文
  messages: ChatMessage[];  // 单会话上限 60 条，超出裁剪最旧
  createdAt: number;
  updatedAt: number;
}
```

### 3.2 行为

- 「＋新会话」：保留旧会话，开空白会话
- 会话列表：按 updatedAt 倒序，显示标题 + 相对时间；支持重命名/删除
- 上限 20 个会话，超出删最旧；提供「清空全部」二次确认
- 发送时只带**最近 12 条**消息给后端（服务端再截断兜底）

---

## 4. 知识库体系（三层）

### 4.1 第一层：站点功能说明（静态，代码内置）⭐ 用户点名要

`src/lib/ai/site-help.ts`——把全站功能写成结构化条目，**就是这份产品的"说明书"**：

```ts
export interface HelpEntry {
  id: string;            // 'find-point' | 'reserve' | 'checkin' | ...
  title: string;         // '如何查找附近驿站'
  content: string;       // 操作步骤、入口路径、注意事项
  keywords: string[];    // 检索词
}
export const SITE_HELP: HelpEntry[] = [
  { id: 'find-point',  title: '查找附近驿站', ... },
  { id: 'reserve',     title: '预约与入店流程（扫码确认）', ... },
  { id: 'report',      title: '上报问题与查询码', ... },
  { id: 'feedback',    title: '离店反馈', ... },
  { id: 'fav-filter',  title: '收藏与城市筛选', ... },
  { id: 'admin-*',     ...管理端功能（不在 C 端注入） },
];
```

注入策略：按用户消息关键词匹配取 top 3 条注入 system prompt（实现见 §6.2）。这层保证"问网站怎么用"永远答得准，**离线降级时也能直接本地检索回答**。

### 4.2 第二层：业务知识（D1 `ai_knowledge`，管理端维护）

```sql
CREATE TABLE IF NOT EXISTS ai_knowledge (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  category   TEXT NOT NULL,              -- 'rights'(权益政策) | 'channel'(求助渠道)
                                       -- | 'faq'(常见问题) | 'notice'(平台公告)
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,              -- 正文（法援渠道电话/地址、政策要点）
  tags       TEXT NOT NULL DEFAULT '[]', -- JSON array，检索用
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

- 管理端新增 `/admin/knowledge` 页（复用现有 admin layout + requireRole）
- 初始 seed：工会热线 12351、各地法律援助中心渠道、新就业形态劳动者保障政策要点——**对应蓝图 T4 的"指引到正规渠道"**，AI 只引用库内条目并附出处
- 迁移命令沿用现有：`db:migrate` / `db:migrate:prod`（schema.sql 幂等）

### 4.3 第三层：实时数据（动态上下文，见 §5）

站点列表、在店人数、口碑聚合、天气、附近——**这层让 AI 显得"活着"**。

---

## 5. 动态上下文 `/api/ai/context`

### 5.1 请求/响应

```ts
// GET /api/ai/context?lat=23.04&lng=113.40
interface AiContext {
  now: string;                    // '2026-10-05 14:30 周一'（服务端 Asia/Shanghai）
  weather: { city: string; text: string; temp: number; warning?: string } | null;
  nearby: Array<{                 // haversine 最近 3 个开放站点
    id: string; name: string; dist: string;
    inStore: number;              // visits 实时在店人数
    openHours: string; services: string[];
    crowdHint: string;            // '当前较空' | '高峰时段'（由近14天同时段均值算出）
  }>;
}
```

### 5.2 实现要点

- **在店人数**：`SELECT COUNT(*) FROM visits WHERE point_id=? AND status='in_store'`（复用现有查询模式）
- **crowdHint（蓝图 T1 雏形）**：`SELECT AVG(cnt) FROM (近14天同星期同小时段的 in_store 峰值)`，SQL 一次聚合，别在 JS 里循环
- **天气**：首选**和风天气**（国内稳，需 key → 配 Pages 环境变量 `WEATHER_API_KEY`，参照 TMAP_KEY 模式）；无 key 时用 wttr.in 免费端点兜底；都失败返回 `weather: null`，**绝不让天气失败拖垮整个接口**（Promise.allSettled）
- 全部查询 5s AbortController 超时

### 5.3 前端采集

`ai-context.ts`：用浏览器 geolocation（已有首页定位逻辑可复用），拒绝授权则不带 lat/lng，后端只返回时间+天气（按 IP 城市或默认广州）。**每条消息发送前重新取一次 context**（位置会变），缓存 60s 避免重复请求。

---

## 6. 聊天主链路 `/api/ai/chat`

### 6.1 请求/响应

```ts
// POST /api/ai/chat
interface ChatRequest {
  provider?: { baseUrl: string; apiKey: string; model: string; temperature?: number };
  messages: Array<{ role: 'user'|'assistant'; content: string }>;  // 最近12条
  pointId?: string;               // 详情页上下文
  context?: AiContext;            // 前端刚取的动态上下文
}
interface ChatResponse {
  ok: boolean;
  mode: 'remote' | 'local';
  text: string;
  action?: AiAction;              // 解析出的操作指令（见 §7）
  model?: string;
  error?: string;
}
```

### 6.2 服务端 prompt 组装顺序

```
[system] 角色设定：你是"小暖"，暖途同行骑手驿站平台的AI助手……（口吻、边界、
         "不知道就说不知道、涉及法律/心理只给渠道信息并建议咨询专业机构"）
[system] 站点功能知识：SITE_HELP 关键词匹配 top3 条
[system] 业务知识：ai_knowledge 按 tags/category 匹配 top3 条（附"出处：标题"）
[system] 当前站点（有 pointId 时）：站点全字段 + 在店人数 + 近30天反馈聚合（评分均值、
         supports 分布、最近3条建议原文——T2 数据就在这儿）
[system] 动态上下文：时间/天气/附近站点（含 crowdHint）
[system] 操作指令协议（§7.1 全文）
[...]   历史消息（截断：角色白名单、单条≤4000字、总量≤2万字符——跨境云创模式）
[user]  最新消息
```

### 6.3 转发与解析

- `fetch(${baseUrl}/chat/completions)`，90s AbortController，`stream:false`（v1 不做流式，v2 可升 SSE）
- 响应解析：先尝试从文本中提取 ```json action 块 → 校验（§7.2）→ 剥离后得到纯文本 + action
- 错误归一化：`{ok:false, error:'模型接口返回错误：…'}`，前端展示重试按钮

### 6.4 本地降级（无 key / 远端失败）

`src/lib/ai/fallback.ts`（服务端同样可用）：
1. SITE_HELP 关键词命中 → 直接返回操作指引文本
2. 含"附近/哪有/休息"类意图 + 有定位 → 调 context 数据生成"最近 3 站+在店人数"文本 + `navigate` action
3. 都不命中 → 礼貌说明 + 引导配置提供商

**演示价值：挑战杯现场断网/没额度，功能照样转。**

---

## 7. 命令操作系统（AI 可执行的操作）

### 7.1 协议（写进 system prompt，教模型输出）

````
当你判断用户想执行以下操作时，在回复末尾附一个 ```json 代码块：
{"action": {"type": "<类型>", "params": {...}}}
可用类型：
- navigate        {pointId}              跳转到某驿站详情页
- filter          {city?, service?}      回到首页并按条件筛选
- reserve         {pointId}              发起预约（需用户确认）
- report          {pointId?, category?}  打开问题上报页
- route           {pointId}              打开导航（复用现有高德/Apple scheme）
- feedback        {visitId}              打开离店反馈
- list_knowledge  {category}             展示某类知识条目（如 rights）
````

### 7.2 执行管线（前端）

```
解析 action → zod schema 校验（类型白名单 + params 形状 + pointId 必须存在于
当前站点列表）→ 分类：
  读操作（navigate/filter/route/list_knowledge）→ ActionCard 显示"一键前往"，点击执行
  写操作（reserve/report/feedback）→ ActionCard 显示确认按钮，点击后走现有
    /api/visits、/api/reports 流程（含原有表单，AI 只是带路+预填）
```

**红线**：前端只执行白名单类型；params 全量 zod 校验；写操作绝不自动提交。

---

## 8. 蓝图 T1-T4 在本架构中的落点

| 蓝图项 | 实现位置 | 本期范围 |
|---|---|---|
| T1 客流预测问答 | context 的 `inStore + crowdHint`（§5.2）| ✅ 本期（规则版预测，够 demo） |
| T2 口碑摘要 | chat 组 prompt 时的反馈聚合注入（§6.2）| ✅ 本期（详情页"问小暖"即可体验） |
| T3 管理端反馈消化器 | 复用 `/api/ai/chat`：管理端 `/admin/visits` 加「AI 周报」按钮，把 supports 分布+建议列表作为 context 发同一接口 | ✅ 本期（一个按钮+一个 prompt 模板） |
| T4 暖心服务入口 | ai_knowledge category='rights'/'channel' + 快捷 chip「我需要法律援助」+ system prompt 边界约束 | ✅ 本期（知识库+提示词，无新链路） |

---

## 9. 安全与工程规范

1. **所有 route 声明 `export const runtime = 'edge'`**（项目硬性要求）
2. 出站 fetch 统一 `fetchWithTimeout(url, ms, init)` 封装（`src/lib/ai/fetch.ts`）
3. 消息截断：角色白名单、单条 ≤4000 字、总量 ≤2 万字符、只留最近 30 条
4. baseUrl 校验：仅 http/https，去尾斜杠；拒绝内网地址（`127.*`、`192.168.*`、`10.*`、`<him>localhost`）防 SSRF
5. 日志：`console.error` 只记错误类型与状态码，**不记请求体/响应体**（含 key 与用户隐私）
6. 频率限制：demo 期在 D1 记 `ai_rate(ip, window_start, count)`，每 IP 每分钟 20 次；超出返回友好文案
7. AI 输出展示一律标注「AI 生成，仅供参考」；法律/心理类强制附「建议咨询专业机构」
8. `tsc --noEmit` 必须过；部署走 `npm run deploy`（OpenNext Workers，见 README「部署」）

---

## 10. 实施步骤（按可独立验证分步）

| 步 | 内容 | 验证 |
|---|---|---|
| 1 | `src/lib/ai/`：fetch 封装、消息截断、fallback、site-help | 单测式手测 |
| 2 | D1 `ai_knowledge` 表 + seed + `/admin/knowledge` CRUD | 管理端增删改查 |
| 3 | `/api/ai/context`（附近站点+在店人数+crowdHint，天气先 null） | curl 带 lat/lng |
| 4 | `/api/ai/chat` + `/api/ai/test`（远端+降级双通道） | 有 key / 无 key 各验一次 |
| 5 | `<AiDock>` + ProviderDrawer（多提供商 CRUD+测试） | 存两个提供商切换 |
| 6 | ChatPanel + SessionDrawer（多会话） | 新建/切换/重命名/删除 |
| 7 | ActionCard + 命令执行器（zod 白名单） | "带我去大学城驿站并预约"全流程 |
| 8 | 详情页「问小暖」（pointId 上下文）+ 快捷 chips | 问"这站靠谱吗"得到口碑摘要 |
| 9 | 天气接入（和风 key 进 Pages env） | context 返回 weather |
| 10 | 管理端「AI 周报」按钮（T3） | 一键生成 supports 分布周报 |
| 11 | 国风视觉打磨 + prefers-reduced-motion + 移动端抽屉 | 真机/路演屏检查 |

每步独立可演示，任何一步停下都是一个完整功能。

## 11. 环境变量清单（Pages 后台配置）

| 变量 | 用途 | 必需 |
|---|---|---|
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 演示兜底提供商 | 推荐 |
| `WEATHER_API_KEY` | 和风天气 | 可选 |
| `TMAP_KEY` | 既有热力图（迁 env 的既有遗留） | 可选 |

## 12. Demo 脚本（挑战杯路演 3 分钟）

1. 首页打开小暖："附近哪有能充电的地方？现在挤吗？"→ AI 答 3 站+在店人数+高峰提示，附「一键前往」
2. 点进详情页 →「问小暖」："这站靠谱吗？"→ 口碑摘要（评分/被夸次数/近期问题及处理）
3. "帮我预约"→ 操作卡确认 → 走真实预约流程 → 出示入店码
4. 快捷 chip「我需要法律援助」→ AI 给渠道信息+出处+边界声明
5. 管理端点「AI 周报」→ 现场生成 supports 需求分布周报 → **"法律援助被勾选 N 次"** 收尾
6. （彩蛋）现场拔 key/断网 → 再问一次 → 本地降级照常回答——"AI 不是演示道具，是可靠设计"

---

## 13. 收尾核对表（2026-10-05 验证）

### 方案 11 步 × 实际代码

| 步 | 计划内容 | 落地情况 |
|---|---|---|
| 1 | `src/lib/ai/` 基础层 | ✅ fetch/truncate/fallback/site-help 全在，另有 prompt/actions/weather/types |
| 2 | ai_knowledge 表 + seed + 管理端 | ✅ schema.sql:152 + seed.sql:65（工会/法援渠道）+ `/admin/knowledge` + 侧栏导航已挂 |
| 3 | `/api/ai/context` | ✅ 附近站点+在店人数+crowdHint；天气和风（WEATHER_API_KEY）→ wttr.in 兜底 |
| 4 | `/api/ai/chat` + `/api/ai/test` | ✅ 三档 key 来源、90s 超时、action 服务端二次校验（pointId/visitId 必须真实存在） |
| 5 | AiDock + 提供商管理 | ✅ `wj_ai_providers`，/admin 路径自动隐藏（AiDock.tsx:211） |
| 6 | 多会话 | ✅ SessionDrawer + `wj_ai_sessions` |
| 7 | 命令执行器 | ✅ action-executor.ts + ActionCard，zod 白名单 |
| 8 | 详情页「问小暖」 | ✅ PointDetailClient 按钮 → `wj-ai-open` CustomEvent 联动（容易漏：按钮在 Client 组件不在 page.tsx） |
| 9 | 天气接入 | ✅ 双通道；WEATHER_API_KEY 待配 Pages env |
| 10 | 管理端 AI 周报（T3） | ✅ /admin/visits「AI 周报」按钮，dataText 聚合走同一 /api/ai/chat |
| 11 | 视觉与无障碍 | ✅ 国风样式已融入（收尾以真机复查为准） |

### 质量门

- `tsc --noEmit` ✅ 通过（0 错误）
- 限流：ai_rate 表，每 IP 每分钟 20 次 ✅
- 远端失败 → 本地降级并在文本中如实标注 ✅

### 上线前待办（代码外的事）

1. `npm run db:migrate:safe:prod` —— 新增 ai_knowledge / ai_rate 两表（schema 幂等）
2. 知识库初始条目已并入 `npm run db:seed` 可重放的 INSERT（如需单独执行：`npx wrangler d1 execute warm-journey-db --remote --file=src/lib/db/seed.sql`）
3. Worker 环境变量：`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`（演示兜底，见 README 配置方式）
4. `npm run deploy`
5. 线上冒烟：有 key 问答 / 拔 key 降级 / 问小暖带站点上下文 / AI 周报 各验一次（`node scripts/smoke-routes.cjs <url>`）

### 已知边界（下一版再议）

- 流式输出（SSE）未做，长回复等待感明显
- 语音输入（蓝图 S5）未做
- crowdHint 为规则版预测（近 14 天同时段均值），未用模型

