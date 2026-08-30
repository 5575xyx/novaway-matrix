import type { AssistantMessage } from "@novaway/sdk-v2-latest/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  // 缓存命中率:全会话累计(和桌面端 session-context-metrics 的 getSessionCacheMetrics 同一算法)
  // 命中率 = 缓存读取 / 总输入(未命中输入 + 缓存读 + 缓存写),只统计真的带了输入的助手消息。
  const cache = createMemo(() => {
    let input = 0
    let cacheRead = 0
    let cacheWrite = 0
    let calls = 0
    for (const message of msg()) {
      if (message.role !== "assistant") continue
      const tokens = message.tokens
      if (!tokens) continue
      if (tokens.input + tokens.cache.read + tokens.cache.write <= 0) continue
      input += tokens.input
      cacheRead += tokens.cache.read
      cacheWrite += tokens.cache.write
      calls += 1
    }
    const totalInput = input + cacheRead + cacheWrite
    return {
      calls,
      hitRate: totalInput > 0 ? cacheRead / totalInput : null,
    }
  })
  const hitRateText = createMemo(() => {
    const value = cache().hitRate
    if (value == null) return undefined
    return `${Math.round(value * 1000) / 10}%`
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>上下文</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% 已使用</text>
      <Show when={hitRateText()}>
        {(text) => <text fg={theme().textMuted}>缓存命中 {text()} · {cache().calls} 次</text>}
      </Show>
      <text fg={theme().textMuted}>{money.format(cost())} 已花费</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
