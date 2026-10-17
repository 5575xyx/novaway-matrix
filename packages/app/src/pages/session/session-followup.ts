/**
 * 运行中提交消息的去向：排队还是立即引导。
 *
 * 对齐 Qoder 的 Settings → General → "Send while running"（文档 `qoder/conversation-input.md`）：
 *
 * | 方式 | 用途 | 行为 |
 * | --- | --- | --- |
 * | Queue | 排一个后续请求 | 留在待发队列，这轮跑完再发 |
 * | Steer | 修正方向 / 加约束 | 在**安全边界**投递，不直接中断当前运行 |
 *
 * 服务端支撑 steer 的机制（`session/prompt.ts` 的 `runLoop`）：
 * 每轮开头重读会话消息，退出条件是「最后一条 assistant 晚于最后一条 user」——
 * 所以运行中追加的 user 消息会让循环**继续**并把新消息喂给模型；
 * 而 `effect/runner.ts` 的 `ensureRunning` 会把第二次 prompt 并入正在跑的那个 loop，
 * 不会起第二个循环。两者合起来正好是 Qoder 描述的 steer 语义。
 *
 * 单独成模块是为了能单测：这段判定藏在 session.tsx 里的话，
 * 只能靠"跑一次真模型"来验证，成本高且不稳定。
 */

export type FollowupMode = "queue" | "steer"

export function shouldQueueFollowup(input: { mode: FollowupMode; live: boolean }): boolean {
  // 空闲时两种模式没有区别（都要发出去），只有运行中才分叉。
  if (!input.live) return false
  return input.mode === "queue"
}
