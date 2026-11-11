import type { Component, JSX } from "solid-js"
import { createMemo, splitProps } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import { iconNames, type IconName } from "./provider-icons/types"
import { providerBrandColor } from "./provider-icons/brand"

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: string
  /** Use the manufacturer's primary hue, resolved by the active theme for contrast. */
  brand?: boolean
  /** Provider id for manufacturer color lookup (defaults to `id`). */
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
