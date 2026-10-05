'use client';
// 消息区 + 快捷指令 chips + 输入框（iOS 现代版式）
import { useEffect, useRef, useState } from 'react';
import type { AiAction, ChatMessage } from '@/lib/ai/types';
import ActionCard from './ActionCard';

interface ChatPanelProps {
  messages: ChatMessage[];
  sending: boolean;
  hasProvider: boolean;
  sessionPointId?: string;
  chips: string[];
  onSend: (text: string) => void;
  onExecuteAction: (action: AiAction, msgTs: number) => void;
}

// ── Markdown-lite：支持 **粗体**、- 无序列表、1. 有序列表、换行 ──
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={`${keyPrefix}-${i}`}>{p.slice(2, -2)}</strong>
      : <span key={`${keyPrefix}-${i}`}>{p}</span>,
  );
}

function MarkdownLite({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{renderInline(item, `li${key}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = /^[-•]\s+/.test(line.trim());
    const ol = /^\d+[.、]\s+/.test(line.trim());
    if (ul || ol) {
      const ordered = ol;
      const item = line.trim().replace(/^[-•]\s+|^\d+[.、]\s+/, '');
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push(item);
      continue;
    }
    flushList();
    if (line.trim() === '') { blocks.push(<div key={key++} className="aidock-md-gap" />); continue; }
    blocks.push(<p key={key++}>{renderInline(line, `p${key}`)}</p>);
  }
  flushList();
  return <div className="aidock-md">{blocks}</div>;
}

export default function ChatPanel({ messages, sending, hasProvider, sessionPointId, chips, onSend, onExecuteAction }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 新消息自动滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending]);

  function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    onSend(text);
  }

  const canSend = !sending && draft.trim().length > 0;

  return (
    <>
      <div className="aidock-msgs" aria-live="polite">
        {messages.length === 0 && !sending && (
          <div className="aidock-empty">
            <span className="aidock-empty-avatar" aria-hidden="true">
              <img src="/images/xiaonuan-avatar.webp" alt="" />
            </span>
            <div className="aidock-empty-title">有什么可以帮你？</div>
            <p className="aidock-empty-sub">
              {sessionPointId ? '正在为你关注这个站点，可以直接问它的情况。' : '找驿站、查在店人数、预约进店、解答平台问题，都可以问我。'}
            </p>
            {!hasProvider && (
              <p className="aidock-empty-hint">当前为离线模式 · 点顶栏「未配置」添加 AI 提供商可获得完整能力</p>
            )}
            <div className="aidock-chips">
              {chips.map((c) => (
                <button key={c} type="button" className="aidock-chip" onClick={() => onSend(c)}>{c}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={`${m.ts}-user`} className="aidock-row is-user">
              <div className="aidock-bubble is-user">{m.content}</div>
            </div>
          ) : (
            <div key={`${m.ts}-ai`} className="aidock-row">
              <div className="aidock-ai-block">
                <div className="aidock-ai-head">
                  <span className="aidock-avatar" aria-hidden="true"><img src="/images/xiaonuan-avatar.webp" alt="" /></span>
                  <span className="aidock-ai-name">小暖</span>
                  {m.mode === 'local' && <span className="aidock-mode-badge">离线</span>}
                </div>
                <div className="aidock-ai-body">
                  <MarkdownLite text={m.content} />
                </div>
                {m.action && (
                  <ActionCard
                    action={m.action}
                    done={m.actionDone}
                    onExecute={() => onExecuteAction(m.action as AiAction, m.ts)}
                  />
                )}
                <div className="aidock-msg-meta">AI 生成，仅供参考</div>
              </div>
            </div>
          ),
        )}

        {sending && (
          <div className="aidock-row">
            <div className="aidock-ai-block">
              <div className="aidock-ai-head">
                <span className="aidock-avatar" aria-hidden="true"><img src="/images/xiaonuan-avatar.webp" alt="" /></span>
                <span className="aidock-ai-name">小暖</span>
              </div>
              <div className="aidock-typing" aria-label="小暖正在输入">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="aidock-inputbar">
        <div className="aidock-inputwrap">
          <textarea
            ref={inputRef}
            className="aidock-input"
            rows={1}
            placeholder={sessionPointId ? '问问这个站点…' : '例如：附近哪有能充电的地方？'}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value.slice(0, 500));
              const el = e.target as HTMLTextAreaElement;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 88)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            aria-label="输入消息"
          />
          <button
            type="button"
            className={`aidock-send${canSend ? ' is-active' : ''}`}
            onClick={submit}
            disabled={!canSend}
            aria-label="发送"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
      <div className="aidock-foot">AI 生成内容仅供参考 · 法律/心理问题请以专业机构意见为准</div>
    </>
  );
}
