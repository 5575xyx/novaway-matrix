/**
 * 右栏的检查器抽屉。
 *
 * 工具条那一行只放命令，数值输入（x/y/宽/高/角度、裁切、页面设置、表格行列、批注回复）
 * 全部搬到这里：选中对象后从面板右缘浮出，不占用文档宽度，也不会把工具条撑成两三行。
 * 挂在宿主自己的 `relative` 容器里，所以它是面板内的浮层，不是全局弹窗 —— 文档照常可滚可点。
 */
import { Show } from "solid-js"
import type { JSX, ParentProps } from "solid-js"
import { IconButton } from "@novaway/ui/icon-button"
import { Icon } from "@novaway/ui/icon"
import { PREVIEW_ACTIVE_CLASS } from "@/pages/session/office-ribbon"

/**
 * 工具条上的「检查器」开关。
 *
 * 抽屉本身浮在文档之上，关掉只是收起浮层：选中对象、已经填进框里的数值都不动，
 * 再打开还是原样。开着的状态用主题强调色，和功能区其他「开着」的命令一致。
 */
export function InspectorToggle(props: { open: boolean; onToggle: () => void; title?: string }) {
  return (
    <button
      type="button"
      data-action="pane-inspector-toggle"
      aria-pressed={props.open}
      title={props.title ?? "打开 / 收起检查器：数值输入和低频命令都收在这里"}
      class={[
        "flex h-6 shrink-0 items-center gap-0.5 rounded border px-1.5 text-11-regular transition-colors",
        props.open
          ? PREVIEW_ACTIVE_CLASS
          : "border-transparent text-foreground-subtle hover:bg-hover hover:text-foreground",
      ].join(" ")}
      onClick={props.onToggle}
    >
      <Icon name="sliders" size="small" class="shrink-0" />
      <span class="shrink-0">检查器</span>
    </button>
  )
}

export function PaneInspector(props: {
  title: string
  /** 关掉抽屉只收起浮层，不会取消选中或回滚已经填的值。 */
  onClose: () => void
  /** 标题右边的次要说明，例如「第 3 页 · 图 2」。 */
  hint?: string
  children: JSX.Element
}) {
  return (
    <div
      data-component="pane-inspector"
      class="absolute inset-y-0 right-0 z-20 flex w-64 min-w-0 flex-col border-l border-border bg-panel/95 shadow-lg backdrop-blur-sm"
      onKeyDown={(event) => {
        // Esc 只收起浮层；不冒泡到外层，否则会被「退出编辑 / 关标签页」那些快捷键抢走。
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        props.onClose()
      }}
    >
      <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <span class="min-w-0 flex-1 truncate text-11-medium text-foreground" title={props.title}>
          {props.title}
        </span>
        <Show when={props.hint}>
          <span class="min-w-0 shrink truncate text-11-regular text-foreground-subtlest" title={props.hint}>
            {props.hint}
          </span>
        </Show>
        <IconButton
          icon="lu-x"
          variant="ghost"
          size="small"
          class="shrink-0 text-foreground-subtle"
          aria-label="关闭检查器"
          title="关闭检查器（Esc）"
          onClick={props.onClose}
        />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">{props.children}</div>
    </div>
  )
}

/** 抽屉里的一组：小标题 + 若干字段。 */
export function InspectorSection(props: ParentProps<{ label: string }>) {
  return (
    <div class="mb-3 flex flex-col gap-1.5 last:mb-0">
      <span class="text-11-regular text-foreground-subtlest">{props.label}</span>
      {props.children}
    </div>
  )
}

/**
 * 一行字段：标签在左、控件在右，数值框固定宽度。
 *
 * 数值输入是检查器里最容易失控的东西：横向排开时同一行能塞下十几个框，
 * 竖排成「标签 · 控件」两列之后，扫一眼就知道每个数字管什么。
 */
export function InspectorField(props: ParentProps<{ label: string; title?: string }>) {
  return (
    <label class="flex items-center gap-2 text-11-regular text-foreground-subtle" title={props.title}>
      <span class="w-14 shrink-0 truncate">{props.label}</span>
      <span class="flex min-w-0 flex-1 items-center gap-1">{props.children}</span>
    </label>
  )
}

/** 检查器里的数字 / 文本输入框统一样式。 */
export const INSPECTOR_INPUT =
  "h-6 min-w-0 flex-1 rounded border border-border bg-background px-1 text-11-regular text-foreground outline-none focus:border-border-hover"

/** 检查器底部的动作按钮（应用 / 保存 / 添加）。 */
export function InspectorAction(
  props: ParentProps<{ title?: string; disabled?: boolean; onClick: () => void; actionId?: string }>,
) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      title={props.title}
      data-action={props.actionId}
      class="h-7 w-full rounded border border-border bg-background text-11-medium text-foreground transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}
