import { Switch as Kobalte } from "@kobalte/core/switch"
import { createEffect, createSignal, onCleanup, Show, splitProps } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"

export interface SwitchProps extends ParentProps<ComponentProps<typeof Kobalte>> {
  hideLabel?: boolean
  description?: string
}

export function Switch(props: SwitchProps) {
  const [local, others] = splitProps(props, ["children", "class", "hideLabel", "description", "checked", "onChange"])

  /*
   * 乐观回显：开关的真实状态来自服务端 config，写盘 + 失效实例要几百毫秒。
   * 这段时间里如果只等 props 回流，拇指不动，用户会以为「点了没反应」。
   * 这里先本地翻转，等服务端值追上来再交还控制权；4 秒仍未确认则回滚。
   */
  const [optimistic, setOptimistic] = createSignal<boolean>()
  let timer: number | undefined
  createEffect(() => {
    const value = local.checked
    if (value === undefined) return
    if (optimistic() === value) setOptimistic(undefined)
  })
  onCleanup(() => {
    if (timer !== undefined) window.clearTimeout(timer)
  })
  const checked = () => optimistic() ?? local.checked
  const change = (value: boolean) => {
    setOptimistic(value)
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => setOptimistic(undefined), 4000)
    local.onChange?.(value)
  }

  return (
    <Kobalte {...others} checked={checked()} onChange={change} class={local.class} data-component="switch">
      <Kobalte.Input data-slot="switch-input" />
      <Show when={local.children}>
        <Kobalte.Label data-slot="switch-label" classList={{ "sr-only": local.hideLabel }}>
          {local.children}
        </Kobalte.Label>
      </Show>
      <Show when={local.description}>
        <Kobalte.Description data-slot="switch-description">{local.description}</Kobalte.Description>
      </Show>
      <Kobalte.ErrorMessage data-slot="switch-error" />
      <Kobalte.Control data-slot="switch-control">
        <Kobalte.Thumb data-slot="switch-thumb" />
      </Kobalte.Control>
    </Kobalte>
  )
}
