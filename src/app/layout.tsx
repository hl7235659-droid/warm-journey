export const runtime = 'edge';
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '暖途同行 — 骑手服务点查询',
  description: '随时查找附近骑手服务站：开放状态、服务项目、导航和准入要求，无需下载 App',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: '暖途同行' },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    title: '暖途同行',
    description: '骑手服务点信息平台',
    locale: 'zh_CN',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#6b4e22' },
    { media: '(prefers-color-scheme: dark)',  color: '#1a120b' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" href="/images/logo-mark.png" type="image/png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
