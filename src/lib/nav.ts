// 共享导航工具：从详情页提出的 navToPoint（iOS 用 Apple Maps scheme，其余走高德 URI）
// AI 助手的 route action 与详情页共用同一实现，注意高德参数是「经度在前」。

export function navToPoint(lat: number, lng: number, name: string) {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  const ua = navigator.userAgent;
  const encoded = encodeURIComponent(name);
  if (/iPhone|iPad|iPod/.test(ua)) {
    window.location.href = `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encoded}`;
  } else {
    window.open(
      `https://uri.amap.com/navigation?to=${lng},${lat},${encoded}&mode=walking&callnative=1`,
      '_blank',
    );
  }
}
