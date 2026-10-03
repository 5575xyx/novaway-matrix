// 折叠工具输出:先按行数截,再按字符数兜底(一行超长时不能把整屏撑爆)。
// hidden 是"折叠掉的行数",给调用方算「还有多少没显示」用 —— 只按字符截断时它可能是 0。
//
// **现在谁在用**:只有 execute 那一路的行内预览(它的输出要跟着子调用列表一起平铺,
// 塞不进工具卡的 body)。工具卡的 body 已经换成「行数上限 + 可滚动」(见 routes/session 的
// TOOL_BODY_MAX_ROWS),所以这里**不再有「点击展开」那一步** —— 配套的 collapseHint 也一并删了:
// 那些行没有被藏起来,只是要滚,写「还有 N 行」是说谎。
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
