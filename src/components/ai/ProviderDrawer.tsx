'use client';
// AI 提供商管理抽屉：增删改查/设为当前/连通性测试（配置仅存本机 localStorage）
import { useState } from 'react';
import type { AiProvider, ProviderStore } from '@/lib/ai/types';

interface Props {
  store: ProviderStore;
  onChange: (store: ProviderStore) => void;
  onClose: () => void;
}

type Editing = 'none' | 'new' | string;

interface TestResult {
  ok: boolean;
  msg: string;
}

const TEMP_DEFAULT = '0.3';

// 本机生成 id：优先 crypto.randomUUID，退化到随机 hex
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// 展示用 Key 掩码：空 → 未配置，否则前 4 位 + ••••
function maskKey(key: string): string {
  if (!key) return '未配置';
  return `${key.slice(0, 4)}••••`;
}

// 展示用域名：非法时兜底显示原串
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

export default function ProviderDrawer({ store, onChange, onClose }: Props) {
  const [editing, setEditing] = useState<Editing>('none');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(TEMP_DEFAULT);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  function resetForm() {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setTemperature(TEMP_DEFAULT);
    setTestResult(null);
    setTesting(false);
  }

  function startNew() {
    resetForm();
    setEditing('new');
  }

  function startEdit(p: AiProvider) {
    setName(p.name);
    setBaseUrl(p.baseUrl);
    setApiKey(p.apiKey);
    setModel(p.model);
    setTemperature(String(p.temperature));
    setTestResult(null);
    setTesting(false);
    setEditing(p.id);
  }

  function cancelForm() {
    resetForm();
    setEditing('none');
  }

  function setActive(id: string) {
    onChange({ ...store, activeId: id });
  }

  function removeProvider(p: AiProvider) {
    if (!confirm(`删除提供商「${p.name}」？`)) return;
    if (store.activeId === p.id) {
      alert('正在使用中，请先切换到其他提供商');
      return;
    }
    const next: ProviderStore = {
      ...store,
      providers: store.providers.filter((x) => x.id !== p.id),
    };
    onChange(next);
    if (editing === p.id) cancelForm();
  }

  function saveForm() {
    const vName = name.trim();
    const vUrl = baseUrl.trim();
    const vModel = model.trim();
    const vTemp = parseFloat(temperature);

    if (!vName) { alert('请填写名称'); return; }
    if (vName.length > 30) { alert('名称不能超过 30 字'); return; }
    if (!vUrl) { alert('请填写接口地址'); return; }
    if (!/^https?:\/\//.test(vUrl)) { alert('接口地址必须以 http:// 或 https:// 开头'); return; }
    if (!vModel) { alert('请填写模型名称'); return; }
    if (Number.isNaN(vTemp) || vTemp < 0 || vTemp > 2) { alert('温度需在 0 - 2 之间'); return; }

    if (editing === 'new') {
      const p: AiProvider = {
        id: newId(),
        name: vName,
        baseUrl: vUrl,
        apiKey: apiKey.trim(),
        model: vModel,
        temperature: vTemp,
        createdAt: Date.now(),
      };
      onChange({ providers: [...store.providers, p], activeId: p.id });
    } else {
      const next = store.providers.map((p) =>
        p.id === editing
          ? { ...p, name: vName, baseUrl: vUrl, apiKey: apiKey.trim(), model: vModel, temperature: vTemp }
          : p,
      );
      onChange({ ...store, providers: next });
    }
    cancelForm();
  }

  async function runTest(payload: { baseUrl: string; apiKey: string; model: string }) {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; data?: { reply: string } };
      if (json.ok) {
        setTestResult({ ok: true, msg: json.data?.reply ?? '' });
      } else {
        setTestResult({ ok: false, msg: json.error ?? '未知错误' });
      }
    } catch {
      setTestResult({ ok: false, msg: '网络错误，无法连接该地址' });
    } finally {
      setTesting(false);
    }
  }

  function testForm() {
    const vUrl = baseUrl.trim();
    if (!vUrl) { alert('请先填写接口地址'); return; }
    if (!/^https?:\/\//.test(vUrl)) { alert('接口地址必须以 http:// 或 https:// 开头'); return; }
    if (!model.trim()) { alert('请先填写模型名称'); return; }
    void runTest({ baseUrl: vUrl, apiKey: apiKey.trim(), model: model.trim() });
  }

  function testProvider(p: AiProvider) {
    void runTest({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model });
  }

  return (
    <div className="aidock-drawer is-open">
      <div className="aidock-drawer-head">
        <button type="button" className="aidock-mini-btn" onClick={onClose}>
          ← 返回
        </button>
        <span className="aidock-drawer-title">AI 提供商</span>
      </div>

      <div className="aidock-drawer-body">
        <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          提供商配置与 API Key 只保存在你的设备（localStorage），不会上传服务器。填写任一 OpenAI 兼容接口即可，如 https://api.deepseek.com/v1
        </p>

        {store.providers.length === 0 && editing === 'none' && (
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            还没有提供商。点下方「新增提供商」开始配置。
          </p>
        )}

        {store.providers.map((p) => {
          const active = store.activeId === p.id;
          return (
            <div key={p.id} className={active ? 'aidock-item is-active' : 'aidock-item'}>
              <div className="aidock-item-main">
                <div className="aidock-item-title">{p.name}</div>
                <div className="aidock-item-sub">
                  {hostOf(p.baseUrl)} · {p.model} · Key: {maskKey(p.apiKey)}
                </div>
              </div>
              <div className="aidock-item-actions">
                {active ? (
                  <span className="aidock-mini-btn">使用中</span>
                ) : (
                  <button type="button" className="aidock-mini-btn" onClick={() => setActive(p.id)}>
                    设为当前
                  </button>
                )}
                <button type="button" className="aidock-mini-btn" onClick={() => startEdit(p)}>
                  编辑
                </button>
                <button type="button" className="aidock-mini-btn" disabled={testing} onClick={() => testProvider(p)}>
                  {testing ? '测试中…' : '测试'}
                </button>
                <button type="button" className="aidock-mini-btn is-danger" onClick={() => removeProvider(p)}>
                  删除
                </button>
              </div>
            </div>
          );
        })}

        {editing !== 'none' && (
          <div className="aidock-form">
            <label htmlFor="ai-prov-name">名称</label>
            <input
              id="ai-prov-name"
              className="input"
              value={name}
              maxLength={30}
              onChange={(e) => setName(e.target.value)}
              placeholder="DeepSeek 官方"
            />

            <label htmlFor="ai-prov-url">接口地址</label>
            <input
              id="ai-prov-url"
              className="input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
            />

            <label htmlFor="ai-prov-key">API Key</label>
            <input
              id="ai-prov-key"
              className="input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="留空表示未配置"
            />

            <label htmlFor="ai-prov-model">模型</label>
            <input
              id="ai-prov-model"
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek-chat"
            />

            <label htmlFor="ai-prov-temp">温度</label>
            <input
              id="ai-prov-temp"
              className="input"
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />

            <button type="button" className="aidock-mini-btn" disabled={testing} onClick={testForm}>
              {testing ? '测试中…' : '测试连接'}
            </button>

            {testResult && (
              <div className={testResult.ok ? 'aidock-test-result is-ok' : 'aidock-test-result is-err'}>
                {testResult.ok ? `✓ 连接成功：${testResult.msg}` : `✗ ${testResult.msg}`}
              </div>
            )}
          </div>
        )}

        {editing === 'none' && (
          <div>
            <button type="button" className="btn btn-primary btn-sm" onClick={startNew}>
              新增提供商
            </button>
          </div>
        )}

        {editing !== 'none' && (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={saveForm}>
              保存
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={cancelForm}>
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
