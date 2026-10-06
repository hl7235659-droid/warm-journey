// 中文日期/时间格式化的唯一入口（zh-CN）。
// 入参约定：number 一律是 unix 秒（与后端 created_at 等字段同口径，全仓唯一约定）；
// 客户端毫秒时间戳或现成 Date 对象请直接传 Date。
export function formatCNDate(input: number | Date, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof input === 'number' ? new Date(input * 1000) : input;
  return d.toLocaleDateString('zh-CN', opts);
}

export function formatCNDateTime(input: number | Date, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof input === 'number' ? new Date(input * 1000) : input;
  return d.toLocaleString('zh-CN', opts);
}
