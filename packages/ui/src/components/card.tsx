import { type ComponentProps, splitProps } from "solid-js"
import { Icon, type IconProps } from "./icon"

type Variant = "normal" | "error" | "warning" | "success" | "info"

export interface CardProps extends ComponentProps<"div"> {
  variant?: Variant
}

export interface CardTitleProps extends ComponentProps<"div"> {
  variant?: Variant

  /**
   * Optional title icon.
   *
   * - `undefined`: picks a default icon based on `variant` (error/warning/success/info)
   * - `false`/`null`: disables the icon
   * - `Icon` name: forces a specific icon
   */
  icon?: IconProps["name"] | false | null
}

function pick(variant: Variant) {
  if (variant === "error") return "circle-ban-sign" as const
  if (variant === "warning") return "warning" as const
  if (variant === "success") return "circle-check" as const
  if (variant === "info") return "help" as const
  return
}

export function Card(props: CardProps) {
  const [split, rest] = splitProps(props, ["variant", "style", "class", "classList"])
  const variant = () => split.variant ?? "normal"
  return (
    <div
      {...rest}
      data-component="card"
      data-variant={variant()}
      style={split.style}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {props.children}
    </div>
  )
}

export function CardTitle(props: CardTitleProps) {
  const [split, rest] = splitProps(props, ["variant", "icon", "class", "classList", "children"])
  const show = () => split.icon !== false && split.icon !== null
  const name = () => {
    if (split.icon === false || split.icon === null) return
    if (typeof split.icon === "string") return split.icon
    return pick(split.variant ?? "normal")
  }
  const placeholder = () => !name()
  return (
    <div
      {...rest}
      data-slot="card-title"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {show() ? (
        <span data-slot="card-title-icon" data-placeholder={placeholder() || undefined}>
          <Icon name={name() ?? "dash"} size="small" />
        </span>
      ) : null}
      {split.children}
    </div>
  )
}

export function CardDescription(props: ComponentProps<"div">) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div
      {...rest}
      data-slot="card-description"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </div>
  )
}

export function CardActions(props: ComponentProps<"div">) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <div
      {...rest}
      data-slot="card-actions"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </div>
  )
}
