import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { PERMISSION_MODES } from "@/context/permission-risk"

/**
 * 权限档位选择器（对齐 ZCode 输入框里的 变更前确认 / 自主模式 / 完全访问）。
 *
 * 开关式的「当前项目权限」只能表达"全问 / 全不问"两态，中间那档
 * 「常规放行、危险操作仍确认」根本没有位置。这里换成三档下拉：
 * - 档位存在 permission store（按目录），切换立即生效，包括已排队的请求；
 * - 设置里的「全局自动批准」仍是最高优先级，开着时显示胶囊并提示先关掉它，
 *   否则会出现"明明选了变更前确认却什么都不问"。
 */
export const PermissionModeSelect: Component = () => {
  const language = useLanguage()
  const permission = usePermission()
  const settings = useSettings()
  const sdk = useSDK()

  const current = () => permission.mode(sdk.directory)
  const globalAutoApprove = () => settings.permissions.autoApprove()
  const mode = () => PERMISSION_MODES.find((item) => item.value === current()) ?? PERMISSION_MODES[0]

  const choose = (value: (typeof PERMISSION_MODES)[number]["value"]) => {
    // 全局自动批准会盖过档位选择：先关掉它，用户的选择才真正生效。
    if (globalAutoApprove()) settings.permissions.setAutoApprove(false)
    permission.setMode(sdk.directory, value)
  }

  return (
    <div data-component="permission-mode-select" class="flex items-center gap-1.5">
      <DropdownMenu gutter={4} placement="top-end">
        <DropdownMenu.Trigger
          as="button"
          type="button"
          data-action="prompt-permission-mode"
          class="flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-12-medium text-foreground transition-colors hover:bg-hover"
          aria-label={language.t("permission.mode.label")}
        >
          <Icon name={mode().icon} size="small" class="shrink-0 text-icon-blue" />
          <span class="shrink-0" style={{ "font-weight": "var(--font-weight-semibold)" }}>
            {language.t(mode().titleKey as never)}
          </span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-foreground-subtle" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content style={{ "min-width": "248px" }}>
            {PERMISSION_MODES.map((item) => (
              <DropdownMenu.Item onSelect={() => choose(item.value)}>
                <div class="flex w-full items-start gap-2.5">
                  <Icon name={item.icon} size="small" class="mt-0.5 shrink-0 text-foreground-subtle" />
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="text-13-medium text-foreground">{language.t(item.titleKey as never)}</span>
                    <span class="text-11-regular leading-4 text-foreground-subtle">
                      {language.t(item.descriptionKey as never)}
                    </span>
                  </div>
                  <Show when={item.value === current()}>
                    <Icon name="check" size="small" class="mt-0.5 shrink-0 text-icon-blue" />
                  </Show>
                </div>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      <Show when={globalAutoApprove()}>
        <span class="rounded-md bg-hover px-1.5 py-0.5 text-11-medium text-foreground-subtle">
          {language.t("permissions.prompt.globalEnabled")}
        </span>
      </Show>
    </div>
  )
}
