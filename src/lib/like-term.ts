// LIKE 检索词归一：剥掉 SQL 通配符与引号，再收敛长度。
// 参数化绑定挡住的是注入，挡不住语义放大——用户输入的 % 或 _ 会把"包含匹配"
// 变成全表匹配（如 q="%" 命中所有站点），长度不设限则让 LIKE 扫过超长串。
// name / address / services 三处 LIKE 共用本函数，services 侧原本已这么做。
export function likeTerm(raw: string, maxLen = 50): string {
  return raw.replace(/[%_"\\]/g, '').trim().slice(0, maxLen);
}
