import type { Config } from "@novaway/sdk/v2/client"
import { Select } from "@novaway/ui/select"
import { Switch } from "@novaway/ui/switch"
import { showToast } from "@novaway/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { createMemo, type Component, type JSX } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsGroup, SettingsNumberField, SettingsPage, SettingsRow } from "./settings-parts"

const Section: Component<{ title: string; description?: string; children: JSX.Element }> = (props) => (
  <div class="flex flex-col gap-2">
    <h3 class="text-14-medium text-foreground">{props.title}</h3>
    {props.description ? <p class="text-12-regular text-foreground-subtle">{props.description}</p> : null}
    {props.children}
  </div>
)

const verifierOptions = [
  { value: "judge" as const, label: "裁判模型" },
  { value: "agent" as const, label: "只读验证 Agent" },
]

const sandboxBackends: Array<{ value: NonNullable<Config["sandbox"]>["backend"] & string; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "bwrap", label: "Bubblewrap" },
  { value: "landlock", label: "Landlock" },
  { value: "seatbelt", label: "Seatbelt" },
  { value: "docker", label: "Docker" },
  { value: "podman", label: "Podman" },
]

/**
 * 自主执行与安全：目标自主执行、自动权限判定、命令隔离。
 *
 * 三者是同一类设置——它们都决定「模型可以在无人盯着时做多少事」，
 * 所以放在同一页；与记忆、技能等具体能力分开。
 */
export const SettingsAutomation: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()

  const goal = createMemo(() => globalSync.data.config.goal ?? {})
  const maxActiveMinutes = createMemo(() => {
    const value = goal().max_active_ms
    return value === undefined ? 0 : Math.ceil(value / 60_000)
  })
  const permissionAuto = createMemo(() => globalSync.data.config.permission_auto ?? {})
  const sandbox = createMemo(() => globalSync.data.config.sandbox ?? {})
  const windowsSandboxUnsupported = typeof window !== "undefined" && navigator.platform.toLowerCase().includes("win")

  const save = useMutation(() => ({
    mutationFn: (config: Config) => globalSync.updateConfig(config),
    onError: (err) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))

  const updateGoal = (patch: Partial<Config["goal"]>) => save.mutate({ goal: { ...goal(), ...patch } } as Config)
  const updatePermissionAuto = (patch: Partial<NonNullable<Config["permission_auto"]>>) =>
    save.mutate({ permission_auto: { ...permissionAuto(), ...patch } } as Config)
  const updateSandbox = (patch: Partial<Config["sandbox"]>) =>
    save.mutate({ sandbox: { ...sandbox(), ...patch } } as Config)

  return (
    <SettingsPage
      title={language.t("settings.automation.title" as never)}
      description={language.t("settings.automation.description" as never)}
    >
      <Section
        title="目标自主执行"
        description="目标未达成时继续规划、执行并验证。预算默认不限制，可按轮数、Token 与时长收紧。"
      >
        <SettingsGroup>
          <SettingsRow
            label="Goal 自主执行"
            description="允许目标在单轮对话后继续追加执行，直到完成、达到预算或暂停。"
            control={
              <Switch
                checked={goal().enabled === true}
                disabled={save.isPending}
                onChange={(value) => updateGoal({ enabled: value })}
                hideLabel
              >
                Goal 自主执行
              </Switch>
            }
            detail={
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SettingsRow
                  label="最大追加轮数（0 关闭）"
                  control={
                    <SettingsNumberField
                      value={goal().max_iterations}
                      fallback={20}
                      min={0}
                      disabled={save.isPending || goal().enabled !== true}
                      onSave={(value) => updateGoal({ max_iterations: value })}
                    />
                  }
                />
                <SettingsRow
                  label="累计 Token 上限（0 不限）"
                  control={
                    <SettingsNumberField
                      value={goal().max_tokens}
                      fallback={0}
                      min={0}
                      disabled={save.isPending || goal().enabled !== true}
                      onSave={(value) => updateGoal({ max_tokens: value || undefined })}
                    />
                  }
                />
                <SettingsRow
                  label="执行时长上限（分钟，0 不限）"
                  control={
                    <SettingsNumberField
                      value={maxActiveMinutes()}
                      fallback={0}
                      min={0}
                      disabled={save.isPending || goal().enabled !== true}
                      onSave={(value) => updateGoal({ max_active_ms: value ? value * 60_000 : undefined })}
                    />
                  }
                />
                <SettingsRow
                  label="完成判定方式"
                  control={
                    <Select
                      options={verifierOptions}
                      current={verifierOptions.find((option) => option.value === (goal().verifier ?? "judge"))}
                      value={(option) => option.value}
                      label={(option) => option.label}
                      onSelect={(option) => option && updateGoal({ verifier: option.value })}
                      disabled={save.isPending || goal().enabled !== true}
                      variant="secondary"
                      size="small"
                      triggerVariant="settings"
                    />
                  }
                />
              </div>
            }
          />
        </SettingsGroup>
      </Section>

      <Section
        title="自动权限判定"
        description="权限档位为「自主审批」时，需要询问的操作先由分类器判断是否放行；关闭后仍会询问你。"
      >
        <SettingsGroup>
          <SettingsRow
            label="自主审批安全分类器"
            description="仅在权限档位为「自主审批」时生效，不是独立档位。档位在输入框旁或「通用 → 权限」中切换。"
            control={
              <Switch
                checked={permissionAuto().classifier === true}
                disabled={save.isPending}
                onChange={(value) => updatePermissionAuto({ classifier: value })}
                hideLabel
              >
                自主审批安全分类器
              </Switch>
            }
            detail={
              <SettingsRow
                label="连续拒绝后转交用户（次数）"
                control={
                  <SettingsNumberField
                    value={permissionAuto().denial_limit}
                    fallback={3}
                    min={1}
                    disabled={save.isPending || permissionAuto().classifier !== true}
                    onSave={(value) => updatePermissionAuto({ denial_limit: Math.max(1, value) })}
                  />
                }
              />
            }
          />
        </SettingsGroup>
      </Section>

      <Section title="命令隔离" description="Shell 与验证命令通过所选后端隔离运行；后端不可用时不会静默降级。">
        <SettingsGroup>
          <SettingsRow
            label="命令 OS 沙盒"
            description={
              windowsSandboxUnsupported
                ? "Windows 暂无可用的 OS 级隔离后端；开启沙盒时命令会拒绝执行，不会裸跑。"
                : "启用后 Shell 和验证命令通过所选后端隔离运行；后端不可用时不会静默降级执行。"
            }
            control={
              <Switch
                checked={sandbox().enabled === true}
                disabled={save.isPending}
                onChange={(value) => updateSandbox({ enabled: value })}
                hideLabel
              >
                命令 OS 沙盒
              </Switch>
            }
            detail={
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SettingsRow
                  label="隔离后端"
                  description={windowsSandboxUnsupported ? "此平台暂无已验证后端。" : undefined}
                  control={
                    <Select
                      options={sandboxBackends}
                      current={sandboxBackends.find((option) => option.value === (sandbox().backend ?? "auto"))}
                      value={(option) => option.value}
                      label={(option) => option.label}
                      onSelect={(option) => option && updateSandbox({ backend: option.value })}
                      disabled={save.isPending || sandbox().enabled !== true || windowsSandboxUnsupported}
                      variant="secondary"
                      size="small"
                      triggerVariant="settings"
                    />
                  }
                />
                <SettingsRow
                  label="允许网络"
                  control={
                    <Switch
                      checked={sandbox().network === true}
                      disabled={save.isPending || sandbox().enabled !== true}
                      onChange={(value) => updateSandbox({ network: value })}
                      hideLabel
                    >
                      允许网络
                    </Switch>
                  }
                />
              </div>
            }
          />
        </SettingsGroup>
      </Section>
    </SettingsPage>
  )
}
