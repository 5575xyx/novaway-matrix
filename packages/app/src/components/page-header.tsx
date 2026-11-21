import { Show, type JSX } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon, type IconProps } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"

/**
 * 内容区域页面共用的顶行。
 *
 * 页面现在渲染在主页面 Header 下方，窗口控制按钮由主页面唯一的 Header 承载，
 * 因此这里不再为第二组窗控预留右侧空白。
 */
export const PAGE_HEADER_RIGHT_INSET = ""

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
  /** 右侧内容（筛选器之类）。 */
  filters?: JSX.Element
}) {
  const language = useLanguage()
  return (
    <div class="flex shrink-0 flex-col border-b border-border px-4 py-3" data-window-drag>
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
