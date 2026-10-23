import { type JSX } from "solid-js"

export type SidebarMenuTone = "neutral" | "blue" | "violet" | "amber" | "emerald" | "pink"

// 带色图标块：不是 emoji，而是给线性图标一个浅色底 + 同色描边感。
// 颜色按功能固定，用户扫一眼就能靠颜色定位（数据库蓝、知识库绿、自动化琥珀…）。
const TONES: Record<Exclude<SidebarMenuTone, "neutral">, { color: string; background: string }> = {
  blue: { color: "#3b82f6", background: "color-mix(in srgb, #3b82f6 16%, transparent)" },
  violet: { color: "#8b5cf6", background: "color-mix(in srgb, #8b5cf6 16%, transparent)" },
  amber: { color: "#f59e0b", background: "color-mix(in srgb, #f59e0b 18%, transparent)" },
  emerald: { color: "#10b981", background: "color-mix(in srgb, #10b981 16%, transparent)" },
  pink: { color: "#ec4899", background: "color-mix(in srgb, #ec4899 16%, transparent)" },
}

// 侧栏底部导航：一行一项，图标 + 文字标签。
// 默认 14px；非「设置」的主入口用 large 形态（15px + 26px 彩色图标块），
// 设置是低频入口，保持原尺寸以形成主次。
export function SidebarMenuRow(props: {
  icon: JSX.Element
  label: string
  trailing?: JSX.Element
  onClick: () => void
  tone?: SidebarMenuTone
  size?: "default" | "large"
}) {
  const tone = () => (props.tone && props.tone !== "neutral" ? TONES[props.tone] : undefined)
  const large = () => props.size === "large"

  return (
    <button
      type="button"
      data-component="sidebar-menu-row"
      class="group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-foreground transition-colors hover:bg-hover"
      classList={{
        "text-14-semibold": !large(),
        "text-[15px] font-medium": large(),
      }}
      onClick={props.onClick}
    >
      <span
        class="flex shrink-0 items-center justify-center"
        classList={{
          "size-4.5 text-foreground-subtle": !tone() && !large(),
          "size-6.5 rounded-[7px] [&_svg]:size-[17px]": large(),
        }}
        style={
          tone()
            ? { color: tone()!.color, background: tone()!.background }
            : large()
              ? { color: "var(--foreground-subtle)" }
              : undefined
        }
      >
        {props.icon}
      </span>
      <span class="flex-1 truncate text-left">{props.label}</span>
      {props.trailing}
    </button>
  )
}
