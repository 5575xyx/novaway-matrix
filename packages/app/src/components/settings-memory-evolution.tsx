import { createSignal, Show, type Component } from "solid-js"
import { SettingsMemory } from "./settings-memory"
import { SettingsEvolution } from "./settings-evolution"
import { SettingsPage } from "./settings-parts"

/** 设置侧栏：记忆 + 进化合并为一页，内部 tab 切换 */
export const SettingsMemoryEvolution: Component<{ directory?: string }> = (props) => {
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
            "bg-selected text-foreground border-border": sub() === "memory",
            "bg-transparent text-foreground-subtle border-transparent hover:bg-hover": sub() !== "memory",
          }}
          onClick={() => setSub("memory")}
        >
          记忆
        </button>
        <button
          type="button"
          class="h-9 px-4 rounded-md text-13-medium border transition-colors"
          classList={{
            "bg-selected text-foreground border-border": sub() === "evolution",
            "bg-transparent text-foreground-subtle border-transparent hover:bg-hover": sub() !== "evolution",
          }}
          onClick={() => setSub("evolution")}
        >
          进化
        </button>
      </div>
      <Show when={sub() === "memory"}>
        <SettingsMemory embedded directory={props.directory} />
      </Show>
      <Show when={sub() === "evolution"}>
        <SettingsEvolution embedded directory={props.directory} />
      </Show>
    </SettingsPage>
  )
}
