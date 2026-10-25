import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { activeHooksLabel, formatHookElapsed, type ActiveHook } from "./hooks-section-model"
import type { StatusPanelSection } from "./status-panel"

const EMPTY: ActiveHook[] = []

/**
 * 「正在运行的 Hook」。
 *
 * 只有声明了 `statusMessage` 的 Hook 才会出现在这里 —— 状态条回答的是
 * "这一轮为什么慢"，没写提示语的 Hook 无话可说，不该占位置。
 *
 * 钩子通常几百毫秒内结束，所以轮询要比其他区块更勤（800ms）；没有活动时
 * 退到 4s，避免空闲会话持续打请求。整块在没有活动 Hook 时完全不挂载。
 */
export function useHooksSection(sessionID: () => string): () => StatusPanelSection | null {
  const sdk = useSDK()
  const language = useLanguage()
  const [store, setStore] = createStore({
    hooks: EMPTY,
    now: Date.now(),
    error: "",
  })

  let inflight = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const signature = (hooks: ActiveHook[]) => JSON.stringify(hooks)

  const load = () => {
    if (inflight || disposed) return
    inflight = true
    void sdk.client.hook
      .active({ directory: sdk.directory })
      .then((result) => {
        const hooks = (result.data ?? EMPTY) as ActiveHook[]
        if (signature(hooks) !== signature(store.hooks)) setStore({ hooks, now: Date.now(), error: "" })
        else setStore("now", Date.now())
      })
      .catch((err: unknown) => {
        // A hook probe failing must never break the panel; stay quiet and retry.
        setStore("now", Date.now())
        void err
      })
      .finally(() => {
        inflight = false
        schedule()
      })
  }

  const schedule = () => {
    if (disposed) return
    clearTimeout(timer)
    timer = setTimeout(load, store.hooks.length > 0 ? 800 : 4000)
  }

  createEffect(
    on(sessionID, () => {
      setStore({ hooks: EMPTY, now: Date.now(), error: "" })
      load()
    }),
  )

  onCleanup(() => {
    disposed = true
    clearTimeout(timer)
  })

  const hooks = createMemo(() => [...store.hooks].toSorted((a, b) => Number(a.startedAt) - Number(b.startedAt)))

  const section = createMemo(() => {
    if (hooks().length === 0) return null
    return {
      id: "hooks",
      title: language.t("statusPanel.hooks.title"),
      summary: <span class="tabular-nums">{activeHooksLabel(hooks())}</span>,
      defaultOpen: false,
      children: (
        <div class="flex flex-col gap-0.5 pb-1">
          <For each={hooks()}>
            {(hook) => (
              <div class="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5">
                <Icon name="prompt" size="small" class="mt-0.5 shrink-0 animate-pulse text-foreground" />
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-ui-base text-foreground">{hook.message}</span>
                    <span class="shrink-0 text-ui-xs tabular-nums text-foreground-subtle">
                      {formatHookElapsed(Number(hook.startedAt), store.now)}
                    </span>
                  </div>
                  <div class="mt-0.5 truncate text-ui-xs text-foreground-subtlest">
                    {hook.event} · {hook.source}
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      ),
    } satisfies StatusPanelSection
  })

  return section
}
