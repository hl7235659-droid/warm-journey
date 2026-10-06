import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { getPoint, getPointSignals, getOccupancy } from '@/lib/db';
import PointDetailClient from './PointDetailClient';


interface Props { params: Promise<{ id: string }> }

// generateMetadata 与 Page 在同一次渲染里各要一次同一点位：cache() 按 id 去重，
// 每次详情页省一趟 D1 往返（外部 HTTP，10–30ms）。键只用 id——env.DB 是每次请求
// 新建的对象，把它一起当键就去不掉重。
const loadPoint = cache(async (id: string) => {
  const { env } = getRequestContext();
  return getPoint(env.DB, id);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const point = await loadPoint(id);
    if (!point) return { title: '服务点 — 暖途同行' };
    return { title: `${point.name} — 暖途同行` };
  } catch { return { title: '服务点 — 暖途同行' }; }
}

export default async function PointPage({ params }: Props) {
  const { id } = await params;
  const point = await loadPoint(id);
  if (!point) notFound();
  const { env } = getRequestContext();
  const [signals, occupancy] = await Promise.all([
    getPointSignals(env.DB, id),
    getOccupancy(env.DB, id),
  ]);
  return <PointDetailClient point={point} signals={signals} occupancy={occupancy} />;
}
