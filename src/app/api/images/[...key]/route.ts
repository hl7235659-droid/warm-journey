import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

const KEY_PATTERN = /^img\/\d{4}-\d{2}\/[0-9a-f]{16}\.(jpg|png|webp|gif)$/;

// 读取 R2 中的图片：GET /api/images/img/2026-10/xxxx.jpg
// key 白名单校验 + nosniff；缓存一天（immutable 一年会让已删除的图片长期滞留 CDN）
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { env } = getRequestContext();
  const key = (await params).key.join('/');
  if (!KEY_PATTERN.test(key)) {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  const obj = await env.BUCKET.get(key);
  if (!obj) {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
