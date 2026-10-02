// 阶梯入场(原型 card-design-v7.html 的 `.stagger` + `--d`)。
//
// 原型是 CSS `animation-delay` 按序号递增;终端没有 CSS,等效物是**延迟淡入**:
// 描边色先按 enterDelay 等一会儿,再用 ENTER_FADE_MS 从起点色插到渐变终色。
//
// 这里只放「延迟怎么算」这一层。剩下的两半各自落在别处:
//   - 卡片怎么画这段淡入:ui/card.ts 的 enterDelay / enterFrom。
//   - 哪些卡片该入场:调用方。入场判定不是这里决定的 —— 见下面 createEnterBaseline。

import { createEffect, createSignal, on, type Accessor } from "solid-js"

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
   * 这一代基线里,这条消息的入场延迟(毫秒)。返回 undefined = 不入场,调用方别传 enterDelay。
   *
   * 「不入场」有两种情况:建基线时就已经在屏幕上的(首屏)、以及建完之后被归入初始集合的
   * (视图/标签切换后重建的那一代,见 createEnterBaselineStore)。
   *
   * **同一个 id 在同一代里永远给同一个答案** —— 这条不是可有可无的幂等,见下面的说明。
   */
  delayFor(messageID: string): number | undefined
}

/**
 * 一代入场基线。构造时把给定的 id 全部记为「不入场」,之后才出现的 id 才领一个按入场序号
 * 递增的延迟。
 *
 * **为什么必须按 id 判而不是按「组件刚挂载」判**:消息列表是窗口化的
 * (util/message-window.ts),向上滚动补载时历史消息会被重新挂载。若入场挂在 mount 上,
 * 每补载一段就整屏淡入一次 —— 滚一次闪一次。id 集合与挂载时机无关,所以补载的老消息
 * 永远不会二次入场。
 *
 * 基线建好之后**只增不减**:一条消息被撤销又恢复、或者滚出窗口再滚回来,拿到的都是第一次
 * 的答案。这里刻意**不是** one-shot(第二次问同一个 id 就返回 undefined):
 *
 *   · `enterDelay` 是 JSX 属性,表达式 `ctx.enterDelayFor(props.message.id)` 依赖 props.message
 *     —— 流式期间消息对象每次更新都是新身份,那个 effect 于是**反复**重跑,同一条消息被问上
 *     几十次。若第二次就返回 undefined,ui/card.ts 的 enterDelay setter 会把它当成「取消入场」
 *     (setter 只有在 painted 时才忽略非 undefined 的值,undefined 一律接受),于是正在进行的
 *     150ms 淡入被当场掐掉、卡片直接跳到终态 —— 卡片动画等于没有。
 *   · 同一代里答案不变,setter 的 `value === this.enterMs` 守卫就让这些重跑变成真正的 no-op。
 *
 * 「不要重播」这件事改由**作废这一代基线**来表达,而不是由「问两次」来表达:
 * 见 createEnterBaselineStore。
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

/**
 * 会话级的那一份基线,外加「哪一刻作废重来」。
 *
 * **为什么需要作废**:D4 的两个 `<Show>`(气泡视图 / 流程图视图)是**当场销毁旧视图、建出新
 * 视图**,`Show when={activeTabId() === "chat"}` 那一层同理(开文件标签页就会重挂)。于是切回
 * 气泡视图时,每一张消息卡都拿到的是一个**全新**的 NeonBoxRenderable —— 而 ui/card.ts 的
 * 「入场只播一次」守卫是**按实例**记的(`painted` 为 false 的新实例照收 enterDelay)。
 * 结果就是:视图淡入那 300ms 之后,整屏 60 张卡又按 40ms 一档重播一遍 320ms + 150ms 的
 * 阶梯入场。这正是 id 基线当初要防的那件事,只不过触发它的不是窗口补载而是视图切换。
 *
 * 作废的做法是**重建一代基线**:此刻已知的 id 全部落进「初始集合」,于是重挂上来的每一张卡
 * 拿到的都是 undefined,直接是终态,一帧都不淡入。序号同时归零 —— 切换之后才到的消息重新从
 * 第 0 档开始,阶梯只交代「这一批里前面的先亮」。
 *
 * 为什么不选「同一个 id 第二次问就返回 undefined」:见 createEnterBaseline 末尾那段
 * (流式重渲染会把正在进行的淡入掐掉)。那条路看着更省事,代价是卡片动画直接失效。
 *
 * `resetOn` 由调用方给,因为「什么会重挂消息子树」是 routes/session 的布局事实,不是这里能
 * 知道的:视图切换与标签切换各算一种。重挂的通道以后再加,往这个 accessor 里加一项即可。
 */
export function createEnterBaselineStore(input: {
  /** 每次(重新)建基线时读它:此刻已知的消息 id。 */
  known: Accessor<Iterable<string>>
  /** 它翻转时重建基线 —— 见上面那段注释。 */
  resetOn: Accessor<unknown>
}): Accessor<EnterBaseline> {
  const [baseline, setBaseline] = createSignal(createEnterBaseline(input.known()))
  // defer:首挂载时不必重建 —— 构造时那份快照就是首屏,重建只会把序号清零。
  createEffect(on(input.resetOn, () => setBaseline(createEnterBaseline(input.known())), { defer: true }))
  return baseline
}
