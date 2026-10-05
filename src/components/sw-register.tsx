'use client';

import { useEffect } from 'react';

export default function SWRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 注册失败不影响使用 */ });
  }, []);
  return null;
}
