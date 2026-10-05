'use client';
// AI 操作确认卡：展示一条待执行的行动，由用户点击确认后交给父组件执行
import type { AiAction, AiActionType } from '@/lib/ai/types';

interface Props {
  action: AiAction;
  done?: boolean;
  onExecute: () => void;
}

// 各操作类型的中文标签
const LABELS: Record<AiActionType, string> = {
  navigate: '打开站点详情',
  filter: '去筛选站点',
  reserve: '去预约进店',
  report: '去上报问题',
  route: '开始导航',
  list_knowledge: '查看知识条目',
};

// 各操作类型的图标（简洁线性 SVG path）
const ICONS: Record<AiActionType, string> = {
  navigate: 'M12 21s-7-5.1-7-11a7 7 0 1 1 14 0c0 5.9-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  reserve: 'M8 7V5a4 4 0 1 1 8 0v2M5 7h14l-1 14H6L5 7z',
  report: 'M4 21V4m0 1h13l-2.5 4L17 13H4',
  route: 'M9 20l-5.5-2.5v-13L9 7l6-2.5 5.5 2.5v13L15 17.5 9 20zM9 7v13M15 4.5v13',
  list_knowledge: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
};

// 写操作（会产生真实副作用）需要用户二次确认
const WRITE_ACTIONS: AiActionType[] = ['reserve', 'report'];

export default function ActionCard({ action, done, onExecute }: Props) {
  const base = LABELS[action.type] ?? '执行操作';
  const isWrite = WRITE_ACTIONS.includes(action.type);
  const iconPath = ICONS[action.type] ?? ICONS.navigate;

  return (
    <div className={done ? 'aidock-action is-done' : 'aidock-action'}>
      <span className="aidock-action-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d={iconPath} />
        </svg>
      </span>
      <span className="aidock-action-label">{base}{isWrite ? '（需确认）' : ''}</span>
      {done ? (
        <span className="aidock-action-done">✓ 已执行</span>
      ) : (
        <button type="button" className="aidock-action-btn" onClick={onExecute}>
          {isWrite ? '确认执行' : '一键前往'}
        </button>
      )}
    </div>
  );
}
