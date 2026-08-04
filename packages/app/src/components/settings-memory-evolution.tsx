import { createSignal, Show, type Component } from "solid-js"
import { SettingsMemory } from "./settings-memory"
import { SettingsEvolution } from "./settings-evolution"

const SettingsPage: Component<{ title: string; description: string; children: any }> = (props) => (
  <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
    <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
      <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
        <h2 class="text-16-medium text-text-strong">{props.title}</h2>
        <p class="text-13-regular text-text-weak">{props.description}</p>
      </div>
    </div>
    <div class="flex flex-col gap-8 w-full">{props.children}</div>
  </div>
)

/** 设置侧栏：记忆 + 进化合并为一页，内部 tab 切换 */
export const SettingsMemoryEvolution: Component = () => {
  const [sub, setSub] = createSignal<"memory" | "evolution">("memory")
  return (
    <SettingsPage
      title="记忆与进化"
      description="管理持久记忆（全局/本项目）与自我进化候选。默认开启全自动学习；进化写盘仍建议人工确认。"
    >
      <div class="flex flex-wrap gap-1 pb-2">
        <button
          type="button"
          class="h-9 px-4 rounded-md text-13-medium border transition-colors"
          classList={{
            "bg-surface-base-active text-text-strong border-border-weak-base": sub() === "memory",
            "bg-transparent text-text-weak border-transparent hover:bg-surface-base-hover": sub() !== "memory",
          }}
          onClick={() => setSub("memory")}
        >
          记忆
        </button>
        <button
          type="button"
          class="h-9 px-4 rounded-md text-13-medium border transition-colors"
          classList={{
            "bg-surface-base-active text-text-strong border-border-weak-base": sub() === "evolution",
            "bg-transparent text-text-weak border-transparent hover:bg-surface-base-hover": sub() !== "evolution",
          }}
          onClick={() => setSub("evolution")}
        >
          进化
        </button>
      </div>
      <Show when={sub() === "memory"}>
        <SettingsMemory embedded />
      </Show>
      <Show when={sub() === "evolution"}>
        <SettingsEvolution embedded />
      </Show>
    </SettingsPage>
  )
}
