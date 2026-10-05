'use client';
// localStorage 读写（providers / sessions）——纯函数，SSR 安全（读操作在 gUA 下返回默认值）
import type { AiProvider, ProviderStore, ChatMessage, ChatSession } from '@/lib/ai/types';

const PROVIDERS_KEY = 'wj_ai_providers';
const SESSIONS_KEY = 'wj_ai_sessions';

export const MAX_SESSIONS = 20;
export const MAX_MESSAGES_PER_SESSION = 60;
export const MESSAGES_PER_REQUEST = 12; // 发送时只带最近 12 条

function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, value); } catch { /* 配额满等异常静默 */ }
}

export function genLocalId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Providers ----------

export function loadProviders(): ProviderStore {
  const raw = safeGet(PROVIDERS_KEY);
  if (!raw) return { providers: [], activeId: null };
  try {
    const parsed = JSON.parse(raw) as ProviderStore;
    if (!Array.isArray(parsed.providers)) return { providers: [], activeId: null };
    return {
      providers: parsed.providers.filter((p) => p && typeof p.id === 'string'),
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
    };
  } catch {
    return { providers: [], activeId: null };
  }
}

export function saveProviders(store: ProviderStore) {
  safeSet(PROVIDERS_KEY, JSON.stringify(store));
}

export function activeProvider(store: ProviderStore): AiProvider | null {
  return store.providers.find((p) => p.id === store.activeId) ?? null;
}

// ---------- Sessions ----------

export function loadSessions(): ChatSession[] {
  const raw = safeGet(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ChatSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.messages));
  } catch {
    return [];
  }
}

// 写入前统一执行上限裁剪（会话≤20、单会话消息≤60），按 updatedAt 倒序
export function saveSessions(sessions: ChatSession[]): ChatSession[] {
  const sorted = [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
    .map((s) => ({ ...s, messages: s.messages.slice(-MAX_MESSAGES_PER_SESSION) }));
  safeSet(SESSIONS_KEY, JSON.stringify(sorted));
  return sorted;
}

export function newSession(pointId?: string): ChatSession {
  const now = Date.now();
  return { id: genLocalId(), title: '新会话', pointId, messages: [], createdAt: now, updatedAt: now };
}

export function titleFromMessage(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 20 ? `${t.slice(0, 20)}…` : t || '新会话';
}

export function appendMessage(sessions: ChatSession[], sessionId: string, msg: ChatMessage): ChatSession[] {
  return sessions.map((s) =>
    s.id === sessionId
      ? { ...s, messages: [...s.messages, msg].slice(-MAX_MESSAGES_PER_SESSION), updatedAt: Date.now() }
      : s,
  );
}

export function setSessionTitle(sessions: ChatSession[], sessionId: string, title: string): ChatSession[] {
  const t = title.trim().slice(0, 30);
  return sessions.map((s) => (s.id === sessionId ? { ...s, title: t || '新会话', updatedAt: Date.now() } : s));
}

export function setSessionPoint(sessions: ChatSession[], sessionId: string, pointId?: string): ChatSession[] {
  return sessions.map((s) => (s.id === sessionId ? { ...s, pointId, updatedAt: Date.now() } : s));
}

export function deleteSession(sessions: ChatSession[], sessionId: string): ChatSession[] {
  return sessions.filter((s) => s.id !== sessionId);
}

// 取发送给后端的历史（最近 12 条）
export function messagesForRequest(session: ChatSession): Array<{ role: 'user' | 'assistant'; content: string }> {
  return session.messages
    .slice(-MESSAGES_PER_REQUEST)
    .map((m) => ({ role: m.role, content: m.content }));
}
