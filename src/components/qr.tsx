'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

// 渲染走 <img src="data:image/gif;base64,…">，不再有 innerHTML 注入面；
// 白名单留着是为了不把任意外部地址编码成可扫的入站链接（防钓鱼）。
const QR_VALUE_PATTERN = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]{1,200}$/;

const BOX = (size: number): React.CSSProperties => ({
  display: 'inline-block',
  boxSizing: 'border-box',
  width: size,
  height: size,
  background: '#fff',
  borderRadius: 'var(--r-md)',
  padding: 6,
});

// 客户端二维码（GIF data URL），用于骑手入店码等即时展示场景
export default function QrImage({ value, size = 180, label }: { value: string; size?: number; label?: string }) {
  const src = useMemo(() => {
    if (!QR_VALUE_PATTERN.test(value)) return null;
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    // 6px/模块 + 2 模块留白：位图按容器缩放后仍清晰可扫
    return qr.createDataURL(6, 2);
  }, [value]);

  if (!src) {
    return <span role="img" aria-label="二维码生成失败" style={BOX(size)} />;
  }

  return <img src={src} width={size} height={size} alt={label ?? '二维码'} style={BOX(size)} />;
}
