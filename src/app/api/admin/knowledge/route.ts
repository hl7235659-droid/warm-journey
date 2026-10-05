import { getRequestContext } from '@cloudflare/next-on-pages';
import { listKnowledge, createKnowledge } from '@/lib/db';
import { requireAdmin, requireRole } from '@/lib/auth';
import { z } from 'zod';

export const runtime = 'edge';

export async function GET(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const result = await listKnowledge(env.DB, {
    category: url.searchParams.get('category') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: Number(url.searchParams.get('page') ?? '1') || 1,
    page_size: Number(url.searchParams.get('page_size') ?? '50') || 50,
  });
  return Response.json({ ok: true, data: result });
}

const KnowledgeSchema = z.object({
  category: z.enum(['rights', 'channel', 'faq', 'notice']),
  title: z.string().min(1).max(60),
  content: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1).max(20)).max(10).default([]),
});

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;
  const forbidden = requireRole(auth, ['super_admin', 'admin']);
  if (forbidden) return forbidden;

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = KnowledgeSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  try {
    const id = await createKnowledge(env.DB, parsed.data);
    return Response.json({ ok: true, data: { id } }, { status: 201 });
  } catch {
    return Response.json({ ok: false, error: '创建失败' }, { status: 500 });
  }
}
