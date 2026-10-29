import { Show, type JSX } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon, type IconProps } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { FRAME_WINDOW_CONTROLS_WIDTH } from "@/components/frame-window-controls"

/**
 * 覆盖式整帧页面（设置 / 知识库 / 自动化 / 扩展 / 内核 / 团队 / 运行 / 运营 / 数据库）
 * 共用的顶行。
 *
 * **为什么要有这个组件：** 这些页面盖住了会话帧 Header，窗口自绘的最小化/最大化/
 * 关闭按钮会被 `FrameWindowControls` 补在**右上角 108px**。页面自己的动作按钮如果
 * 也右对齐，就会和窗控叠在一起 —— 用户点「添加团队」点到了最小化。
 *
 * 规则（新增覆盖式页面时照此办理）：
 *
 * 1. **页面级动作放左边**：`actions` 槽位紧接标题，或放进页面左侧栏的顶部。
 *    绝不放在顶行的最右侧。
 * 2. 顶行右侧必须留空 108px（本组件自动加 `pr`），即使现在还没有右侧内容，
 *    将来加筛选器时也不会压到窗控上。
 * 3. 整行是窗口拖拽区；行内的按钮/输入框由 `index.css` 的规则自动排除拖拽，
 *    不要再手工加 `data-window-drag`。
 */
export const PAGE_HEADER_RIGHT_INSET = "pr-[108px]"

export function PageHeader(props: {
  onBack?: () => void
  title: string
  /** 标题右侧的补充说明（占一行，跟在标题下面）。 */
  hint?: string
  /** 标题左侧的小图标块；给 `accent` 会画一个同色系底。 */
  icon?: IconProps["name"]
  accent?: string
  /** 页面级动作：渲染在**标题右边**，不要放在行尾。 */
  actions?: JSX.Element
  /** 右侧内容（筛选器之类）；会自动让出窗控宽度。 */
  filters?: JSX.Element
}) {
  const language = useLanguage()
  return (
    <div
      class="flex shrink-0 flex-col border-b border-border px-4 py-3"
      style={{ "padding-right": `${FRAME_WINDOW_CONTROLS_WIDTH}px` }}
      data-window-drag
    >
      <div class="flex items-center gap-2">
        <Show when={props.onBack}>
          <Button variant="ghost" size="small" onClick={() => props.onBack?.()}>
            <Icon name="arrow-left" size="small" />
            {language.t("common.goBack")}
          </Button>
        </Show>
        <Show when={props.icon}>
          {(icon) => (
            <span
              class="grid size-8 shrink-0 place-items-center rounded-lg"
              style={
                props.accent
                  ? { color: props.accent, background: `color-mix(in srgb, ${props.accent} 16%, transparent)` }
                  : undefined
              }
            >
              <Icon name={icon()} size="normal" />
            </span>
          )}
        </Show>
        <span class="shrink-0 text-14-medium text-foreground">{props.title}</span>
        <Show when={props.actions}>
          <div class="flex shrink-0 items-center gap-1.5">{props.actions}</div>
        </Show>
        <Show when={props.filters}>
          <div class="flex min-w-0 flex-1 items-center justify-end gap-2">{props.filters}</div>
        </Show>
      </div>
      <Show when={props.hint}>
        {(hint) => <div class="mt-1.5 pl-1 text-12-regular text-foreground-subtle">{hint()}</div>}
      </Show>
    </div>
  )
}
