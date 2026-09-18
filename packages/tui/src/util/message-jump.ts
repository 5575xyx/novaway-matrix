// 跨层跳转信号:信息页的"消息"列表跑在插件槽里,和会话区(index.tsx)隔着一层
// 插件系统,没法直接传回调;用模块级信号解耦 —— 列表写目标,index 订阅并滚动。
// nonce 让"连点同一条消息"也能再次触发(否则 signal 值没变,不会重跑)。
import { createEffect, createSignal, on } from "solid-js"

const [messageJump, setMessageJump] = createSignal<{ messageID: string; nonce: number } | null>(null)

// 订阅跳转目标。用 on() 把依赖**只**挂在 messageJump 上:handler 跑在会话组件里,
// 内部要读 messages()、窗口偏移这类跟着会话同步频繁重算的 memo。裸 createEffect 会把
// 它们一并登记成依赖,于是同步层每次更新消息列表就重跑一次 handler —— 点一次之后视图
// 会被反复拉回同一条消息。on 的回调在 untrack 下执行,不追踪 handler 内部的读取。
// 在 reactive owner 中调用(组件体内),随 owner 卸载自动停止订阅。
export function subscribeMessageJump(handler: (messageID: string) => void) {
  createEffect(
    on(messageJump, (target) => {
      if (!target) return
      handler(target.messageID)
    }),
  )
}

export { messageJump, setMessageJump }
