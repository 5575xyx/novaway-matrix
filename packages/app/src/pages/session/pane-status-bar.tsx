/**
 * 右栏底部常驻状态栏：
 * 一行放不下不换行 —— 左侧是按类型的信息（页 x/y、行列、字数、选区聚合），
 * 右侧是统一的缩放控件（− 百分比 ＋ 适应）。每一种文件的缩放入口只有这里，
 * 不再各自在工具条/检查器里再摆一套。
 *
 * 缩放状态由每种文件自己维护（有的跟面板宽度走，有的按百分比钉住），
 * 这里只负责「长什么样、怎么点」，不存值。
 */
import type { JSX } from "solid-js"
import type { Component } from "solid-js"
import { Icon } from "@novaway/ui/icon"

export type PaneZoom = {
  /** 当前百分比（100 = 原始 / 适应）。 */
  value: () => number
  /** 放大（true）或缩小（false）一步。 */
  onStep: (zoomIn: boolean) => void
  /** 点百分比数字：回到默认（通常 100%）。 */
  onReset: () => void
  /** 「适应」按钮文案；传了就显示适应按钮。 */
  fitLabel?: string
  /** 点「适应」做什么；不传则只复位百分比。 */
  onFit?: () => void
  /** 是否正处于适应态（百分比高亮成强调色）。 */
  fitted?: () => boolean
}

export const PaneStatusBar: Component<{
  /** 左侧信息区：页 x/y、行列、字数、选区聚合等，由各类型自己拼。 */
  info?: JSX.Element
  /** 类型自己的动作（如 pptx 的「放映」），放在信息区右侧、缩放之前。 */
  extra?: JSX.Element
  zoom?: PaneZoom
}> = (props) => {
  return (
    <div
      class="flex h-8 shrink-0 items-center gap-3 overflow-hidden border-t border-border px-3"
      data-component="pane-status-bar"
    >
      <div class="flex min-w-0 flex-1 items-center gap-3 text-11-regular text-foreground-subtlest">{props.info}</div>
      <div class="flex shrink-0 items-center gap-2">{props.extra}</div>
      {props.zoom ? (
        <div class="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-action="pane-zoom-out"
            class="grid size-6 place-items-center rounded text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
            aria-label="缩小"
            title="缩小"
            onClick={() => props.zoom!.onStep(false)}
          >
            <Icon name="minus" size="small" />
          </button>
          <button
            type="button"
            data-action="pane-zoom-reset"
            class="min-w-12 rounded px-1 text-center text-ui-xs tabular-nums transition-colors hover:bg-hover hover:text-foreground"
            classList={{
              "text-icon-blue": props.zoom.fitted?.() ?? false,
              "text-foreground-subtle": !(props.zoom.fitted?.() ?? false),
            }}
            aria-label="复位缩放"
            title="复位缩放"
            onClick={() => props.zoom!.onReset()}
          >
            {props.zoom.value()}%
          </button>
          <button
            type="button"
            data-action="pane-zoom-in"
            class="grid size-6 place-items-center rounded text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
            aria-label="放大"
            title="放大"
            onClick={() => props.zoom!.onStep(true)}
          >
            <Icon name="plus" size="small" />
          </button>
          {props.zoom.fitLabel ? (
            <button
              type="button"
              data-action="pane-zoom-fit"
              class="ml-1 rounded px-1.5 py-0.5 text-ui-xs transition-colors hover:bg-hover hover:text-foreground"
              classList={{
                "text-icon-blue": props.zoom.fitted?.() ?? false,
                "text-foreground-subtle": !(props.zoom.fitted?.() ?? false),
              }}
              title={props.zoom.fitLabel}
              onClick={() => {
                if (props.zoom!.onFit) props.zoom!.onFit()
                else props.zoom!.onReset()
              }}
            >
              {props.zoom.fitLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
