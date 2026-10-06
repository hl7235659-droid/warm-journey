'use client';
// 会话列表抽屉：选择 / 重命名 / 删除单个会话，或清空全部
import type { ChatSession } from '@/lib/ai/types';
import { formatCNDate } from '@/lib/format';

interface Props {
  sessions: ChatSession[]; // 已按 updatedAt 倒序
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 相对时间交给平台：Intl.RelativeTimeFormat(numeric:'auto') 自带"昨天"这类说法，
// 超过 7 天仍回到具体日期（formatCNDate，与 admin 各列表页时间列同族）
const RELATIVE = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return RELATIVE.format(-Math.floor(diff / MINUTE), 'minute');
  if (diff < DAY) return RELATIVE.format(-Math.floor(diff / HOUR), 'hour');
  if (diff < 7 * DAY) return RELATIVE.format(-Math.floor(diff / DAY), 'day');
  return formatCNDate(new Date(ts));
}

export default function SessionDrawer({
  sessions,
  activeId,
  onSelect,
  onRename,
  onDelete,
  onClearAll,
  onClose,
}: Props) {
  function rename(s: ChatSession) {
    const next = window.prompt('重命名会话', s.title);
    if (next === null) return;
    const t = next.trim();
    if (t) onRename(s.id, t);
  }

  function remove(s: ChatSession) {
    if (confirm('删除该会话？')) onDelete(s.id);
  }

  function clearAll() {
    if (confirm('确定清空全部会话记录？此操作不可恢复')) onClearAll();
  }

  return (
    <div className="aidock-drawer is-open">
      <div className="aidock-drawer-head">
        <button type="button" className="aidock-mini-btn" onClick={onClose}>
          ← 返回
        </button>
        <span className="aidock-drawer-title">会话列表</span>
      </div>

      <div className="aidock-drawer-body">
        {sessions.length === 0 && (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>暂无历史会话</p>
        )}

        {sessions.map((s) => (
          <div key={s.id} className={activeId === s.id ? 'aidock-item is-active' : 'aidock-item'}>
            <div
              className="aidock-item-main"
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(s.id);
                }
              }}
            >
              <div className="aidock-item-title">{s.title}</div>
              <div className="aidock-item-sub">
                {s.messages.length} 条对话 · {relativeTime(s.updatedAt)}
              </div>
            </div>
            <div className="aidock-item-actions">
              <button type="button" className="aidock-mini-btn" onClick={() => rename(s)}>
                重命名
              </button>
              <button type="button" className="aidock-mini-btn is-danger" onClick={() => remove(s)}>
                删除
              </button>
            </div>
          </div>
        ))}

        {sessions.length > 0 && (
          <div>
            <button type="button" className="btn btn-danger btn-sm" onClick={clearAll}>
              清空全部会话
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
