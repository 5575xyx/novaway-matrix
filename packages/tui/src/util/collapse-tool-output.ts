// 折叠工具输出:先按行数截,再按字符数兜底(一行超长时不能把整屏撑爆)。
// hidden 是"折叠掉的行数",给"点击展开（还有 N 行）"用 —— 只按字符截断时它可能是 0,
// 那种情况下调用方就只显示"点击展开",不谎报数字。
export function collapseToolOutput(output: string, maxLines: number, maxChars: number) {
  const lines = output.split("\n")
  const hidden = Math.max(0, lines.length - maxLines)
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) {
    return { output, overflow: false, hidden: 0 }
  }

  const preview = lines.slice(0, maxLines).join("\n")
  if (Array.from(preview).length > maxChars) {
    return {
      output:
        Array.from(preview)
          .slice(0, Math.max(0, maxChars - 1))
          .join("") + "…",
      overflow: true,
      hidden,
    }
  }

  return { output: [...lines.slice(0, maxLines), "…"].join("\n"), overflow: true, hidden }
}

// 折叠提示语:crush 的做法是把"藏了多少"直接写出来(… N lines hidden),
// 而不是只给一个不知深浅的省略号。行数不可靠时(只按字符截断)退回纯提示。
export function collapseHint(expanded: boolean, hidden: number) {
  if (expanded) return "点击折叠"
  if (hidden > 0) return `点击展开（还有 ${hidden} 行）`
  return "点击展开"
}
