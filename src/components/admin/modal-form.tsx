'use client';

// 管理端弹窗表单的唯一样板：backdrop / 标题 / 按钮区 / saving / 错误反馈。
// 各页只保留自己的字段 JSX 与 payload 组装，状态机与提交尾部一律走这里。
// （列表侧的对称收口见 @/components/admin/list.tsx）
import { useCallback, useState } from 'react';
import { api } from '@/lib/api-client';

type Method = 'POST' | 'PUT';

export interface UseAdminFormOpts<T> {
  // 表单初值来源：openForm() 不带参打开与 closeForm() 重置都用它（各页各有一份 BLANK）
  blank: () => T;
  // 保存成功后的回调（通常是列表 reload）
  onSaved: () => void;
  // 失败反馈口径：inline=表单内红字（默认）；alert=弹窗提示；both=两处都提示。
  // 与既有各页行为一一对应：users/cities 用 inline，inspections 用 alert，knowledge 两处都提示。
  failureMode?: 'inline' | 'alert' | 'both';
  // 接口 error 缺失时的兜底文案；默认「保存失败」
  errorFallback?: string;
}

export function useAdminForm<T>(url: string, opts: UseAdminFormOpts<T>) {
  const { blank, onSaved, failureMode = 'inline', errorFallback = '保存失败' } = opts;
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState<T>(blank);

  const openForm = useCallback((init?: T) => {
    setFormError('');
    setForm(init ?? blank());
    setShowForm(true);
  }, [blank]);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setForm(blank());
    setFormError('');
  }, [blank]);

  // 提交尾部三件套：saving 闸门 → api 调用 → 成功收表单并刷新 / 失败按口径反馈。
  // 返回是否成功，供调用方做提交成功后的额外收尾（如清 editing、清临时图片列表）。
  const submit = useCallback(async (
    payload: unknown,
    override?: { url: string; method: Method },
  ): Promise<boolean> => {
    setSaving(true);
    setFormError('');
    const j = await api(override?.url ?? url, {
      method: override?.method ?? 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (j.ok) { closeForm(); onSaved(); return true; }
    const msg = j.error ?? errorFallback;
    if (failureMode !== 'alert') setFormError(msg);
    if (failureMode !== 'inline') alert(msg);
    return false;
  }, [url, closeForm, onSaved, failureMode, errorFallback]);

  return { showForm, saving, formError, setFormError, form, setForm, openForm, closeForm, submit };
}

export function ModalForm({ title, wide, onClose, onSubmit, saving, error, submitLabel, savingLabel, children }: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  error?: string;
  submitLabel?: string;
  savingLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={wide ? 'modal modal-wide' : 'modal modal-sm'} onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">{title}</h2>
        <form onSubmit={onSubmit} noValidate>
          {children}
          {error ? <p className="field-error form-error" role="alert">⚠ {error}</p> : null}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (savingLabel ?? '保存中…') : (submitLabel ?? '保存')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
