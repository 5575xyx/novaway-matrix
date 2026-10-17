/**
 * 辅助对话的「待发送草稿」。
 *
 * 用户在文件预览里选中几行、点「在辅助对话中提问」时，我们**不立刻发出去** ——
 * 选中代码只是给了个上下文，用户往往还要补一句"这段为什么这么写"。
 * 所以这里把拼好的草稿挂在一个模块级 Map 上（键 = 辅助对话的 sessionID），
 * 面板里的输入框挂载时把它取走、填进编辑器。
 *
 * 为什么不用 props 传：辅助对话面板是挂在 Side Pane 里的，创建/聚焦走的是
 * `layout.sidePane.openSession`（持久化状态），中间隔了一层非响应式的导航，
 * 把草稿塞进持久化状态既臃肿又会残留到下次启动。
 */
const pending = new Map<string, string>()

export function setSideChatSeed(sessionID: string, draft: string) {
  pending.set(sessionID, draft)
}

/** 取走（一次性）。拿到就删，避免切回标签时又填一次。 */
export function takeSideChatSeed(sessionID: string): string | undefined {
  const value = pending.get(sessionID)
  pending.delete(sessionID)
  return value
}

/**
 * 把「文件 + 行号区间 + 选中内容」拼成一段给模型看的草稿。
 *
 * 用 fenced code block 包住内容并标注语言不便（我们不知道语言），
 * 所以只标路径与行号 —— 模型能据此定位，用户也能看出这是哪一段。
 */
export function buildSelectionSeed(input: {
  path: string
  start: number
  end: number
  code: string
}): string {
  const range = input.start === input.end ? `第 ${input.start} 行` : `第 ${input.start}-${input.end} 行`
  return `${input.path} ${range}：\n\n\`\`\`\n${input.code.replace(/\n+$/, "")}\n\`\`\`\n\n`
}
