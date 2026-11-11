import type { JSX } from "solid-js"

export function PlatformIcon(props: {
  svg: string
  color?: string
  markColor?: string
  class?: string
  classList?: JSX.HTMLAttributes<HTMLSpanElement>["classList"]
}) {
  return (
    <span
      data-component="platform-icon"
      aria-hidden="true"
      class={props.class}
      classList={props.classList}
      style={{
        color: props.color ?? "var(--icon-interactive-base)",
        "--platform-icon-mark": props.markColor ?? "var(--text-on-interactive-base)",
      }}
      innerHTML={props.svg}
    />
  )
}
