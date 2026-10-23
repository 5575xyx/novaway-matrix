import { type Component, type JSX } from "solid-js"

// 对齐 ZCode 设置页的行式布局（`SettingsPageParts`）：
// 一个圆角分组卡片里排若干行，行与行之间用 1px 分隔线，左侧是标题 + 说明，
// 右侧是控件（开关 / 输入框 / 按钮）。旧实现是「每项一张竖排小卡片」，
// 开关被放到说明下方，视觉上更像表单而不像设置项，这里统一掉。
export const SettingsGroup: Component<{ children: JSX.Element; class?: string }> = (props) => (
  <div class={`overflow-hidden rounded-xl border border-border bg-surface ${props.class ?? ""}`}>{props.children}</div>
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
    class={`group border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-hover/50 ${
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
