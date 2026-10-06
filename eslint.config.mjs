// ESLint flat config（Next 15 官方 FlatCompat 路线）。
// 目标：把"0 any、0 unused"从人工纪律变成 CI 强制（scripts 里 npm run lint → CI 闸 2）。
// 范围收敛：只 lint 第一方代码 src/ tests/；scripts/ 的 .cjs/.mjs 是构建期工具，
// 各自带运行时自检（断言 + fail-loud），不纳入（避免 legacy 脚本规则噪音）。
import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.open-next/**',
      '.wrangler/**',
      '.wrangler-verify/**',
      '.workbuddy*/**',
      'scripts/**',
    ],
  },
  // next/core-web-vitals：含 hooks 依赖、img 使用等 React 运行时正确性规则
  // next/typescript：ts 项目规则（no-explicit-any、no-unused-vars 等）
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // 项目现状决策（有注释依据的例外见各文件行内）：
      // @typescript-eslint/no-explicit-any 保持 error——全仓 0 any 是硬基线。
      // 图片全站用原生 <img>：静态资产由 Workers 资产层直出（public/_headers 缓存），
      // next/image 的默认优化器在 Workers 运行时不可用，此规则不适用（架构决策）。
      '@next/next/no-img-element': 'off',
      // ignoreRestSiblings：`const { created_ip, checkin_code, ...rest } = visit`
      // 是本项目脱敏的惯用法（visit-sanitize / visits 出口），被"剔除"的成员
      // 本来就不该被使用，属刻意 unused。varsIgnorePattern 兜底 `_` 前缀惯例。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
];
