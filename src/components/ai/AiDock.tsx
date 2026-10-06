'use client';

// 小暖悬浮窗调度层：徽章/问候/抽屉渲染 + 发送链路 + action 执行。
// 面板拖拽与会话管理分别在 ./hooks.ts（usePanelDrag / useChatSessions），
// 纯逻辑（本地存储 / 上下文采集 / 命令执行）在 @/lib/ai/*。
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AiAction, AiServerStatus, ChatMessage, ProviderStore } from '@/lib/ai/types';
import { HISTORY_WINDOW } from '@/lib/ai/types';
import {
  loadProviders, saveProviders, activeProvider, appendMessage, setSessionTitle,
} from '@/lib/ai/ai-store';
import { getContext } from '@/lib/ai/ai-context';
import { executeAction, fetchKnowledgeFor } from '@/lib/ai/action-executor';
import { pickGreeting } from '@/lib/ai/persona';
import { api } from '@/lib/api-client';
import ChatPanel from './ChatPanel';
import ProviderDrawer from './ProviderDrawer';
import ProviderBadge, { badgeState } from './ProviderBadge';
import SessionDrawer from './SessionDrawer';
import { isDesktop, useChatSessions, usePanelDrag } from './hooks';

type DrawerKind = 'none' | 'providers' | 'sessions';

const DEFAULT_CHIPS = ['附近哪有位置？现在挤吗？', '怎么预约进店？', '帮我上报问题', '我需要法律援助'];
const POINT_CHIPS = ['这站靠谱吗？', '帮我预约进店', '现在去有位吗？', '我需要法律援助'];

export default function AiDock() {
  const pathname = usePathname();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerKind>('none');
  const [providerStore, setProviderStore] = useState<ProviderStore>({ providers: [], activeId: null });
  const [sending, setSending] = useState(false);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [server, setServer] = useState<AiServerStatus | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const serverQueriedRef = useRef(false);

  const {
    sessions, activeId, commit, ensureSession, bindPoint, getSession, getActiveSession,
    newSession: startSession, selectSession, renameSession, deleteSession, clearAll,
  } = useChatSessions();
  const { panelPos, onHeadPointerDown, onHeadPointerMove, onHeadPointerUp } = usePanelDrag(panelRef);

  // 徽章得知道服务器端有没有兜底提供商，否则"本机没填 Key"和"整站没接大模型"
  // 会显示成同一句「未配置」。只读环境变量、不查库不出站，故面板首次打开时查一次即可。
  useEffect(() => {
    if (!open || serverQueriedRef.current) return;
    serverQueriedRef.current = true;
    void api<AiServerStatus>('/api/ai/status').then((j) => {
      if (j.ok && j.data) setServer(j.data);
      else serverQueriedRef.current = false; // 失败放行下次重试
    });
  }, [open]);

  // 桌宠式问候：页面打开 1.2s 后弹出，14s 自动收起；打开面板即隐藏
  useEffect(() => {
    const showTimer = setTimeout(() => setGreeting(pickGreeting()), 1200);
    const hideTimer = setTimeout(() => setGreeting(null), 1200 + 14000);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, []);
  useEffect(() => { if (open) setGreeting(null); }, [open]);

  // 首帧从 localStorage 恢复本机提供商配置
  useEffect(() => {
    setProviderStore(loadProviders());
  }, []);

  // 详情页「问小暖」联动：wj-ai-open {pointId}
  useEffect(() => {
    const onAiOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ pointId?: string }>).detail;
      setOpen(true);
      setDrawer('none');
      if (detail?.pointId) bindPoint(detail.pointId);
    };
    window.addEventListener('wj-ai-open', onAiOpen);
    return () => window.removeEventListener('wj-ai-open', onAiOpen);
  }, [bindPoint]);

  // ---------- 发送链路 ----------
  const handleSend = useCallback(async (text: string) => {
    const content = text.trim();
    // 闸门必须同步：按钮的 disabled 与 sending state 都要等一次重渲染才生效，
    // 极速双击的两次点击会落进同一个 sending=false 的旧闭包连发两条（L4）。
    // 两次点击分属两个任务，所以任务内置位即可拦掉第二次。
    if (!content || sendingRef.current) return;
    const sid = ensureSession();

    // 历史窗口必须在追加本次提问之前算：commit 之后末位就是刚发的那条，
    // 再随请求 append 一次就是双发（B1）。
    const session = getSession(sid);
    const history = (session?.messages ?? [])
      .slice(-HISTORY_WINDOW)
      .map((m) => ({ role: m.role, content: m.content }));

    // 追加用户消息 + 自动起标题（单次 commit，避免中间态）
    commit((list) => {
      let base = list;
      const sess = base.find((s) => s.id === sid);
      if (sess && sess.messages.length === 0) base = setSessionTitle(base, sid, content);
      return appendMessage(base, sid, { role: 'user', content, ts: Date.now() });
    });
    sendingRef.current = true;
    setSending(true);

    try {
      const context = await getContext(); // 60s 缓存，位置会变时自动刷新
      const provider = activeProvider(providerStore);

      let assistant: ChatMessage;
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: provider && provider.apiKey
              ? { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model, temperature: provider.temperature }
              : undefined,
            messages: [...history, { role: 'user' as const, content }],
            pointId: session?.pointId,
            context: context ?? undefined,
          }),
        });
        const json = (await res.json()) as {
          ok: boolean; mode?: 'remote' | 'local'; text?: string; action?: AiAction; error?: string;
        };
        if (json.ok && json.text) {
          assistant = { role: 'assistant', content: json.text, action: json.action, mode: json.mode ?? 'remote', ts: Date.now() };
        } else {
          assistant = { role: 'assistant', content: json.error ?? '出了点问题，请稍后重试。', mode: 'local', ts: Date.now() };
        }
      } catch {
        assistant = { role: 'assistant', content: '网络异常，请检查网络后重试。', mode: 'local', ts: Date.now() };
      }
      commit((list) => appendMessage(list, sid, assistant));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [ensureSession, getSession, providerStore, commit]);

  // ---------- 操作执行 ----------
  // useCallback + 声明在前：handleExecuteAction 的依赖数组要引用它；
  // 体内只依赖 commit（setState 级稳定引用），不会引起回调重建。
  const markActionDone = useCallback((sessionId: string, msgTs: number) => {
    commit((list) => list.map((s) =>
      s.id !== sessionId ? s : {
        ...s,
        messages: s.messages.map((m) => (m.ts === msgTs && m.action ? { ...m, actionDone: true } : m)),
      },
    ));
  }, [commit]);

  const handleExecuteAction = useCallback(async (action: AiAction, msgTs: number) => {
    const session = getActiveSession();
    if (!session) return;

    // list_knowledge：拉取条目，作为新消息展示
    if (action.type === 'list_knowledge') {
      const text = await fetchKnowledgeFor(action);
      if (text) {
        commit((list) => appendMessage(list, session.id, { role: 'assistant', content: text, mode: 'local', ts: Date.now() }));
      }
      markActionDone(session.id, msgTs);
      return;
    }

    const result = await executeAction(action, (href) => router.push(href));
    markActionDone(session.id, msgTs);
    if (!result.ok && result.message) {
      commit((list) => appendMessage(list, session.id, { role: 'assistant', content: result.message, mode: 'local', ts: Date.now() }));
    }
  }, [router, commit, getActiveSession, markActionDone]);

  // ---------- 会话操作（抽屉联动部分留在调度层） ----------
  const handleNewSession = useCallback(() => {
    startSession();
    setDrawer('none');
  }, [startSession]);

  const handleSelectSession = useCallback((id: string) => {
    selectSession(id);
    setDrawer('none');
  }, [selectSession]);

  // 管理端不渲染
  if (pathname?.startsWith('/admin')) return null;

  const session = sessions.find((s) => s.id === activeId) ?? null;
  const provider = activeProvider(providerStore);

  const byok = provider && provider.apiKey ? provider : null;
  const badge = badgeState(byok, server);

  const panelStyle: React.CSSProperties | undefined =
    panelPos && isDesktop()
      ? { left: panelPos.x, top: panelPos.y, right: 'auto', bottom: 'auto', animation: 'none' }
      : undefined;

  return (
    <>
      {greeting && !open && (
        <div className="aidock-greet" role="status">
          <button
            type="button"
            className="aidock-greet-text"
            onClick={() => { setGreeting(null); setOpen(true); setDrawer('none'); }}
            aria-label="打开小暖对话"
          >
            {greeting}
          </button>
          <button
            type="button"
            className="aidock-greet-close"
            onClick={() => setGreeting(null)}
            aria-label="关闭问候"
          >
            ✕
          </button>
        </div>
      )}

      <button
        type="button"
        className={`aidock-btn${open ? ' is-open' : ''}`}
        onClick={() => { setOpen((v) => !v); setDrawer('none'); }}
        aria-label={open ? '收起小暖' : '打开小暖 AI 助手'}
        aria-expanded={open}
      >
        {open ? '✕' : <img src="/images/xiaonuan-head.webp" alt="" aria-hidden="true" />}
      </button>

      {open && (
        <div className="aidock-panel" role="dialog" aria-label="小暖 AI 助手" ref={panelRef} style={panelStyle}>
          {/* 顶栏（拖拽手柄） */}
          <div
            className="aidock-head"
            onPointerDown={onHeadPointerDown}
            onPointerMove={onHeadPointerMove}
            onPointerUp={onHeadPointerUp}
            onPointerCancel={onHeadPointerUp}
          >
            <ProviderBadge state={badge} onOpen={() => setDrawer('providers')} />
            <div className="aidock-head-title">
              <div className="aidock-title">小暖</div>
              <div className="aidock-sub">{session?.pointId ? '已关联当前站点' : '骑手驿站 AI 助手'}</div>
            </div>
            <div className="aidock-head-actions">
              <button type="button" className="aidock-icon-btn" onClick={() => setDrawer('sessions')} title={`会话列表（${sessions.length}）`} aria-label="会话列表">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              <button type="button" className="aidock-icon-btn" onClick={handleNewSession} title="新建会话" aria-label="新建会话">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
              <button type="button" className="aidock-icon-btn" onClick={() => { setOpen(false); setDrawer('none'); }} title="收起小暖" aria-label="关闭 AI 助手">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <ChatPanel
            messages={session?.messages ?? []}
            sending={sending}
            emptyHint={badge.emptyHint}
            sessionPointId={session?.pointId}
            chips={session?.pointId ? POINT_CHIPS : DEFAULT_CHIPS}
            onSend={handleSend}
            onExecuteAction={handleExecuteAction}
          />

          {drawer === 'providers' && (
            <ProviderDrawer
              store={providerStore}
              server={server}
              onChange={(next) => { setProviderStore(next); saveProviders(next); }}
              onClose={() => setDrawer('none')}
            />
          )}
          {drawer === 'sessions' && (
            <SessionDrawer
              sessions={sessions}
              activeId={activeId}
              onSelect={handleSelectSession}
              onRename={renameSession}
              onDelete={deleteSession}
              onClearAll={clearAll}
              onClose={() => setDrawer('none')}
            />
          )}
        </div>
      )}
    </>
  );
}
