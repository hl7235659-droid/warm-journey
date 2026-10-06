// 图片上传：上报页与巡检页共用同一份循环与体积上限（上限见 @/lib/types）。
import { api } from '@/lib/api-client';
import { MAX_UPLOAD_BYTES } from '@/lib/types';

export interface UploadedImage {
  key: string;
  url: string;
}

/**
 * /api/upload 签发的图片 key 形态（img/YYYY-MM/16hex.扩展名）。
 * 上报与巡检共用同一把尺子：放过任意字符串就等于把死链写进台账。
 */
export const IMAGE_KEY_RE = /^img\/\d{4}-\d{2}\/[0-9a-f]{16}\.(jpg|png|webp|gif)$/;

/**
 * 逐张 POST /api/upload。每张成功即刻回调，弱网下已传成功的照片不会因后续失败而丢；
 * 单张超 MAX_UPLOAD_BYTES 或服务端拒绝 → 抛出，由调用方决定提示位置。
 */
export async function uploadImages(
  files: File[],
  onUploaded: (img: UploadedImage) => void,
): Promise<void> {
  for (const f of files) {
    if (f.size > MAX_UPLOAD_BYTES) throw new Error(`「${f.name}」超过 5MB`);
    const fd = new FormData();
    fd.append('file', f);
    const j = await api<UploadedImage>('/api/upload', { method: 'POST', body: fd });
    if (!j.ok) throw new Error(j.error ?? '图片上传失败');
    onUploaded(j.data);
  }
}
