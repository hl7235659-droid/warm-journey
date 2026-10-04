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
- 地图浏览所有服务点
- 按城市、服务类型筛选
- 查看服务点详情（地址、营业时间、准入要求）
- 上报服务点问题

**管理端**
- 服务点 CRUD 管理
- 问题上报审核
- 工单系统
- 巡检记录
- 变更历史追踪

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

**运行生产迁移**
```bash
npx wrangler d1 execute <DATABASE_ID> --remote --file=src/lib/db/schema.sql
npx wrangler d1 execute <DATABASE_ID> --remote --file=src/lib/db/seed.sql
```

**在 Cloudflare Dashboard 绑定数据库**：
1. 打开 Workers & Pages → warm-journey → Settings → Functions
2. D1 database bindings → 添加绑定
3. Variable name: `DB`
4. D1 database: 选择你的数据库

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
│   │   ├── admin/               # 管理后台
│   │   └── api/                 # API 路由
│   ├── components/
│   │   └── ornaments.tsx        # 梅枝 / 角花 / 笔锋线共用装饰
│   ├── lib/
│   │   ├── covers.ts            # 站点封面图映射（实景 / 插画占位）
│   │   ├── db/                  # 数据库 schema 和 seed
│   │   └── types.ts             # TypeScript 类型定义
│   └── app/globals.css          # 全局样式（国风设计系统 + 动效）
├── public/
│   └── images/                  # 生成视觉素材与驿站实景照
├── scripts/
│   ├── add-edge-runtime.cjs     # 自动添加 edge runtime 声明
│   └── patch-vercel-funcs.cjs   # Windows 符号链接修复脚本
├── wrangler.toml                # Cloudflare 配置
└── next.config.mjs              # Next.js 配置
```

---

## 数据库 Schema

### 主要表

- `service_points` — 服务点信息
- `reports` — 问题上报
- `work_orders` — 工单
- `inspections` — 巡检记录
- `point_history` — 服务点变更历史
- `admins` — 管理员账户

详见 [src/lib/db/schema.sql](src/lib/db/schema.sql)

---

## 开发笔记

### Edge Runtime 要求

所有页面和 API 路由必须声明 edge runtime：

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
