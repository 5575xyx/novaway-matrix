// 阶梯入场(原型 card-design-v7.html 的 `.stagger` + `--d`)。
//
// 原型是 CSS `animation-delay` 按序号递增;终端没有 CSS,等效物是**延迟淡入**:
// 描边色先按 enterDelay 等一会儿,再用 ENTER_FADE_MS 从起点色插到渐变终色。
//
// 这里只放「延迟怎么算」这一层。剩下的两半各自落在别处:
//   - 卡片怎么画这段淡入:ui/card.ts 的 enterDelay / enterFrom。
//   - 哪些卡片该入场:调用方。入场判定不是这里决定的 —— 见下面 createEnterBaseline。

// 相邻卡片的延迟步长。原型是 .05/.14/.23/.32… 也就是 90ms 一步,但原型一屏只有 8 张卡。
// 终端的会话流一屏能挂 60 条消息(MESSAGE_WINDOW_INITIAL),照搬 90ms 的话最后一条要压着
// 5 秒多的黑边才亮;40ms 是「相邻两张卡一前一后亮起」刚好能看清的最小步长(低于它两帧之间
// 肉眼看不出先后),150ms 的淡入时长也正好跨过 4 个 40ms 步 —— 阶梯感来自步长与淡入时长的
// 这个配比,不是来自步长本身。
export const ENTER_STAGGER_STEP = 40

// 阶梯封顶在第几档。40ms × 8 = 320ms:不封顶的话第 60 条消息要等 2.36s,而那正是用户刚发出去、
// 正盯着等回复的那一条。第 9 张及以后的卡一起入场 —— 阶梯只用来交代「前面的先亮」,
// 不是用来给新消息排队的(新消息永远落在最后一条已入场的卡之后,序号不追历史)。
export const ENTER_STAGGER_MAX_INDEX = 8

export type EnterBaseline = {
  /**
   * 这条消息的入场延迟(毫秒)。返回 undefined = 不入场,调用方别传 enterDelay。
   *
   * 「不入场」的三种情况:首次挂载时就已经在屏幕上的、窗口补载重新挂载的历史消息、
   * 以及重复求值到的那一次(同一个 id 永远给同一个答案)。
   */
  delayFor(messageID: string): number | undefined
}

/**
 * 会话级入场基线。首次挂载时把当时已知的消息 id 全部记为「不入场」,
 * 之后才出现的 id 才领一个按入场序号递增的延迟。
 *
 * **为什么必须按 id 判而不是按「组件刚挂载」判**:消息列表是窗口化的
 * (util/message-window.ts),向上滚动补载时历史消息会被重新挂载。若入场挂在 mount 上,
 * 每补载一段就整屏淡入一次 —— 滚一次闪一次。id 集合与挂载时机无关,所以补载的老消息
 * 永远不会二次入场。
 *
 * 基线在组件体里建一次(Session 换会话时重建),之后**只增不减**:一条消息被撤销又恢复、
 * 或者滚出窗口再滚回来,拿到的都是第一次的答案。
 */
export function createEnterBaseline(initialIDs: Iterable<string>): EnterBaseline {
  const delay = new Map<string, number>()
  let step = 0
  for (const id of initialIDs) delay.set(id, -1)
  return {
    delayFor(messageID) {
      const known = delay.get(messageID)
      if (known !== undefined) return known === -1 ? undefined : known
      const value = Math.min(step, ENTER_STAGGER_MAX_INDEX) * ENTER_STAGGER_STEP
      step++
      delay.set(messageID, value)
      return value
    },
  }
}
