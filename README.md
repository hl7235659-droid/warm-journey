# 暖途同行 🧡

**外卖骑手服务点信息平台** — 帮助外卖骑手快速找到附近的休息点、充电站和服务设施。

🌐 **在线访问**：https://warm-journey.pages.dev

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
- **运行时**：Cloudflare Workers (Edge Runtime)
- **数据库**：Cloudflare D1 (SQLite)
- **部署平台**：Cloudflare Pages
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

## 本地开发

### 环境要求

- Node.js 18+
- npm 或 pnpm

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 数据库操作

**创建本地数据库**
```bash
npx wrangler d1 create warm-journey-dev --local
```

**运行迁移**
```bash
npx wrangler d1 execute warm-journey-dev --local --file=src/lib/db/schema.sql
```

**填充测试数据**
```bash
npx wrangler d1 execute warm-journey-dev --local --file=src/lib/db/seed.sql
```

**查询数据**
```bash
npx wrangler d1 execute warm-journey-dev --local --command "SELECT * FROM service_points"
```

---

## 部署

### Cloudflare Pages 部署

项目已配置自动部署到 Cloudflare Pages。

**手动部署步骤**：

1. **登录 Cloudflare**
   ```bash
   npx wrangler login
   ```

2. **构建项目**
   ```bash
   npm run build
   ```

3. **生成 Cloudflare Pages 格式**
   ```bash
   npm run pages:build
   ```
   > Windows 上必须走这个脚本：`vercel build` 用 `fs.symlink()` 去重 `.func` 目录，
   > 未开开发者模式会报 EPERM 并中断，留下没有 `routes` 的 `config.json`，
   > 导致所有动态路由（`/point/[id]`、`/api/**/[id]`）线上返回 404。
   > `scripts/build-pages.cjs` 会把 symlink 降级为 junction（`mklink /J`）并校验路由非空。

4. **部署**
   ```bash
   npm run pages:deploy
   ```

### 生产数据库设置

**创建生产数据库**
```bash
npx wrangler d1 create warm-journey-prod
```

**运行生产迁移**（新增表后重跑一次即可，全部 `IF NOT EXISTS` 幂等）
```bash
npx wrangler d1 execute <DATABASE_ID> --remote --file=src/lib/db/schema.sql
npx wrangler d1 execute <DATABASE_ID> --remote --file=src/lib/db/seed.sql
```

**创建图片存储桶（上报/巡检照片）**
```bash
npx wrangler r2 bucket create warm-journey-images
```

**在 Cloudflare Dashboard 绑定数据库**：
1. 打开 Workers & Pages → warm-journey → Settings → Functions
2. D1 database bindings → 添加绑定
3. Variable name: `DB`
4. D1 database: 选择你的数据库
（R2 绑定 `BUCKET` 已写在 wrangler.toml，pages deploy 会自动带上）

### AI 助手（小暖）环境变量（可选，Cloudflare Pages 后台 Settings → Environment variables）

| 变量 | 用途 | 必需 |
|---|---|---|
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 演示兜底提供商（用户未在悬浮窗配置时的服务器端兜底，如 `https://api.deepseek.com/v1` / key / `deepseek-chat`） | 推荐 |
| `AI_ALLOWED_HOSTS` | BYOK 出站主机名白名单追加（逗号分隔）；默认只允许 `src/lib/ai/fetch.ts` 内置的主流 OpenAI 兼容域名 | 可选 |

天气不需要任何密钥：`/api/ai/context` 走 wttr.in 免费端点，取不到只少一段上下文文字。
用户在悬浮窗里添加任一 OpenAI 兼容提供商（地址以 `/v1` 结尾）+ 自己的 API Key，
Key 仅存浏览器 localStorage，永不提交服务器存储。无任何 Key 时小暖自动进入本地回答模式
（站点功能手册 / 附近驿站 / 站点实时数据 / 周报统计摘要），功能不中断。

### AI 接口频率限制

`/api/ai/*` 每 IP 每分钟 20 次（D1 `ai_rate` 表计数），超出返回友好提示。

---

## 管理后台

**默认账号**：
- 用户名：`admin`
- 密码：`admin123`

⚠️ **安全提醒**：首次部署后请立即修改默认密码！

**修改密码方法**：
```bash
# 1. 生成新密码的 bcrypt hash（使用 Node.js）
node -e "console.log(require('bcryptjs').hashSync('你的新密码', 10))"

# 2. 更新数据库
npx wrangler d1 execute <DATABASE_ID> --remote --command \
  "UPDATE admins SET password_hash = '<新的hash>' WHERE username = 'super_admin'"
```

---

## 项目结构

```
warm-journey/
├── src/
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
│   │   ├── db/                  # 数据库 schema 和 seed
│   │   └── types.ts             # TypeScript 类型定义
│   └── app/globals.css          # 全局样式（国风设计系统 + AI 悬浮窗 + 动效）
├── public/
│   └── images/                  # 生成视觉素材与驿站实景照
├── scripts/
│   └── patch-vercel-funcs.cjs   # Windows 符号链接修复脚本
├── wrangler.toml                # Cloudflare 配置
└── next.config.mjs              # Next.js 配置
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
- `cities` — 开通城市（筛选 + 地图视野中心）
- `admin_users` — 管理员账户（super_admin / admin / inspector）
- `ai_knowledge` — AI 助手业务知识库（权益政策/求助渠道/FAQ/公告，管理端维护）
- `ai_rate` — AI 接口频率限制（每 IP 每分钟窗口计数）

详见 [src/lib/db/schema.sql](src/lib/db/schema.sql)

---

## 开发笔记

### Edge Runtime 要求

页面与 API 路由都在 Cloudflare Pages（workerd）上运行，但声明位置只有一处是必需的：

- `src/app/layout.tsx` 声明一次 `export const runtime = 'edge'`，Next.js 让**页面路由**从 layout 继承该段配置，各 `page.tsx` 不必重复写；
- `src/app/api/**/route.ts` **各自声明**：route 段不属于页面，不继承 layout 的 runtime。

```typescript
export const runtime = 'edge';
```

### Windows 开发注意事项

Windows 下 `vercel build` 用符号链接去重 `.func` 目录，未开启开发者模式时会 EPERM 失败。
统一用 `npm run pages:build`，它通过 `scripts/win-symlink-shim.cjs` 把 symlink 降级为
目录 junction（`mklink /J`），无需管理员权限；`scripts/patch-vercel-funcs.cjs` 作为兜底修复。

### 示例数据

`src/lib/db/seed.sql` 内置 3 个广州大学城（番禺区小谷围岛）示例服务点，
用于本地演示和线上首屏。写入线上库：`npm run db:seed:prod`。

### 数据库访问

在 Cloudflare Workers 环境中通过 `env.DB` 访问 D1：

```typescript
import { getRequestContext } from '@cloudflare/next-on-pages';

export async function GET() {
  const { env } = getRequestContext();
  const result = await env.DB.prepare('SELECT * FROM service_points').all();
  return Response.json(result);
}
```

---

## 许可证

MIT License

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

**用心构建，温暖骑手的每一程旅途 🧡**
