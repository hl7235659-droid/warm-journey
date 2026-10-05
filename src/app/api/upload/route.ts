import { getRequestContext } from '@cloudflare/next-on-pages';
import { checkRateLimit, recordUpload } from '@/lib/db';
import { getClientIp, jsonErr } from '@/lib/http';
import { MAX_UPLOAD_BYTES } from '@/lib/types';

export const runtime = 'edge';

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// 图片魔数校验：不信任客户端 MIME（防改后缀传任意文件）
function detectImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp';
  return null;
}

// 公开图片上传（上报 / 巡检共用）：POST multipart/form-data, field = file
// 防滥用三件套：每 IP 限流（10 次/小时）+ 魔数校验 + 台账记账（上报引用时校验归属）。
export async function POST(req: Request) {
  const { env } = getRequestContext();
  const ip = getClientIp(req);

  if (!(await checkRateLimit(env.DB, `upload:${ip}`, { limit: 10, windowSec: 3600 }))) {
    return jsonErr('上传过于频繁，请稍后再试', 429);
  }

  let form: FormData;
  try { form = await req.formData(); } catch {
    return jsonErr('请求格式错误', 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return jsonErr('缺少文件', 400);
  }
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) {
    return jsonErr('仅支持 JPG / PNG / WebP / GIF 图片', 415);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonErr('图片不能超过 5MB', 413);
  }

  // 读前 12 字节校验魔数，与客户端 MIME 不符即拒绝
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const realType = detectImageType(head);
  if (!realType || realType !== file.type) {
    return jsonErr('文件内容与图片格式不符', 415);
  }

  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const key = `img/${new Date().toISOString().slice(0, 7)}/${hex}.${ext}`;

  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });
  // 台账记账：上报提交时会校验 images 中的 key 属于本 IP 近期上传
  await recordUpload(env.DB, key, ip);

  return Response.json({ ok: true, data: { key, url: `/api/images/${key}` } }, { status: 201 });
}
