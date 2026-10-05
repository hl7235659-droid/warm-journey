'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AiAction, ChatMessage, ChatSession, ProviderStore } from '@/lib/ai/types';
import { HISTORY_WINDOW } from '@/lib/ai/types';
import {
  loadProviders, saveProviders, activeProvider, loadSessions, saveSessions,
  newSession, appendMessage, setSessionTitle, deleteSession,
} from './ai-store';
import { getContext } from './ai-context';
import { executeAction, fetchKnowledgeFor } from './action-executor';
import { pickGreeting } from '@/lib/ai/persona';
import ChatPanel from './ChatPanel';
import ProviderDrawer from './ProviderDrawer';
import SessionDrawer from './SessionDrawer';

type DrawerKind = 'none' | 'providers' | 'sessions';

const DEFAULT_CHIPS = ['附近哪有位置？现在挤吗？', '怎么预约进店？', '帮我上报问题', '我需要法律援助'];
const POINT_CHIPS = ['这站靠谱吗？', '帮我预约进店', '现在去有位吗？', '我需要法律援助'];

// 面板可拖动（桌面端）：null = 默认锚定右下角
interface PanelPos { x: number; y: number }

export default function AiDock() {
  const pathname = usePathname();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerKind>('none');
  const [providerStore, setProviderStore] = useState<ProviderStore>({ providers: [], activeId: null });
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; lastX?: number; lastY?: number } | null>(null);

  // 桌宠式问候：页面打开 1.2s 后弹出，14s 自动收起；打开面板即隐藏
  useEffect(() => {
    const showTimer = setTimeout(() => setGreeting(pickGreeting()), 1200);
    const hideTimer = setTimeout(() => setGreeting(null), 1200 + 14000);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, []);
  useEffect(() => { if (open) setGreeting(null); }, [open]);

  // sessionsRef 是唯一数据源：commit 内同步更新，避免连续更新读到 stale 快照
  const sessionsRef = useRef<ChatSession[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const hydrated = useRef(false);

  const setActiveIdBoth = useCallback((id: string | null | ((cur: string | null) => string | null)) => {
    setActiveId((prev) => {
      const next = typeof id === 'function' ? (id as (cur: string | null) => string | null)(prev) : id;
      activeIdRef.current = next;
      return next;
    });
  }, []);

  // 会话提交：ref 即时更新 + 持久化 + 同步 React state
  const commit = useCallback((fn: (list: ChatSession[]) => ChatSession[]) => {
    const next = saveSessions(fn(sessionsRef.current));
    sessionsRef.current = next;
    setSessions(next);
    setActiveIdBoth((cur) => (next.some((s) => s.id === cur) ? cur : next[0]?.id ?? null));
  }, [setActiveIdBoth]);

  // 首帧从 localStorage 恢复
  useEffect(() => {
    setProviderStore(loadProviders());
    const ss = loadSessions();
    sessionsRef.current = ss;
    setSessions(ss);
    if (ss.length > 0) setActiveIdBoth(ss[0].id);
    hydrated.current = true;
  }, [setActiveIdBoth]);

  // 会话不存在时懒创建（保留 pointId 上下文），返回会话 id
  const ensureSession = useCallback((pointId?: string): string => {
    const cur = sessionsRef.current.find((s) => s.id === activeIdRef.current);
    if (cur) return cur.id;
    const s = newSession(pointId);
    commit((list) => [...list, s]);
    setActiveIdBoth(s.id);
    return s.id;
  }, [commit, setActiveIdBoth]);

  // 详情页「问小暖」联动：wj-ai-open {pointId}
  useEffect(() => {
    const onAiOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ pointId?: string }>).detail;
      setOpen(true);
      setDrawer('none');
      if (detail?.pointId) {
        const cur = sessionsRef.current.find((s) => s.id === activeIdRef.current);
        if (!cur || (cur.messages.length > 0 && cur.pointId !== detail.pointId)) {
          // 无会话或当前会话已绑定别处 → 开新会话并激活
          const s = newSession(detail.pointId);
          s.title = '问小暖';
          commit((list) => [...list, s]);
          setActiveIdBoth(s.id);
        } else if (cur.pointId !== detail.pointId) {
          // 空会话 → 直接绑定
          commit((list) => list.map((x) => (x.id === cur.id ? { ...x, pointId: detail.pointId } : x)));
        }
      }
    };
    window.addEventListener('wj-ai-open', onAiOpen);
    return () => window.removeEventListener('wj-ai-open', onAiOpen);
  }, [commit]);

  // ---------- 发送链路 ----------
  const handleSend = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    const sid = ensureSession();

    // 历史窗口必须在追加本次提问之前算：commit 之后末位就是刚发的那条，
    // 再随请求 append 一次就是双发（B1）。
    const session = sessionsRef.current.find((s) => s.id === sid);
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
      setSending(false);
    }
  }, [ensureSession, providerStore, sending, commit]);

  // ---------- 操作执行 ----------
  const handleExecuteAction = useCallback(async (action: AiAction, msgTs: number) => {
    const session = sessionsRef.current.find((s) => s.id === activeIdRef.current);
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

    const result = await executeAction(action, { push: (href) => router.push(href) });
    markActionDone(session.id, msgTs);
    if (!result.ok && result.message) {
      commit((list) => appendMessage(list, session.id, { role: 'assistant', content: result.message, mode: 'local', ts: Date.now() }));
    }
  }, [router, commit]);

  function markActionDone(sessionId: string, msgTs: number) {
    commit((list) => list.map((s) =>
      s.id !== sessionId ? s : {
        ...s,
        messages: s.messages.map((m) => (m.ts === msgTs && m.action ? { ...m, actionDone: true } : m)),
      },
    ));
  }

  // ---------- 会话操作 ----------
  const handleNewSession = useCallback(() => {
    const cur = sessionsRef.current.find((s) => s.id === activeIdRef.current);
    const s = newSession(cur?.pointId);
    commit((list) => [...list, s]);
    setActiveIdBoth(s.id);
    setDrawer('none');
  }, [commit, setActiveIdBoth]);

  const handleSelectSession = useCallback((id: string) => {
    setActiveIdBoth(id);
    setDrawer('none');
  }, [setActiveIdBoth]);

  const handleRenameSession = useCallback((id: string, title: string) => {
    commit((list) => setSessionTitle(list, id, title));
  }, [commit]);

  const handleDeleteSession = useCallback((id: string) => {
    commit((list) => deleteSession(list, id));
  }, [commit]);

  const handleClearAll = useCallback(() => {
    const s = newSession();
    commit(() => [s]);
    setActiveIdBoth(s.id);
  }, [commit, setActiveIdBoth]);

  // 管理端不渲染
  if (pathname?.startsWith('/admin')) return null;

  const session = sessions.find((s) => s.id === activeId) ?? null;
  const provider = activeProvider(providerStore);

  // ---------- 面板拖拽（仅桌面端，顶栏为手柄） ----------
  // 拖拽过程中直接写 transform（不经过 setState），pointerup 才提交位置，
  // 避免每帧触发含 Markdown 列表的整体重渲染。
  const isDesktop = () => typeof window !== 'undefined' && window.innerWidth > 640;
  const onHeadPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return; // 按钮不触发拖拽
    if (!isDesktop()) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: rect.left, baseY: rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeadPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const panel = panelRef.current;
    if (!d || !panel) return;
    const rect = panel.getBoundingClientRect();
    const x = Math.min(Math.max(d.baseX + e.clientX - d.startX, 8), window.innerWidth - rect.width - 8);
    const y = Math.min(Math.max(d.baseY + e.clientY - d.startY, 8), window.innerHeight - rect.height - 8);
    dragRef.current = { ...d, lastX: x, lastY: y };
    panel.style.transform = `translate(${x - d.baseX}px, ${y - d.baseY}px)`;
  };
  const onHeadPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    const panel = panelRef.current;
    if (d && panel && d.lastX !== undefined && d.lastY !== undefined) {
      // 先把最终位置写进内联样式再去掉 transform，避免回弹闪烁；
      // 随后提交 state，React 重渲染的内联样式与手写值一致
      panel.style.left = `${d.lastX}px`;
      panel.style.top = `${d.lastY}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.animation = 'none';
      panel.style.transform = '';
      setPanelPos({ x: d.lastX, y: d.lastY });
    }
  };

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
            <button
              type="button"
              className={`aidock-provider${provider && provider.apiKey ? ' is-on' : ''}`}
              onClick={() => setDrawer('providers')}
              title="AI 提供商设置"
            >
              <span className="aidock-dot" aria-hidden="true" />
              {provider ? provider.name : '未配置'}
            </button>
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
            hasProvider={Boolean(provider && provider.apiKey)}
            sessionPointId={session?.pointId}
            chips={session?.pointId ? POINT_CHIPS : DEFAULT_CHIPS}
            onSend={handleSend}
            onExecuteAction={handleExecuteAction}
          />

          {drawer === 'providers' && (
            <ProviderDrawer
              store={providerStore}
              onChange={(next) => { setProviderStore(next); saveProviders(next); }}
              onClose={() => setDrawer('none')}
            />
          )}
          {drawer === 'sessions' && (
            <SessionDrawer
              sessions={sessions}
              activeId={activeId}
              onSelect={handleSelectSession}
              onRename={handleRenameSession}
              onDelete={handleDeleteSession}
              onClearAll={handleClearAll}
              onClose={() => setDrawer('none')}
            />
          )}
        </div>
      )}
    </>
  );
}
