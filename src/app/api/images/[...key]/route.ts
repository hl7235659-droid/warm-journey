import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

// 读取 R2 中的图片：GET /api/images/img/2026-10/xxxx.jpg
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { env } = getRequestContext();
  const key = (await params).key.join('/');
  if (!key.startsWith('img/')) {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  const obj = await env.BUCKET.get(key);
  if (!obj) {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
