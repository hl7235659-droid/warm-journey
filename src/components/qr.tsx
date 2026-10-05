'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

// 通用组件的 value 一旦被传入用户可控内容，innerHTML 渲染即有 XSS 面：
// 只接受站内 URL，且限制长度与字符白名单。
const QR_VALUE_PATTERN = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]{1,200}$/;

// 客户端二维码（SVG），用于骑手入店码等即时展示场景
export default function QrImage({ value, size = 180, label }: { value: string; size?: number; label?: string }) {
  const svg = useMemo(() => {
    if (!QR_VALUE_PATTERN.test(value)) return null;
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }, [value]);

  if (!svg) {
    return <span role="img" aria-label="二维码生成失败" style={{ display: 'inline-block', width: size, height: size }} />;
  }

  return (
    <span
      role="img"
      aria-label={label ?? '二维码'}
      style={{ display: 'inline-block', width: size, height: size, background: '#fff', borderRadius: 'var(--r-md)', padding: 6 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
