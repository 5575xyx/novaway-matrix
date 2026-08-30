// 跨层跳转信号:信息页的"消息"列表跑在插件槽里,和会话区(index.tsx)隔着一层
// 插件系统,没法直接传回调;用模块级信号解耦 —— 列表写目标,index 订阅并滚动。
// nonce 让"连点同一条消息"也能再次触发(否则 signal 值没变,不会重跑)。
import { createSignal } from "solid-js"

const [messageJump, setMessageJump] = createSignal<{ messageID: string; nonce: number } | null>(null)

export { messageJump, setMessageJump }
