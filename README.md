# 暖途同行 🧡

**外卖骑手服务点信息平台** — 帮助外卖骑手快速找到附近的休息点、充电站和服务设施。

🌐 **在线访问**：https://warm-journey.hosha-room.cloud（自有域，国内可直连）

> 备用入口 `https://warm-journey.hl7235659.workers.dev`（国内需代理）；
> 旧域名 `warm-journey.pages.dev`（批次 9 前的 Pages 部署）保留作回滚兜底，不再更新。
> 自定义域配置在 `wrangler.toml` 的 `routes`（Workers Custom Domains，
> 自动管理 DNS 与证书），如需更换域名改 pattern 后 `npx wrangler deploy` 即可。

---

## 项目简介

暖途同行是一个为外卖骑手设计的公益服务平台，提供：

- 📍 **服务点地图**：查看附近的骑手服务站
- 🔍 **筛选功能**：按服务类型、平台要求筛选
- 🚩 **问题上报**：骑手可上报服务点问题
- 🛠️ **管理后台**：管理员审核服务点和工单

### 功能特性

**C 端（骑手端）**
- 地图浏览所有服务点，按城市、状态、关键词筛选，定位距离排序，按服务项目（充电/热饭等）筛选
- 查看服务点详情（地址、营业时间、准入要求、站点近况信号）
- **预约进店**：预约占名额（保留 2 小时）→ 入店码到店确认 → 扫店内离店码离店，实时在店人数/名额条；入店 4 小时未离店自动释放名额
- **离店满意度卡片**：星级 + 希望的支持 + 改进建议（仿美团单车结束骑行）
- 上报服务点问题（可附现场照片，≤3 张），凭查询码免登录查处理进度
- 一键确认「信息无误」，收藏常用站点（本机保存）
- PWA：可加到主屏，离线可看已缓存的站点列表
- 驿站张贴二维码，微信/相机扫码直达详情页
- **AI 助手「小暖」**：全站悬浮窗（右下角朱砂印章），OpenAI 兼容接口（自定义 baseUrl + 模型名，自带 Key 仅存本机）、多会话；可问"附近哪有位置/现在挤吗"（附近站点 + 实时在店人数 + 近两周同时段客流提示）、详情页「问小暖」答站点口碑摘要（近 30 天评分/支持需求/建议原文）、法律援助等权益渠道指引（只引用知识库并附出处）；回复附带操作卡（跳转/筛选/导航/带路预约上报，写操作需确认）；**无 Key 或断网自动降级为本地回答**（站点功能手册 + 附近驿站 + 站点数据），法律/心理类只做渠道指引并提示咨询专业机构

**管理端**
- 数据看板（含在店人数、今日进店、离店评分）
- 服务点 CRUD + 变更历史 + 双二维码（门口详情码 / 店内离店码）
- **在店管理**：当前在店列表、强制离店、离店反馈查看；**AI 周报**（近 7 天反馈统计 + 支持需求分布 → 一键生成运营周报，无 Key 时输出统计摘要）
- **AI 知识库**：权益政策 / 求助渠道 / 常见问题 / 平台公告条目 CRUD，启用条目被小暖检索引用
- 上报审核（同一点位 ≥3 条待核实上报自动开工单）
- 工单系统、巡检记录（可附照片）
- 多城市管理（C 端城市筛选）
- 账号管理（super_admin 专属：建号/重置密码/改角色/删号，三级角色权限）

---

## 技术栈

- **前端框架**：Next.js 15 (App Router) + React 19
- **样式**：CSS 自定义属性（朱砂·宣纸·描金 国风设计系统）+ gpt-image-2 生成素材
- **运行时**：Cloudflare Workers（workerd，`nodejs_compat`）
- **适配器**：[@opennextjs/cloudflare](https://opennext.js.org/cloudflare)（Next.js → Workers）
- **数据库**：Cloudflare D1 (SQLite)
- **对象存储**：Cloudflare R2（上报/巡检照片）
- **部署**：`wrangler deploy`（Workers + Static Assets）
- **语言**：TypeScript

### 视觉设计（挑战杯路演风格）

- 整页即一张"幻灯片"：鎏金桌面底 + 米纸 slide + 描金角花 + 硬投影
- 朱红绸纹红头横幅、书法标题、双环圆章数据组、八角签条、燕尾缎带标题、朱框装裱封面
- 生成素材位于 `public/images/`（gpt-image-2 出图）：驿站实景照与国风插画占位、书法标题、
  金梅枝、如意角花、朱红绸纹与鎏金桌面底纹、带底 logo
- 字体：Noto Serif / Noto Sans SC（正文），ZCOOL XiaoWei（展示），Ma Shan Zheng（笔刷）
- 动效：印章盖章、圆章弹入 + 数字滚动、笔锋自绘、滚动错峰揭示；
  `prefers-reduced-motion` 下全部关闭

---

## 构建链历史（知识保全）

2026-10 之前本项目用 `@cloudflare/next-on-pages`（已 deprecated）+ `vercel build` 部署到
Cloudflare Pages，Windows 上需要三层猴补丁（symlink junction 降级 / npm.cmd spawn 修补 /
运行时守卫注入）才能出包。期间发生过两次生产事故，根因均出在这条链上：

1. **2026-10-05 生产 500**：一次 `npm install` 把 next-on-pages 按 lockfile 降级回 1.13.10，
   丢失 `__import_unsupported` 幂等守卫，Pages 同 isolate 内第二个起加载的路由全部
   `Cannot redefine property` 500；
2. **2026-10-06 首页 Not Found**：1.13.10 同时丢失 `/` → index 的路由映射，首页返回
   200 + 纯文本 "Not Found"，其余页面正常，极具迷惑性。

2026-10-06（批次 9）整体迁移到官方维护的 `@opennextjs/cloudflare`（Workers + Static
Assets），`vercel`、next-on-pages、三层补丁、`.npmrc legacy-peer-deps` 全部退场。两次事故
的完整取证与修复过程见 git 历史中的 `scripts/build-pages.cjs`（批次 9 前的最后版本）与
《过度设计修复计划-2026-10-06.md》批次 1/9 回写。

---

## 本地开发

### 环境要求

- Node.js ≥ 22.6（`npm test` 依赖 `--experimental-strip-types`；wrangler 4 亦要求 node 22+）
- npm

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

`next dev` 由 `next.config.mjs` 里的 `initOpenNextCloudflareForDev()` 注入本地 Cloudflare
bindings（D1/R2），数据落在 `.wrangler/` 下。访问 http://localhost:3000

本地密钥（如 `JWT_SECRET`）写在根目录 `.dev.vars`（已被 .gitignore 忽略），格式：

```
JWT_SECRET=<任意随机串>
```

### 数据库操作

本地库名 `warm-journey-db`（绑定写在 wrangler.toml，`--local` 即本地状态，无需真实建库）：

```bash
npm run db:migrate      # 建表（schema.sql，全部 IF NOT EXISTS，可重放）
npm run db:seed         # 基础示例数据（见下方「示例数据」）
npm run db:seed:demo    # 演示客流（仅本地，见下方警告）

# 查询
npx wrangler d1 execute warm-journey-db --local --command "SELECT id,name FROM service_points"
```

### 测试

```bash
npm test             # scripts/tests/ 下的纯函数单测（SSRF 白名单 / 分页钳制 / admission 结构化等）
npm run test:workers # tests/workers/ 下跑在真实 workerd + 真实 D1 的用例（withAdmin 守卫 / visit 状态机 / 容量并发 / 出口脱敏 / AI 降级）
```

`test:workers` 用 vitest-pool-workers，绑定来自 `wrangler.test.toml`（与生产同名的 DB / BUCKET，
但 main 指向 `tests/workers/entry.ts`，因此**不需要先跑 OpenNext 构建**）；每个测试文件一份独立库，
建库直接读 `src/lib/db/schema.sql`，所以 schema 改了不必迁移测试夹具。

### 本地运行生产构建（Workers 运行时）

```bash
npm run preview    # OpenNext 构建 + wrangler dev（与线上同运行时）
```

---

## 部署

### 部署到 Cloudflare Workers

```bash
npx wrangler login        # 首次
npm run deploy            # 预检 → 构建 → wrangler deploy
```

`npm run deploy`（`scripts/deploy.cjs`）的预检会在部署前核实：

1. 远程 D1 具备代码硬依赖的列与表（缺则提示先跑 `npm run db:migrate:safe:prod`）；
2. Worker secret 里已有 `JWT_SECRET`。

首次部署一个全新环境时的顺序：

```bash
npx wrangler d1 create warm-journey-db          # 生产库（已有则跳过）
npx wrangler r2 bucket create warm-journey-images
# 把得到的 database_id 填进 wrangler.toml 的 [[d1_databases]]
npm run db:migrate:safe:prod                    # 建表（幂等，只补缺失项）
npx wrangler secret put JWT_SECRET              # 粘贴 openssl rand -hex 32 的输出
npx wrangler secret put AI_API_KEY              # 服务端兜底模型密钥（可选，见下方「AI 助手环境变量」）
npm run deploy
```

D1/R2 绑定、Cron、静态资产目录都声明在 `wrangler.toml`，`wrangler deploy` 自动带上，
无需在 Dashboard 手工配置。

**回滚**：`npx wrangler rollback`（回到上一版本），或 Dashboard → Workers → warm-journey
→ Deployments 秒级回退；另有旧 Pages 域名整站兜底（见文首）。

### 生产数据库迁移

```bash
npm run db:migrate:safe:prod    # 探针式补列/补表，只执行缺失项，可重放
```

**不要**对生产库直接执行 `db:seed:demo`（demo 客流会污染在店人数与看板数字）；
误跑后按固定主键 `demo000visit*` / `demofdbk*` 删除即可。

### AI 助手（小暖）环境变量（可选）

`AI_BASE_URL` / `AI_MODEL` 是非敏感项，直接写在 `wrangler.toml` 的 `[vars]`，随 `wrangler deploy` 生效；
`AI_API_KEY` 必须走 secret：`npx wrangler secret put AI_API_KEY`（`npm run deploy` 的预检会在缺少它时打印提醒）。
BYOK 优先：用户在悬浮窗自带 Key 时不消耗下表配置，也不占全站日额。

| 变量 | 用途 | 必需 |
|---|---|---|
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 演示兜底提供商（用户未在悬浮窗配置时的服务器端兜底，如 `https://api.deepseek.com/v1` / key / `deepseek-chat`） | 推荐 |
| `AI_ALLOWED_HOSTS` | BYOK 出站主机名白名单追加（逗号分隔）；默认只允许 `src/lib/ai/fetch.ts` 内置的主流 OpenAI 兼容域名 | 可选 |

**三件套缺任何一件，小暖就只用本地知识库回答**，判据是 `resolveServerProvider()`（`src/lib/ai/fetch.ts`），
`/api/ai/chat` 与 `/api/ai/status` 共用它——批次 9 从 Pages 迁 Workers 时这三个变量没跟过来，
线上静默退化过一次，而界面上一切正常。

界面口径：悬浮窗顶栏徽章三态是「本机提供商名 / 服务端已就绪 / 离线模式」，
`/api/ai/status` 只下发 `ready` 布尔值，**不对外暴露服务端用的是哪家模型**（`ChatResponse` 里也不带 `model`）。
用户在悬浮窗里添加任一 OpenAI 兼容提供商（地址以 `/v1` 结尾）+ 自己的 API Key，
Key 仅存浏览器本机（元数据在 localStorage、Key 只进 sessionStorage），永不提交服务器存储。
无任何 Key 时小暖自动进入本地回答模式（站点功能手册 / 附近驿站 / 站点数据 / 周报统计摘要），功能不中断。

天气不需要任何密钥：`/api/ai/context` 走 wttr.in 免费端点，取不到只少一段上下文文字。

### AI 接口频率限制

计数都写在 D1 的 `ai_rate` 表里，双窗口加权（等效滑动窗口，消除窗口交界处的 2 倍突刺）。

| 范围 | 额度 | 说明 |
|---|---|---|
| `/api/ai/chat` 每 IP | 每分钟 20 次，每日 200 次 | 两条都在转发前拦，超出返回 429 + 友好文案 |
| `/api/ai/chat` 全站 | 每日 3000 次 | **仅约束服务端 `AI_*` 密钥转发的请求**；用户自带 Key（BYOK）烧自己的额度，不占全站计数 |
| 其余 `/api/ai/*` 与各写接口 | 各自独立计数 | 如上报每 IP 每小时 20 条、入店码/预约查询每 IP 每分钟 20 次 |

### 数据周期清理（Cron，已自动化）

`uploads`（上传台账，保留 30 天）与 `ai_rate`（限流计数，保留 7 天）由 Worker 的
Cron Trigger 每日 UTC 03:00 自动清理（`src/worker.ts` 的 scheduled handler，同时兜底跑
一次过期预约/超时在店的懒清理）。`wrangler.toml [triggers]` 随部署自动注册，无需手工调度。

`ai_rate` 另有内联的概率式摊销清理（每次计数 1/60 概率删 7 天前的行），与 Cron 互补。

R2 里的图片对象**不要**配"按上传时间 N 天过期"的生命周期规则：上报/巡检图片是长期展示的，
一条 30 天 TTL 会把仍被引用的老图删成死链。孤儿对象有两个来源，各自的处理：

- 台账（`uploads`）写失败 → 路由当场删除刚上传的对象再返回 500（`src/app/api/upload/route.ts`），
  这是已实现的闸门，不留这类孤儿。
- 上传成功但从未被任何上报/巡检引用 → 需要对照台账与 `reports.images` / `inspections.images`
  清理，**挂账运维项 `scripts/cleanup-r2.mjs`（尚未实现）**：只删超 30 天且未被引用的 key，
  删前先 dry-run 打印清单。在这脚本落地前，这类孤儿只是缓慢占用容量，无功能影响。

### 部署后冒烟

```bash
# 同一实例多路由连打，防同 isolate 跨路由冲突与"状态码对但内容错"
node scripts/smoke-routes.cjs https://warm-journey.hosha-room.cloud
# 访问 workers.dev 备用入口时（国内被墙）走代理：
HTTPS_PROXY=http://127.0.0.1:7897 node scripts/smoke-routes.cjs https://warm-journey.hl7235659.workers.dev
```

---

## 管理后台

没有默认账号：`seed.sql` 不含任何管理员。首个账号用脚本创建：

```bash
npm run admin:create            # 本地库（交互式输入，明文会回显）
npm run admin:create:prod       # 生产库
```

生产/共享环境一律用环境变量传值，避免明文回显：

```bash
ADMIN_USERNAME=nuantu ADMIN_PASSWORD='强口令' ADMIN_ROLE=super_admin \
  ADMIN_DISPLAY_NAME=刘晗 npm run admin:create:prod
```

角色三级（`super_admin` / `admin` / `inspector`），建号脚本会校验；口令只以 bcrypt hash 入库，
明文不落任何文件。`seed-ops` 造数时按库内已有管理员给工单、巡检、点位历史分配归属人，
所以**先建号再造数**，否则脚本会拒绝执行。

**修改密码**（表名是 `admin_users`；`super_admin` 是 role 值不是用户名）：

```bash
# 1. 生成 bcrypt hash
node -e "console.log(require('bcryptjs').hashSync('你的新密码', 10))"

# 2. 按用户名更新
npx wrangler d1 execute warm-journey-db --remote \
  --command "UPDATE admin_users SET password_hash = '<新的hash>' WHERE username = '<用户名>'"
```

---

## 项目结构

```
warm-journey/
├── src/
│   ├── worker.ts                # Worker 入口：复用 OpenNext fetch + scheduled(Cron GC)
│   ├── app/                     # Next.js App Router 路由
│   │   ├── page.tsx             # C 端首页（slide 版式）
│   │   ├── point/[id]/          # 服务点详情 / 上报
│   │   ├── admin/               # 管理后台（含 knowledge 知识库、visits AI 周报）
│   │   └── api/                 # API 路由（ai/chat|context|test|knowledge 等）
│   ├── components/
│   │   ├── ai/                  # AI 助手「小暖」悬浮窗（AiDock/ChatPanel/抽屉/操作卡）
│   │   └── ornaments.tsx        # 梅枝 / 角花 / 笔锋线共用装饰
│   ├── lib/
│   │   ├── ai/                  # AI 基础库（prompt 组装/降级/action 协议/天气/截断）
│   │   ├── covers.ts            # 站点封面图映射（实景 / 插画占位）
│   │   ├── db/                  # 数据库访问层 / schema / seed
│   │   └── types.ts             # TypeScript 类型定义
│   └── app/globals.css          # 全局样式（国风设计系统 + AI 悬浮窗 + 动效）
├── public/
│   ├── _headers                 # 静态资产层缓存规则（_next/static、images 长缓存）
│   └── images/                  # 生成视觉素材与驿站实景照
├── scripts/
│   ├── deploy.cjs               # 部署入口（预检 + 构建 + wrangler deploy）
│   ├── migrate.cjs              # 探针式迁移（本地/生产，只补缺失项）
│   ├── create-admin.mjs         # 管理员建号
│   ├── smoke-routes.cjs         # 多路由冒烟（支持 HTTPS_PROXY）
│   └── tests/                   # 单元测试（纯函数，node --test）
├── tests/
│   └── workers/                 # workerd + 真实 D1 回归用例（见 npm run test:workers）
├── open-next.config.ts          # OpenNext 适配器配置
├── wrangler.toml                # Worker 配置（绑定/Cron/资产目录）
├── wrangler.test.toml           # 测试 Worker 配置（同名绑定，不依赖构建产物）
└── next.config.mjs              # Next.js 配置（含 dev bindings 注入）
```

---

## 数据库 Schema

### 主要表

- `service_points` — 服务点信息
- `reports` — 问题上报（images 存 R2 key）
- `work_orders` — 工单（≥3 条待核实上报自动创建）
- `inspections` — 巡检记录
- `point_history` — 服务点变更历史
- `point_confirms` — 骑手「信息无误」确认
- `visits` — 预约/入店记录（reserved→in_store→completed，预约 2 小时过期）
- `visit_feedback` — 离店满意度反馈（星级/支持标签/建议，一次 visit 一条）
- `uploads` — 上传台账（R2 key 记账，Cron 30 天回收）
- `cities` — 开通城市（筛选 + 地图视野中心）
- `admin_users` — 管理员账户（super_admin / admin / inspector）
- `ai_knowledge` — AI 助手业务知识库（权益政策/求助渠道/FAQ/公告，管理端维护）
- `ai_rate` — AI 接口频率限制（每 IP 每分钟窗口计数，Cron 7 天回收）

详见 [src/lib/db/schema.sql](src/lib/db/schema.sql)

---

## 开发笔记

### 运行时：不要声明 edge runtime

本项目跑在 Workers（workerd + `nodejs_compat`）上，OpenNext **不支持** `export const
runtime = 'edge'`（构建直接失败）。路由不用声明任何 runtime——默认（nodejs）即是正确值。

### Windows 开发

OpenNext 构建不走 `vercel build`，不碰 symlink，Windows 上无需任何补丁脚本
（旧链的 `win-symlink-shim.cjs` 等已随批次 9 退场，见「构建链历史」）。

### 示例数据

三份 seed，风险等级不同，按名字区分：

| 文件 | 内容 | 可执行环境 |
|---|---|---|
| `src/lib/db/seed.sql` | 3 个广州大学城（番禺区小谷围岛）示例服务点 + 1 个开通城市 + 6 条 AI 知识库条目，全 `INSERT OR IGNORE` | 本地 / 预览 / 生产皆可 |
| `src/lib/db/seed-demo.sql` | 11 条 demo visits（含一条 `in_store`）+ 10 条 demo 反馈，专为 T1 客流提示 / T2 口碑摘要 / T3 AI 周报造数据 | **仅本地演示，禁止对生产库执行** |
| `scripts/seed-ops.mjs` | **合成**的半年运营流水：约 2150 visits + 1200 离店反馈 + 57 上报 + 43 工单 + 22 巡检 + 512 骑手确认 + 19 条点位变更历史 + 12 条知识库，并回填 3 个点位的建档/复核/更新时间 | 本地与生产皆可，但写出去的全是假数据 |

```bash
npm run db:seed             # 基础数据（本地库）
npm run db:seed:demo        # 演示客流小样（本地库，会污染在店人数与看板数字）
npm run db:seed:ops         # 半年流水（本地库）
npm run db:seed:ops:prod    # 半年流水（生产库）
```

`seed-ops` 是给路演用的，不是真实业务记录：脚本头注释写明了这一点，它写入的每一行主键都以
`ops` 开头（实时尾部以 `opslive` 开头），表内 IP 全是虚拟值。

```bash
npm run db:seed:ops:purge:prod                    # 按 ops* 前缀精确删除，不碰真实数据与 demo* 行
node scripts/seed-ops.mjs --remote --live-only    # 只重造"当前在店 / 有效预约 / 今日进店"
node scripts/seed-ops.mjs --dry out.sql           # 只生成 SQL 不执行
```

`--remote` 的任何写操作（造数 / 刷新实时尾部 / purge）都会先要求你**手动输入 `prod`** 确认，
输入其他内容即取消；`--dry` 只读不写，不受此闸约束。非交互环境（CI、管道、重定向 stdin）
会直接拒绝执行，这时才显式加 `--yes`：

```bash
npm run db:seed:ops:prod -- --yes                 # 明知是生产库、跳过确认
node scripts/seed-ops.mjs --remote --yes --purge
```

路演清单里固定一条：**路演结束当天执行 `npm run db:seed:ops:purge:prod`**。合成数据长期留在
生产库会污染真实运营统计（看板数字、AI 周报、口碑均分都会把它算进去）。

`--live-only` 不是锦上添花：`expireStaleVisits` 挂在所有读路径上，预约 2 小时过期、入店 4 小时
自动离店，"当前在店"必然随时间归零，开场前重跑一次即可（约 10 秒）。数据时间全部按执行时刻回推，
任何时候跑都是"刚刚过去了 180 天"；脚本先 purge 再写，重复执行不会攒出两份。

误把 demo 跑进生产后的清理办法：按固定主键 `demo000visit*` / `demofdbk*` 删除即可。

### 数据库访问

服务端代码统一用 OpenNext 的 `getCloudflareContext()` 拿 bindings（`env.DB` 即 D1）：

```typescript
import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function GET() {
  const { env } = getCloudflareContext();
  const points = await env.DB.prepare('SELECT id, name FROM service_points').all();
  return Response.json({ ok: true, data: points });
}
```

管理端路由不必手写这行——`withAdmin()`（`src/lib/http.ts`）已统一注入 `env` 与鉴权。

---

## 许可证

MIT License

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

**用心构建，温暖骑手的每一程旅途 🧡**
