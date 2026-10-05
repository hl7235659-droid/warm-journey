import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// 公开图片上传（上报 / 巡检共用）：POST multipart/form-data, field = file
// 限制：仅图片、≤5MB。返回 { key, url }，key 随后随上报/巡检表单提交。
export async function POST(req: Request) {
  const { env } = getRequestContext();

  let form: FormData;
  try { form = await req.formData(); } catch {
    return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: '缺少文件' }, { status: 400 });
  }
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) {
    return Response.json({ ok: false, error: '仅支持 JPG / PNG / WebP / GIF 图片' }, { status: 415 });
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ ok: false, error: '图片不能超过 5MB' }, { status: 413 });
  }

  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const key = `img/${new Date().toISOString().slice(0, 7)}/${hex}.${ext}`;

  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  return Response.json({ ok: true, data: { key, url: `/api/images/${key}` } }, { status: 201 });
}
