'use client';
export const runtime = 'edge';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// /admin 只是入口，统一跳到服务点列表。
// 这里刻意用客户端跳转：本文件的上层 layout 是客户端组件，
// 若在 server component 里调 redirect()，Next 15 客户端路由会抛
// React error #310（Rendered more hooks than during the previous render）。
// 正常情况下 next.config.mjs 的 redirects() 已用 HTTP 307 拦在前面，
// 这里只是兜底。
export default function AdminRoot() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/points');
  }, [router]);

  return null;
}
