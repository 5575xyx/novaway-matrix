/**
 * 辅助对话的「待带入内容」。
 *
 * 用户在聊天区/文件预览里选中一段内容、点「在辅助对话中提问」时，
 * 我们**不直接发送** —— 选中内容只是上下文，用户往往还要补一句
 * "这段为什么这么写"。这里把内容挂在一个模块级 Map 上
 * （键 = 辅助对话的 sessionID），面板里的输入框挂载时取走：
 *
 * - `quote`：选中内容，渲染成输入框上方的引用卡片（对齐 ZCode 的会话引用）；
 * - `draft`：预填到输入框的文字。
 *
 * 为什么不用 props 传：辅助对话面板是挂在 Side Pane 里的，创建/聚焦走的是
 * `layout.sidePane.openSession`（持久化状态），中间隔了一层非响应式的导航，
 * 把草稿塞进持久化状态既臃肿又会残留到下次启动。
 */
export type SideChatQuote = {
  text: string
  /** 来源标签，例如「源码」或「src/a.ts 第 3-7 行」。 */
  label?: string
  /** 文件引用时的路径，发送时保留出处。 */
  path?: string
}

export type SideChatSeed = {
  draft?: string
  quote?: SideChatQuote
}

const pending = new Map<string, SideChatSeed>()

export function setSideChatSeed(sessionID: string, seed: SideChatSeed) {
  pending.set(sessionID, seed)
}

/**
 * 读取待带入内容（**不删除**）。
 *
 * 之前是"取走即删"，但侧栏面板在打开动画/标签切换期间可能重新挂载，
 * 第一次挂载就把引用取走、第二次挂载上就什么都没有了。改成读 + 显式清除：
 * 引用在发送或用户点掉之后才消失，重挂载不会丢。
 */
export function getSideChatSeed(sessionID: string): SideChatSeed | undefined {
  return pending.get(sessionID)
}

/** 兼容旧的一步取走语义（测试与非面板调用点使用）。 */
export function takeSideChatSeed(sessionID: string): SideChatSeed | undefined {
  const value = pending.get(sessionID)
  pending.delete(sessionID)
  return value
}

/** 清除待带入内容（发送后 / 用户移除引用后 / 关闭会话时）。 */
export function clearSideChatSeed(sessionID: string) {
  pending.delete(sessionID)
}

/**
 * 把「文件 + 行号区间 + 选中内容」整理成引用卡片。
 *
 * 文案只标路径与行号 —— 模型能据此定位，用户也能看出这是哪一段。
 */
export function buildSelectionQuote(input: { path: string; start: number; end: number; code: string }): SideChatQuote {
  const range = input.start === input.end ? `第 ${input.start} 行` : `第 ${input.start}-${input.end} 行`
  return {
    text: input.code.replace(/\n+$/, ""),
    label: `${input.path} ${range}`,
    path: input.path,
  }
}

/** 兼容旧调用：把引用拼成一段直接可读的文本（用于"在主线打开"等场景）。 */
export function buildSelectionSeed(input: { path: string; start: number; end: number; code: string }): string {
  const quote = buildSelectionQuote(input)
  return `${quote.label}：\n\n\`\`\`\n${quote.text}\n\`\`\`\n\n`
}
