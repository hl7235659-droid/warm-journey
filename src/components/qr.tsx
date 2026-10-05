'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

// 客户端二维码（SVG），用于骑手入店码等即时展示场景
export default function QrImage({ value, size = 180, label }: { value: string; size?: number; label?: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }, [value]);

  return (
    <span
      role="img"
      aria-label={label ?? '二维码'}
      style={{ display: 'inline-block', width: size, height: size, background: '#fff', borderRadius: 'var(--r-md)', padding: 6 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
