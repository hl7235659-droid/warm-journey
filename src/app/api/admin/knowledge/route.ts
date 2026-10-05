import { listKnowledge, createKnowledge } from '@/lib/db';
import { withAdmin, readJson, isResponse, pageParams } from '@/lib/http';
import { z } from 'zod';

export const runtime = 'edge';

export const GET = withAdmin(async ({ req, env }) => {
  const url = new URL(req.url);
  const { page, page_size } = pageParams(url.searchParams, 50);
  const result = await listKnowledge(env.DB, {
    category: url.searchParams.get('category') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page,
    page_size,
  });
  return Response.json({ ok: true, data: result });
});

const KnowledgeSchema = z.object({
  category: z.enum(['rights', 'channel', 'faq', 'notice']),
  title: z.string().min(1).max(60),
  content: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1).max(20)).max(10).default([]),
});

export const POST = withAdmin(async ({ req, env }) => {
  const parsed = await readJson(req, KnowledgeSchema);
  if (isResponse(parsed)) return parsed;

  try {
    const id = await createKnowledge(env.DB, parsed);
    return Response.json({ ok: true, data: { id } }, { status: 201 });
  } catch (err) {
    console.error('knowledge create failed:', (err as { message?: string })?.message ?? 'unknown');
    return Response.json({ ok: false, error: '创建失败' }, { status: 500 });
  }
}, { roles: ['super_admin', 'admin'] });
