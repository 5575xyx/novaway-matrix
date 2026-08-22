import { For, Show, type Component } from "solid-js"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Tooltip } from "@novaway/ui/tooltip"
import { appModeConfig, type AppMode, type AppModeConfig } from "@/context/layout"
import { ModeBadge } from "@/components/mode-visual"

export const ModeSwitchButton: Component<{
  current?: AppMode
  modes: AppModeConfig[]
  expanded: boolean
  onSelect: (mode: AppMode) => void
}> = (props) => {
  const current = () => appModeConfig(props.current) ?? props.modes[0]

  return (
    <DropdownMenu placement="bottom" gutter={8}>
      <Tooltip placement="bottom" value={`当前模式：${current()?.shortName ?? ""}`}>
        <DropdownMenu.Trigger
          class="group flex h-10 items-center gap-2 rounded-[18px] border border-border-weak-base bg-surface-raised-base/88 px-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.14)] transition-all hover:scale-105 hover:border-border-active data-[expanded]:border-border-active"
          aria-label="切换工作模式"
        >
          <Show when={current()}>{(mode) => <ModeBadge mode={mode()} />}</Show>
          <Show when={props.expanded}>
            <span class="pr-1.5 text-12-medium text-text-base">{current()?.shortName}</span>
          </Show>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="z-50 w-86 rounded-3xl border border-border-weak-base bg-surface-raised-stronger-non-alpha p-3 shadow-[var(--shadow-lg-border-base)] backdrop-blur-xl">
          <div class="px-3 pb-2 pt-1">
            <div class="text-13-medium text-text-strong">切换工作模式</div>
            <div class="text-12-regular text-text-weak">不同模式拥有独立项目列表，设置资源保持共享。</div>
          </div>
          <For each={props.modes}>
            {(mode) => (
              <DropdownMenu.Item
                class="flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 outline-none transition-colors hover:bg-surface-base-hover data-[highlighted]:bg-surface-base-hover"
                onSelect={() => props.onSelect(mode.id)}
              >
                <ModeBadge mode={mode} compact />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-13-medium text-text-strong">{mode.name}</span>
                    <Show when={props.current === mode.id}>
                      <span class="rounded-full bg-surface-base-active px-1.5 py-0.5 text-10-medium text-text-base">
                        当前
                      </span>
                    </Show>
                  </div>
                  <div class="truncate text-12-regular text-text-weak">{mode.description}</div>
                </div>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
