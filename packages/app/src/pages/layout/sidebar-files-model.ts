/**
 * 「仅变更」过滤的纯逻辑。
 *
 * 必须对**每一层**都成立：只看根层的话，展开子目录后未变更的文件会整片露出来，
 * 过滤开关看起来就像没生效。条目自身在变更清单里、或有变更文件挂在它下面
 * （前缀命中）才算可见。
 */
export function isVisibleEntry(path: string, changed: ReadonlySet<string>): boolean {
  const normalized = path.replaceAll("\\", "/")
  if (changed.has(normalized)) return true
  const prefix = `${normalized}/`
  for (const file of changed) if (file.startsWith(prefix)) return true
  return false
}
