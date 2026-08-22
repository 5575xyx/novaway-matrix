import { For } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { zenActions, type HomeActionId } from "@/pages/home/zen-office"

export function OfficeSceneSwitcher(props: {
  active: HomeActionId
  onSelect: (id: HomeActionId) => void
  class?: string
}) {
  return (
    <div
      role="tablist"
      aria-label="办公场景"
      class={`relative flex min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar rounded-[10px] bg-surface-weak/80 p-1 ${props.class ?? ""}`}
    >
      <For each={zenActions}>
        {(action) => {
          const active = () => officeSceneIsActive(props.active, action.id)
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active()}
              class="flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] px-3 text-12-medium transition-all duration-150"
              classList={{
                "bg-background-base text-text-strong shadow-[0_1px_4px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.7)] font-medium":
                  active(),
                "text-text-weak hover:text-text-base": !active(),
              }}
              onClick={() => props.onSelect(action.id)}
            >
              <Icon
                name={action.icon}
                size="small"
                class="shrink-0 transition-colors"
                classList={{ "text-emerald-400": active(), "text-text-muted": !active() }}
              />
              <span class="truncate">{action.title}</span>
            </button>
          )
        }}
      </For>
    </div>
  )
}

export function officeSceneIsActive(active: HomeActionId, candidate: HomeActionId) {
  return active === candidate
}
