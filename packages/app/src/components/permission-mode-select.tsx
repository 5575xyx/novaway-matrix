import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { PERMISSION_MODES, type PermissionTone, type SessionPermissionMode } from "@/context/permission-risk"

/**
 * 档位配色：不同权限用不同颜色，扫一眼就知道现在放得有多宽。
 * 灰 → 蓝 → 紫 → 橙，越靠后越"放行"；橙色和 ZCode 的「完全访问」一致。
 */
const TONE_TEXT: Record<PermissionTone, string> = {
  neutral: "text-foreground",
  blue: "text-icon-blue",
  violet: "text-violet-600 dark:text-violet-300",
  amber: "text-amber-600 dark:text-amber-300",
}

/**
 * 会话权限档位选择器 —— 全应用**唯一**的权限开关。
 *
 * 档位直接读写会话的 `permissionMode`（内核字段），因此：
 * - 子代理会继承它，且后端真正按它执行（不是只改了界面）；
 * - 会话没有显式设置时显示全局默认（设置 → 每次确认/自主模式/计划/跳过确认），
 *   并标注「跟随默认」，避免"界面显示默认、实际却全放行"的错位；
 * - 头部原来那个同名下推菜单已移除，同一个概念不再有两个入口、两套叫法。
 */
export const PermissionModeSelect: Component<{
  sessionID?: string
  /** 档位改变后回调，调用方据此让角色与档位保持一致。 */
  onChange?: (mode: SessionPermissionMode) => void
}> = (props) => {
  const language = useLanguage()
  const permission = usePermission()
  const sdk = useSDK()

  const sessionID = () => props.sessionID ?? ""
  const current = () => permission.mode(sessionID(), sdk.directory)
  const inherited = () => permission.isInherited(sessionID(), sdk.directory)
  const defaultMode = () => permission.defaultMode(sdk.directory)
  const mode = () => PERMISSION_MODES.find((item) => item.value === current()) ?? PERMISSION_MODES[0]

  const choose = (value: SessionPermissionMode) => {
    // 新建会话界面还没有 session：档位先记在"待定"槽位，创建会话时写进去；
    // 不会改动设置里的全局默认值。
    permission.setMode(sessionID(), sdk.directory, value)
    props.onChange?.(value)
  }

  return (
    <div data-component="permission-mode-select" class="flex items-center gap-1.5">
      <DropdownMenu gutter={4} placement="top-end">
        <DropdownMenu.Trigger
          as="button"
          type="button"
          data-action="prompt-permission-mode"
          class="flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-12-medium transition-colors hover:bg-hover"
          aria-label={language.t("permission.mode.label")}
        >
          <Icon name={mode().icon} size="small" class={`shrink-0 ${TONE_TEXT[mode().tone]}`} />
          <span
            data-slot="permission-mode-label"
            class={`shrink-0 ${TONE_TEXT[mode().tone]}`}
            style={{ "font-weight": "var(--font-weight-semibold)" }}
          >
            {language.t(mode().titleKey as never)}
          </span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-foreground-subtle" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content style={{ "min-width": "264px" }}>
            {PERMISSION_MODES.map((item) => (
              <DropdownMenu.Item onSelect={() => choose(item.value)}>
                <div class="flex w-full items-start gap-2.5">
                  <Icon name={item.icon} size="small" class={`mt-0.5 shrink-0 ${TONE_TEXT[item.tone]}`} />
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="flex items-center gap-1.5 text-13-medium text-foreground">
                      {language.t(item.titleKey as never)}
                      <Show when={item.value === defaultMode()}>
                        <span class="rounded bg-surface px-1 py-px text-10-medium text-foreground-subtlest">
                          {language.t("permission.mode.defaultTag")}
                        </span>
                      </Show>
                    </span>
                    <span class="text-11-regular leading-4 text-foreground-subtle">
                      {language.t(item.descriptionKey as never)}
                    </span>
                  </div>
                  <Show when={item.value === current()}>
                    <Icon name="check" size="small" class={`mt-0.5 shrink-0 ${TONE_TEXT[mode().tone]}`} />
                  </Show>
                </div>
              </DropdownMenu.Item>
            ))}
            <Show
              when={sessionID()}
              fallback={
                <div class="px-2 pt-1.5 pb-1 text-11-regular leading-4 text-foreground-subtlest">
                  {language.t("permission.mode.pending")}
                </div>
              }
            >
              <Show when={inherited()}>
                <div class="px-2 pt-1.5 pb-1 text-11-regular leading-4 text-foreground-subtlest">
                  {language.t("permission.mode.inherited", { mode: language.t(mode().titleKey as never) })}
                </div>
              </Show>
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}
