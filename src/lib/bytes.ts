// 字节 → 小写 hex 字符串的唯一实现：rider token / 各类随机 id / 上传 key 共用。
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
