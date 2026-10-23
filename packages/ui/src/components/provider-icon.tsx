import type { Component, JSX } from "solid-js"
import { createMemo, splitProps } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import { iconNames, type IconName } from "./provider-icons/types"
import { providerBrandColor } from "./provider-icons/brand"

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: string
  /**
   * 用厂商品牌色渲染。
   *
   * 默认关闭（保持用界面前景色，适合"选中态"这种需要统一的场景）；
   * 供应商列表、模型选择这类"要一眼认出是谁"的地方应开启。
   */
  brand?: boolean
  /**
   * 查品牌色用的 id（默认等于 `id`）。
   *
   * 多个供应商可能共用同一个图标（SenseNova 与 NovaWay 都用 `nova`），
   * 但品牌色不同；调用方把原始 provider id 传进来即可各用各的颜色。
   */
  colorId?: string
}

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList", "brand", "colorId", "style"])
  const resolved = createMemo(() => (iconNames.includes(local.id as IconName) ? local.id : "synthetic"))
  const color = createMemo(() => {
    if (!local.brand) return undefined
    return providerBrandColor(local.colorId) ?? providerBrandColor(local.id)
  })

  return (
    <svg
      data-component="provider-icon"
      data-brand={color() ? "" : undefined}
      {...rest}
      style={{
        ...(typeof local.style === "object" ? local.style : {}),
        ...(color() ? { color: color() } : {}),
      }}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <use href={`${sprite}#${resolved()}`} />
    </svg>
  )
}
