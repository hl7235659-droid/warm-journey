import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { getPoint, getPointSignals, getOccupancy } from '@/lib/db';
import type { ServicePoint } from '@/lib/types';
import PointDetailClient from './PointDetailClient';


interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const { env } = getRequestContext();
    const point = await getPoint(env.DB, id);
    if (!point) return { title: '服务点 — 暖途同行' };
    return { title: `${point.name} — 暖途同行` };
  } catch { return { title: '服务点 — 暖途同行' }; }
}

export default async function PointPage({ params }: Props) {
  const { id } = await params;
  const { env } = getRequestContext();
  const point = await getPoint(env.DB, id);
  if (!point) notFound();
  const [signals, occupancy] = await Promise.all([
    getPointSignals(env.DB, id),
    getOccupancy(env.DB, id),
  ]);
  return <PointDetailClient point={point as ServicePoint} signals={signals} occupancy={occupancy} />;
}
