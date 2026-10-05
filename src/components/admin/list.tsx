'use client';

// 管理端列表页的唯一样板：取数状态机 + 骨架行 / 空态行 / 分页条。
// 各页只保留自己的 fetcher（URL 与筛选项不同），样板一律删除。
import { useCallback, useEffect, useState } from 'react';
import { NETWORK_ERR } from '@/lib/api-client';

// 分页尺寸唯一来源：列表接口的 page_size 与 totalPages 计算必须同值。
export const LIST_PAGE_SIZE = 20;

export interface ListResp<T> {
  ok: boolean;
  data?: T[];
  total?: number;
  error?: string;
}

// fetcher 需用 useCallback 稳定（依赖只有筛选项，page 由参数给出），
// 否则每次渲染都会重建 load 并触发一次新的请求。
export function useAdminList<T>(fetcher: (page: number) => Promise<ListResp<T>>) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetcher(p);
      if (!r.ok || !r.data) {
        setError(r.error ?? '加载失败');
        setItems([]);
        setTotal(0);
        return;
      }
      setItems(r.data);
      setTotal(r.total ?? r.data.length);
    } catch {
      setError(NETWORK_ERR);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => { void load(page); }, [load, page]);

  return {
    items,
    total,
    page,
    loading,
    error,
    setPage,
    totalPages: Math.max(1, Math.ceil(total / LIST_PAGE_SIZE)),
    reload: () => { void load(page); },
  };
}

export function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[1, 2, 3].map(i => (
        <tr key={i}>
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}><div className="skeleton skeleton-cell" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return <tr><td colSpan={cols} className="empty-block">{text}</td></tr>;
}

export function Pager({ page, totalPages, onPage }: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← 上一页</button>
      <span className="pager-info">{page} / {totalPages}</span>
      <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>下一页 →</button>
    </div>
  );
}
