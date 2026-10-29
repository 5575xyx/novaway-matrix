import { createMemo, on } from "solid-js"
import { findLast } from "@novaway/core/util/array"
import type { Message, Part, UserMessage } from "@novaway/sdk/v2/client"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { same } from "@/utils/same"
import { getSessionContextMetrics } from "./session-context-metrics"
import { estimateSessionContextBreakdown } from "./session-context-breakdown"

const emptyMessages: Message[] = []
const emptyUserMessages: UserMessage[] = []

// Context tab 与 Status Panel 的 Context 区块共用这条数据链路，metrics/ctx/breakdown 的计算只存在一处，
// 两处因此必然显示同一组数字（breakdown 的 memo 依赖与原先 tab 内实现逐字一致）。
export function useSessionContextData() {
  const sync = useSync()
  const providers = useProviders()
  const { params } = useSessionLayout()

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))

  const messages = createMemo(
    () => {
      const id = params.id
      if (!id) return emptyMessages
      return sync.data.message[id] ?? emptyMessages
    },
    emptyMessages,
    { equals: same },
  )

  const userMessages = createMemo(() => messages().filter((m) => m.role === "user"), emptyUserMessages, {
    equals: same,
  })

  const visibleUserMessages = createMemo(
    () => {
      const revert = info()?.revert?.messageID
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    { equals: same },
  )

  const systemPrompt = createMemo(() => {
    const msg = findLast(visibleUserMessages(), (m) => !!m.system)
    return msg?.system?.trim() || undefined
  })

  const compaction = createMemo(() => sync.data.config?.compaction)
  const metrics = createMemo(() => getSessionContextMetrics(messages(), providers.all(), compaction()))
  const ctx = createMemo(() => metrics().context)

  const breakdown = createMemo(
    on(
      () => [ctx()?.message.id, ctx()?.input, messages().length, systemPrompt()],
      () => {
        const c = ctx()
        if (!c?.input) return []
        return estimateSessionContextBreakdown({
          messages: messages(),
          parts: sync.data.part as Record<string, Part[] | undefined>,
          input: c.input,
          systemPrompt: systemPrompt(),
        })
      },
    ),
  )

  return { info, messages, userMessages, visibleUserMessages, systemPrompt, metrics, ctx, breakdown }
}
