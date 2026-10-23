import { Show, type Component, type JSX } from "solid-js"
import { Popover } from "@novaway/ui/popover"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Keybind } from "@novaway/ui/keybind"
import { useLocal } from "@/context/local"
import { useCommand } from "@/context/command"
import { useVariantLabel } from "@/hooks/use-variant-label"
import { ThinkingEffortSlider } from "./thinking-effort-slider"
import { ThinkingEffortIcon } from "./thinking-effort-icon"
import { effortRatio, effortText } from "./thinking-effort-color"

type ModelState = ReturnType<typeof useLocal>["model"]

/**
 * 思考强度下拉。
 *
 * 工具栏上只露一个「中 ⌄」——滑块收进弹层里，点开才调。
 * 这样模型选择弹层保持干净（只放模型列表），思考强度也仍然只有一个入口，
 * 不会出现「列表里一个滑块 + 工具栏一个下拉」两套并存的情况。
 *
 * 档位依旧完全由模型决定（低/中/高 或 低/中/高/高+），没有档位的模型直接不渲染。
 */
export const ThinkingEffortPopover: Component<{
  model?: ModelState
  size?: "small" | "normal"
  placement?: "top" | "top-start" | "bottom" | "bottom-start"
  triggerClass?: string
  triggerStyle?: JSX.CSSProperties
}> = (props) => {
  const local = useLocal()
  const command = useCommand()
  const variantLabel = useVariantLabel()

  const model = () => props.model ?? local.model
  const stops = () => ["default", ...model().variant.list()]
  const current = () => model().variant.current() ?? "default"
  const index = () => {
    const found = stops().indexOf(current())
    return found < 0 ? 0 : found
  }
  /** 触发器上的档位文字跟着档位变色，不点开也能看出现在"有多热"。 */
  const ratio = () => effortRatio(index(), stops().length)
  const tone = () => effortText(ratio())

  return (
    <Show when={stops().length > 1}>
      <Popover
        placement={props.placement ?? "top"}
        gutter={6}
        triggerAs={Button}
        triggerProps={{
          variant: "ghost",
          size: props.size ?? "normal",
          class: `gap-1 ${props.triggerClass ?? ""}`,
          style: props.triggerStyle,
          "data-action": "prompt-thinking",
        }}
        trigger={
          <>
            <ThinkingEffortIcon ratio={ratio()} class="shrink-0" />
            <span class="text-13-medium" style={tone()}>
              {variantLabel(current())}
            </span>
            <Icon name="chevron-down" size="small" class="shrink-0 text-foreground-subtle" />
          </>
        }
        class="w-[248px]"
      >
        <div class="flex flex-col gap-2.5 pt-0.5" data-component="thinking-effort-popover">
          <div class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-1.5">
              <ThinkingEffortIcon ratio={ratio()} class="shrink-0" />
              <span class="text-12-regular text-foreground-subtle">思考强度</span>
              <span class="text-12-medium" style={tone()}>
                {variantLabel(current())}
              </span>
            </span>
            <Show when={command.keybind("model.variant.cycle")}>
              <Keybind>{command.keybind("model.variant.cycle")}</Keybind>
            </Show>
          </div>
          <ThinkingEffortSlider
            variants={stops()}
            value={current()}
            onChange={(value) => model().variant.set(value)}
            label="思考强度"
          />
        </div>
      </Popover>
    </Show>
  )
}
