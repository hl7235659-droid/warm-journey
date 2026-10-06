'use client';

// 徽章三态优先级：本机自带 Key > 服务端兜底 > 真离线。把后两者都写成「未配置」
// 正是线上小暖明明该走远端模型却被看成没配置的成因。
// 服务端那一档只说"已就绪"，不点名用的是哪家模型（/api/ai/status 也只做布尔值）。
import type { AiProvider, AiServerStatus } from '@/lib/ai/types';

export interface BadgeState {
  text: string;
  on: boolean;
  title: string;
  // 空态提示（ChatPanel 用）：null 表示不提示
  emptyHint: string | null;
}

export function badgeState(byok: AiProvider | null, server: AiServerStatus | null): BadgeState {
  const serverReady = server?.ready === true;
  return {
    text: byok
      ? byok.name
      : server === null
        ? '检查中…'
        : serverReady
          ? '服务端已就绪'
          : '离线模式',
    on: Boolean(byok) || serverReady,
    title: byok
      ? 'AI 提供商设置（当前使用本机自带 Key）'
      : serverReady
        ? '服务器端已配置模型兜底 · 点此可改用自己携带的 Key'
        : '本站未配置服务器端模型 · 小暖走本地知识库回答，点此可自带 Key 接大模型',
    emptyHint: byok || server === null
      ? null
      : serverReady
        ? '服务器端已配置模型，不用自带 Key，直接问就行'
        : '当前为离线模式 · 点顶栏「离线模式」添加 AI 提供商可获得完整能力',
  };
}

export default function ProviderBadge({ state, onOpen }: { state: BadgeState; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={`aidock-provider${state.on ? ' is-on' : ''}`}
      onClick={onOpen}
      title={state.title}
    >
      <span className="aidock-dot" aria-hidden="true" />
      {state.text}
    </button>
  );
}
