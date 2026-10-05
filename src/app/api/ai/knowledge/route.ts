import { getRequestContext } from '@cloudflare/next-on-pages';
import { listKnowledge } from '@/lib/db';
import { KNOWLEDGE_CATEGORIES } from '@/lib/types';

export const runtime = 'edge';

// 公开只读：已启用的知识条目（AI list_knowledge action 与前端展示用）
export async function GET(req: Request) {
  const { env } = getRequestContext();
  const url = new URL(req.url);
  const category = url.searchParams.get('category') ?? undefined;
  const q = url.searchParams.get('q') ?? undefined;

  if (category && !(KNOWLEDGE_CATEGORIES as readonly string[]).includes(category)) {
    return Response.json({ ok: false, error: '类别无效' }, { status: 422 });
  }

  const result = await listKnowledge(env.DB, {
    category,
    q,
    enabled: true,
    page: 1,
    page_size: 50,
  });
  return Response.json({ ok: true, data: result.items });
}
