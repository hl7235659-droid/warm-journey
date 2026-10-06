'use client';
// 本地读写（providers / sessions）——纯函数，SSR 安全（读操作在 SSR 下返回默认值）
// 安全分层：提供商元数据（名称/地址/模型）落 localStorage；API Key 只进 sessionStorage，
// 关掉标签页即消失，避免长期明文驻留在磁盘上被扩展/共用设备读取。
import type { AiProvider, ProviderStore, ChatMessage, ChatSession } from '@/lib/ai/types';
import { readItem, writeItem, readSessionItem, writeSessionItem } from '@/lib/local';
import { toHex } from '@/lib/bytes';

const PROVIDERS_KEY = 'wj_ai_providers';
const PROVIDER_KEYS = 'wj_ai_provider_keys';   // sessionStorage
const SESSIONS_KEY = 'wj_ai_sessions';

export const MAX_SESSIONS = 20;
export const MAX_MESSAGES_PER_SESSION = 60;

function readKeyMap(): Record<string, string> {
  try {
    const parsed = JSON.parse(readSessionItem(PROVIDER_KEYS) ?? '{}') as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// 本机 id 的唯一来源（会话 id 与提供商 id 共用；此前 ProviderDrawer 另有一份，两种形态）。
// 安全上下文（https 部署 / localhost）用平台原生 randomUUID；手机连店内 wifi 走
// http://192.168.x.x 这类明文 LAN 地址时 crypto.randomUUID 根本不存在，退回 16 位 hex。
export function genLocalId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// ---------- Providers ----------

export function loadProviders(): ProviderStore {
  const raw = readItem(PROVIDERS_KEY);
  if (!raw) return { providers: [], activeId: null };
  const keys = readKeyMap();
  try {
    const parsed = JSON.parse(raw) as ProviderStore;
    if (!Array.isArray(parsed.providers)) return { providers: [], activeId: null };
    return {
      // Key 从不写入 localStorage：仅本次会话有效，重开标签页需重新输入
      providers: parsed.providers
        .filter((p) => p && typeof p.id === 'string')
        .map((p) => ({ ...p, apiKey: keys[p.id] ?? '' })),
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
    };
  } catch {
    return { providers: [], activeId: null };
  }
}

export function saveProviders(store: ProviderStore) {
  const keys = readKeyMap();
  for (const p of store.providers) {
    if (p.apiKey) keys[p.id] = p.apiKey;
    else delete keys[p.id];
  }
  const knownIds = new Set(store.providers.map((p) => p.id));
  for (const id of Object.keys(keys)) if (!knownIds.has(id)) delete keys[id];
  writeSessionItem(PROVIDER_KEYS, JSON.stringify(keys));

  // 落到 localStorage 的部分必须彻底剔除 apiKey 字段
  const meta = store.providers.map((p) => {
    const { apiKey: _omit, ...rest } = p;
    return rest;
  });
  writeItem(PROVIDERS_KEY, JSON.stringify({ activeId: store.activeId, providers: meta }));
}

export function activeProvider(store: ProviderStore): AiProvider | null {
  return store.providers.find((p) => p.id === store.activeId) ?? null;
}

// ---------- Sessions ----------

export function loadSessions(): ChatSession[] {
  const raw = readItem(SESSIONS_KEY);
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
  writeItem(SESSIONS_KEY, JSON.stringify(sorted));
  return sorted;
}

export function newSession(pointId?: string): ChatSession {
  const now = Date.now();
  return { id: genLocalId(), title: '新会话', pointId, messages: [], createdAt: now, updatedAt: now };
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

export function deleteSession(sessions: ChatSession[], sessionId: string): ChatSession[] {
  return sessions.filter((s) => s.id !== sessionId);
}
