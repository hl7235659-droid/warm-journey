'use client';

// AiDock 的两块可复用逻辑：面板拖拽（usePanelDrag）与会话管理（useChatSessions）。
// 主组件 AiDock.tsx 只留调度层（徽章/抽屉/问候渲染 + 发送链路 + action 执行）。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatSession } from '@/lib/ai/types';
import {
  loadSessions, saveSessions, newSession, setSessionTitle, deleteSession,
} from '@/lib/ai/ai-store';

// ---------- 面板拖拽（仅桌面端，顶栏为手柄） ----------

// 面板可拖动（桌面端）：null = 默认锚定右下角
export interface PanelPos { x: number; y: number }

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.innerWidth > 640;
}

// 拖拽过程中直接写 transform（不经过 setState），pointerup 才提交位置，
// 避免每帧触发含 Markdown 列表的整体重渲染。
export function usePanelDrag(panelRef: React.RefObject<HTMLDivElement | null>) {
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; lastX?: number; lastY?: number } | null>(null);

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

  return { panelPos, onHeadPointerDown, onHeadPointerMove, onHeadPointerUp };
}

// ---------- 会话管理 ----------

// sessionsRef / activeIdRef 是唯一数据源：commit 内同步更新，避免连续更新读到 stale 快照。
// activeId 先按 ref 算出新值写回、再同步 React state——原来把写 ref 放在 setActiveId 的
// updater 里，等于在 React 可丢弃/重跑的纯函数里做副作用。
export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sessionsRef = useRef<ChatSession[]>([]);
  const activeIdRef = useRef<string | null>(null);

  const setActiveIdBoth = useCallback((id: string | null | ((cur: string | null) => string | null)) => {
    const next = typeof id === 'function' ? id(activeIdRef.current) : id;
    activeIdRef.current = next;
    setActiveId(next);
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
    const ss = loadSessions();
    sessionsRef.current = ss;
    setSessions(ss);
    if (ss.length > 0) setActiveIdBoth(ss[0].id);
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

  // 详情页「问小暖」联动（wj-ai-open 事件的会话侧）：无会话或当前会话已绑定别处
  // → 开新会话并激活；空会话 → 直接绑定
  const bindPoint = useCallback((pointId: string) => {
    const cur = sessionsRef.current.find((s) => s.id === activeIdRef.current);
    if (!cur || (cur.messages.length > 0 && cur.pointId !== pointId)) {
      const s = newSession(pointId);
      s.title = '问小暖';
      commit((list) => [...list, s]);
      setActiveIdBoth(s.id);
    } else if (cur.pointId !== pointId) {
      commit((list) => list.map((x) => (x.id === cur.id ? { ...x, pointId } : x)));
    }
  }, [commit, setActiveIdBoth]);

  // 发送链路 / action 执行取会话用：ref 直读，不经可能过期的渲染快照
  const getSession = useCallback((id: string | null): ChatSession | null =>
    sessionsRef.current.find((s) => s.id === id) ?? null, []);
  const getActiveSession = useCallback((): ChatSession | null =>
    sessionsRef.current.find((s) => s.id === activeIdRef.current) ?? null, []);

  const handleNewSession = useCallback(() => {
    const cur = sessionsRef.current.find((s) => s.id === activeIdRef.current);
    const s = newSession(cur?.pointId);
    commit((list) => [...list, s]);
    setActiveIdBoth(s.id);
  }, [commit, setActiveIdBoth]);

  const handleSelectSession = useCallback((id: string) => {
    setActiveIdBoth(id);
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

  return {
    sessions,
    activeId,
    commit,
    ensureSession,
    bindPoint,
    getSession,
    getActiveSession,
    newSession: handleNewSession,
    selectSession: handleSelectSession,
    renameSession: handleRenameSession,
    deleteSession: handleDeleteSession,
    clearAll: handleClearAll,
  };
}
