import { getPoint } from '@/lib/db';
import { withAdmin } from '@/lib/http';
import qrcode from 'qrcode-generator';

export const runtime = 'edge';

// 服务点二维码（SVG）：
//   ?type=entry（默认）→ 扫码打开 C 端详情页
//   ?type=checkout     → 店内张贴的「离店码」，骑手扫码离店
export const GET = withAdmin<{ id: string }>(async ({ req, env, params: { id } }) => {
  const point = await getPoint(env.DB, id);
  if (!point) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });

  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'entry';
  const path = type === 'checkout' ? `/checkout/${id}` : `/point/${id}`;

  const qr = qrcode(0, 'M');
  qr.addData(`${url.origin}${path}`);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
