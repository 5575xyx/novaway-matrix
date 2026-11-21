import { Component, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { ProviderIcon } from "@novaway/ui/provider-icon"
import { usePlatform } from "@/context/platform"
import { providerIconId } from "@/utils/provider-icon"

/**
 * 供应商图标。
 *
 * 「内置」网关就是本产品自己，图标直接跟随「设置 → 应用图标与名称」里当前选择的
 * 应用图标（主进程按当前主题下发对应变体），换图标或切深浅色时同步变化；
 * web 端或取不到图标时回退到内置品牌标志。其他供应商仍按厂商解析品牌图标。
 */
export const ProviderAvatar: Component<{
  id: string
  name?: string
  brand?: boolean
  class?: string
}> = (props) => {
  const platform = usePlatform()
  const [iconData, setIconData] = createSignal<string>()

  // 详情页头部是复用同一实例、靠响应式 props 切换供应商的，
  // 所以这里必须跟随 props.id 变化重新订阅，不能只在挂载时判断一次。
  createEffect(() => {
    if (props.id !== "builtin" || platform.platform !== "desktop") {
      setIconData(undefined)
      return
    }

    let cancelled = false
    void platform.getAppAppearance?.().then((appearance) => {
      if (!cancelled) setIconData(appearance.iconData)
    })
    const dispose = platform.onAppAppearanceChange?.((appearance) => setIconData(appearance.iconData))
    onCleanup(() => {
      cancelled = true
      dispose?.()
    })
  })

  return (
    <Show
      when={props.id === "builtin" ? iconData() : undefined}
      fallback={
        <ProviderIcon
          id={props.id === "builtin" ? "nova" : providerIconId(props.id, props.name)}
          colorId={props.id}
          brand={props.brand}
          class={props.class}
        />
      }
    >
      {(src) => <img src={src()} alt="" class={`object-contain ${props.class ?? ""}`} draggable={false} />}
    </Show>
  )
}
