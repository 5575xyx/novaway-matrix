import { type Component, type JSX } from "solid-js"

/**
 * 命令等工具资源行使用 tool-category 分类色：同一个条目永远同色，不同条目便于扫读。
 */
const rowAccentPalette = [
  "var(--tool-category-0)",
  "var(--tool-category-1)",
  "var(--tool-category-2)",
  "var(--tool-category-3)",
]

export function rowAccent(seed: string) {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0
  }
  return rowAccentPalette[Math.abs(hash) % rowAccentPalette.length]!
}

/** 把强调色兑进底色，得到图标块 / 头像圈的浅色背景。 */
export function rowAccentTint(color: string, percent = 14) {
  return `color-mix(in srgb, ${color} ${percent}%, var(--background))`
}

// 设置页的行式布局：
// 一个圆角分组卡片里排若干行，行与行之间用 1px 分隔线，左侧是标题 + 说明，
// 右侧是控件（开关 / 输入框 / 按钮）。旧实现是「每项一张竖排小卡片」，
// 开关被放到说明下方，视觉上更像表单而不像设置项，这里统一掉。
export const SettingsPage: Component<{
  title: string | JSX.Element
  description?: string | JSX.Element
  children: JSX.Element
  class?: string
}> = (props) => (
  <div class={`flex h-full flex-col overflow-y-auto no-scrollbar px-4 pb-10 sm:px-8 lg:px-10 ${props.class ?? ""}`}>
    <header class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--popover)_calc(100%_-_24px),transparent)]">
      <div class="mx-auto flex w-full max-w-[1040px] flex-col gap-1 pt-8 pb-7">
        <h2 class="text-24-semibold tracking-tight text-foreground">{props.title}</h2>
        {props.description ? <p class="text-13-regular text-foreground-subtle">{props.description}</p> : null}
      </div>
    </header>
    <div class="mx-auto flex w-full max-w-[1040px] flex-col gap-8">{props.children}</div>
  </div>
)

export const SettingsGroup: Component<{ children: JSX.Element; class?: string }> = (props) => (
  <div class={`overflow-hidden rounded-xl border border-border/80 bg-surface shadow-sm ${props.class ?? ""}`}>
    {props.children}
  </div>
)

export const SettingsRow: Component<{
  label: string
  description?: JSX.Element
  control: JSX.Element
  /** 行下方整行展开的补充内容（如状态块、说明文档）。 */
  detail?: JSX.Element
  /** `wide`：右侧控件更宽（输入框、分段按钮等）；默认 192px。 */
  layout?: "default" | "wide"
  class?: string
}> = (props) => (
  <div
    data-row-hover
    class={`group border-t border-border/80 px-4 py-4 transition-colors first:border-t-0 hover:bg-hover/40 ${
      props.layout === "wide" ? "flex flex-col gap-3" : ""
    } ${props.class ?? ""}`}
  >
    <div
      class={`grid items-center gap-4 ${
        props.layout === "wide"
          ? "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,280px)]"
          : "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_192px]"
      }`}
    >
      <div class="min-w-0">
        <div class="text-13-medium text-foreground">{props.label}</div>
        {props.description ? (
          <div class="mt-1 text-12-regular leading-5 text-foreground-subtle">{props.description}</div>
        ) : null}
      </div>
      <div class="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">{props.control}</div>
    </div>
    {props.detail ? <div class="mt-3">{props.detail}</div> : null}
  </div>
)
