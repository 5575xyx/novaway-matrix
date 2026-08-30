// 消息窗口:长会话不一次性挂载全部消息。
//
// 同步层把会话消息封在 100 条以内,但一条消息会展开成若干工具行 + markdown + 语法高亮,
// 一口气全挂上就是"打开长会话 / 切会话时卡一下"的来源。这里只算窗口边界,
// 滚动交互留在组件里。

export const MESSAGE_WINDOW_INITIAL = 60
export const MESSAGE_WINDOW_STEP = 60

export type MessageWindow = {
  /** 窗口起点在全量列表里的下标。渲染时要用它把局部下标还原成全量下标。 */
  offset: number
  /** 窗口上方还没挂载的消息条数,0 表示已经到头。 */
  hidden: number
}

/** 给定消息总数和当前窗口大小,算出窗口边界。窗口永远贴着列表尾部。 */
export function messageWindow(total: number, size: number): MessageWindow {
  const offset = Math.max(0, total - Math.max(1, size))
  return { offset, hidden: offset }
}

/** 往前扩一段。到头之后再扩也不会越界,因为 offset 由 total 兜住。 */
export function expandMessageWindow(size: number, step = MESSAGE_WINDOW_STEP) {
  return size + step
}
