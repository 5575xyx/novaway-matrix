import { Effect } from "effect"
import type * as Tool from "./tool"
import { MessageV2 } from "@/session/message-v2"

/**
 * 取子会话该用的模型。
 *
 * 优先 `ctx.extra.model`：那是助手轮次正在用的 `Provider.Model`，最权威，也不必读盘。
 * 只有独立调用（没有 extra）时才回落到消息表——工具可能在助手轮次之外被直接触发，
 * 那时这条回落是唯一的信息来源。
 *
 * 两个工具（创建与恢复）都要这个判断，放在一处，免得一边认 `api.id`、另一边认 `modelID`。
 */
export function resolveWorkflowModel(
  ctx: Tool.Context,
): Effect.Effect<{ providerID: string; modelID: string } | undefined> {
  // `Provider.Model` 把模型名放在 `api.id`；也接受扁平的 `{providerID, modelID}`，
  // 因为调用方不一定持有完整的模型对象。
  const extra = ctx.extra?.model as { providerID?: unknown; modelID?: unknown; api?: { id?: unknown } } | undefined
  if (typeof extra?.providerID === "string") {
    const modelID = typeof extra.api?.id === "string" ? extra.api.id : extra.modelID
    if (typeof modelID === "string") return Effect.succeed({ providerID: extra.providerID, modelID })
  }
  // 消息可能不存在（独立调用、历史被清），`NotFoundError` 甚至可能是缺陷。
  // 这两种情况都只说明「拿不到模型」，交给调用方回一句「没启动」就好，不该把工具炸掉。
  return MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
    Effect.map((message) => {
      if (message.info.role !== "assistant") return undefined
      return { providerID: message.info.providerID, modelID: message.info.modelID }
    }),
    Effect.catchCause(() => Effect.succeed(undefined)),
  )
}
