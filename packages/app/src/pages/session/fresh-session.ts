/**
 * 「本轮运行里由我们自己创建、并且确定是空的」会话 id。
 *
 * 用途：会话页的时间线在消息数据到达前会显示骨架屏（pulsing 假气泡）。对**已有会话**
 * 这是对的——不显示骨架就会先闪一个空时间线再补上内容。
 * 但对**刚由我们发起的会话**，我们知道它必然是空的，骨架屏就是纯粹的多余一帧：
 * 新建任务后发送第一条消息时，用户会看到 "骨架屏闪一下 → 时间线 → 输入框落位动画"。
 *
 * 所以创建成功后在这里登记一笔，时间线直接跳过骨架屏。
 * 只增不删（一次运行里的会话 id 不会复用），也不需要持久化。
 */
const fresh = new Set<string>()

export function markSessionFresh(id: string) {
  fresh.add(id)
}

export function isSessionFresh(id: string | undefined): boolean {
  return !!id && fresh.has(id)
}
