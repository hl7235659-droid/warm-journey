'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

// 渲染走 <img src="data:image/svg+xml,…">：SVG 当图片资源加载不进 DOM，脚本上下文不可达，
// innerHTML 注入面归零；又因为是矢量，打印张贴时不会像位图那样缩放发虚。
// value 白名单留着是为了不把任意外部地址编码成可扫的入站链接（防钓鱼）。
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

// 客户端二维码（SVG data URL），用于骑手入店码与站内打印张贴码
export default function QrImage({ value, size = 180, label }: { value: string; size?: number; label?: string }) {
  const src = useMemo(() => {
    if (!QR_VALUE_PATTERN.test(value)) return null;
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    // scalable：SVG 不写死宽高，<img> 的 CSS 尺寸说了算
    const svg = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [value]);

  if (!src) {
    return <span role="img" aria-label="二维码生成失败" style={BOX(size)} />;
  }

  return <img src={src} width={size} height={size} alt={label ?? '二维码'} style={BOX(size)} />;
}
