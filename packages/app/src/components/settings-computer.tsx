import type { Config } from "@novaway/sdk/v2/client"
import { Select } from "@novaway/ui/select"
import { Switch } from "@novaway/ui/switch"
import { createMemo, Show, type Component } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsGroup, SettingsRow } from "./settings-parts"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const PERMISSION_OPTIONS = ["ask", "allow", "deny"] as const

/**
 * 电脑控制（对齐 ZCode 的设置页）。
 *
 * 这一页只做两个开关：
 * - 启用电脑控制：是否把桌面自动化工具（截图 / 鼠标 / 键盘 / 窗口）交给 AI；
 * - 在输入框显示电脑操作按钮：控制输入区那个快捷入口的显隐。
 *
 * 真正的动作仍然逐次走权限确认（permission: computer），这里的开关只决定"能力是否存在"。
 */
export const SettingsComputer: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()

  const experimental = createMemo(() => {
    const value = globalSync.data.config.experimental
    return isRecord(value) ? value : {}
  })

  const enabled = createMemo(() => experimental()["computer_control"] === true)
  const showInComposer = createMemo(() => experimental()["computer_control_composer"] === true)

  /**
   * 电脑操作的权限档位，与 ZCode 一致的三档：
   * - ask：每个动作都弹确认（默认，最安全）
   * - allow：直接执行，不再逐次确认（适合信任的自动化脚本）
   * - deny：禁用所有电脑操作（保留开关但拒绝执行）
   *
   * 落点是 `permission.computer`，与工具里 `ctx.ask({ permission: "computer" })` 同名。
   */
  const permissionConfig = createMemo(() => {
    const value = globalSync.data.config.permission
    return isRecord(value) ? value : {}
  })
  const computerPermission = createMemo<"ask" | "allow" | "deny">(() => {
    const value = permissionConfig()["computer"]
    return value === "allow" || value === "deny" ? value : "ask"
  })

  const setComputerPermission = (value: "ask" | "allow" | "deny") =>
    globalSync.updateConfig({
      permission: { ...permissionConfig(), computer: value },
    } as Config)

  const update = (patch: Record<string, boolean>) =>
    globalSync.updateConfig({
      experimental: { ...experimental(), ...patch },
    } as Config)

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--popover)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 w-full">
          <h2 class="text-16-medium text-foreground">{language.t("settings.computer.title" as never)}</h2>
          <p class="text-13-regular text-foreground-subtle">{language.t("settings.computer.description" as never)}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <SettingsGroup>
          <SettingsRow
            label={language.t("settings.computer.enabled.title" as never)}
            description={language.t("settings.computer.enabled.description" as never)}
            control={
              <Switch checked={enabled()} onChange={(value) => update({ computer_control: value })} hideLabel>
                {language.t("settings.computer.enabled.title" as never)}
              </Switch>
            }
          />
          <SettingsRow
            label={language.t("settings.computer.composer.title" as never)}
            description={language.t("settings.computer.composer.description" as never)}
            control={
              <Switch
                checked={showInComposer()}
                disabled={!enabled()}
                onChange={(value) => update({ computer_control_composer: value })}
                hideLabel
              >
                {language.t("settings.computer.composer.title" as never)}
              </Switch>
            }
          />
          <SettingsRow
            label={language.t("settings.computer.permission.title" as never)}
            description={language.t(`settings.computer.permission.${computerPermission()}.description` as never)}
            control={
              <Select
                data-action="settings-computer-permission"
                options={PERMISSION_OPTIONS.map((value) => ({
                  value,
                  label: language.t(`settings.computer.permission.${value}.label` as never),
                }))}
                current={PERMISSION_OPTIONS.map((value) => ({
                  value,
                  label: language.t(`settings.computer.permission.${value}.label` as never),
                })).find((option) => option.value === computerPermission())}
                value={(option) => option.value}
                label={(option) => option.label}
                onSelect={(option) => option && setComputerPermission(option.value)}
                disabled={!enabled()}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            }
          />
          <Show when={!enabled()}>
            <div class="px-4 py-3 text-12-regular text-foreground-subtle">
              {language.t("settings.computer.disabledHint" as never)}
            </div>
          </Show>
        </SettingsGroup>
      </div>
    </div>
  )
}
