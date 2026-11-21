import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { Show, createSignal, type Component, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { PERMISSION_MODES, type PermissionTone, type SessionPermissionMode } from "@/context/permission-risk"
import { ConfirmDialog } from "./dialog-confirm"

/**
 * 档位配色通过主题语义色区分风险等级，不绑定具体色相；越靠后代表权限越宽。
 */
const TONE_ICON: Record<PermissionTone, string> = {
  neutral: "text-icon-base",
  interactive: "text-icon-interactive-base",
  info: "text-icon-info-base",
  warning: "text-icon-warning-base",
  critical: "text-icon-critical-base",
}

const TONE_TEXT: Record<PermissionTone, string> = {
  neutral: "text-foreground",
  interactive: "text-interactive-base",
  info: "text-info-base",
  warning: "text-warning-base",
  critical: "text-critical-base",
}

/**
 * 菜单里哪些档位之间要画分割线（下标指 `PERMISSION_MODES` 的位置）。
 *
 * 分组含义：
 * - 计划模式是一个独立语义（只读），和下面的"松紧程度"不是一回事，单独一组；
 * - 无人值守是唯一的"完全不问人"档位，压在最底下单独一组，避免和
 *   「跳过所有确认」混为一谈 —— 后者只是不问权限，仍会等人回答提问。
 */
const SEPARATOR_AFTER = new Set([0, PERMISSION_MODES.length - 2])

const DANGEROUS_MODES = new Set<SessionPermissionMode>(["bypassPermissions", "unattended"])

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
  const [pendingMode, setPendingMode] = createSignal<SessionPermissionMode>()

  const apply = (value: SessionPermissionMode) => {
    setPendingMode(undefined)
    permission.setMode(sessionID(), sdk.directory, value)
    props.onChange?.(value)
  }

  const confirmationDescription = (value: SessionPermissionMode): JSX.Element => {
    const unattended = value === "unattended"
    return (
      <div class="flex flex-col gap-3">
        <p class="leading-5 text-foreground-subtle">
          {unattended
            ? "无人值守会让模型在没有人工介入的情况下持续推进任务。只有在你明确理解并接受以下风险后才建议启用。"
            : "跳过所有确认会让权限请求直接放行。自主审批仍会拦截的危险操作，在此档位也不会再弹出确认。"}
        </p>
        <div class="rounded-lg border border-critical-base/30 bg-surface-critical-weak px-3 py-2.5">
          <div class="mb-1 text-12-medium text-text-critical-base">可能触及的危险操作</div>
          <ul class="list-disc space-y-1 pl-4 text-12-regular leading-5 text-foreground-subtle">
            <li>执行删除、覆盖、重置、终止进程等不可逆的本地命令。</li>
            <li>修改或删除工作区文件，安装依赖，执行 Git 提交、推送或发布。</li>
            <li>访问工作区之外的目录、网络资源或外部服务。</li>
            <li>
              {unattended
                ? "遇到需要澄清或拍板的问题时，由模型自行决定，不再等待你回答。"
                : "遇到需要用户回答的问题时仍可能暂停等待输入。"}
            </li>
          </ul>
        </div>
        <p class="text-12-regular text-foreground-subtlest">
          {unattended
            ? "建议仅对可回滚、边界明确的长任务使用，并同时设置目标、验收标准和预算。"
            : "如只是希望常规编辑自动执行，建议继续使用“自主审批”，它仍会拦截高风险操作。"}
        </p>
      </div>
    )
  }

  const choose = (value: SessionPermissionMode) => {
    if (value === current()) return
    if (DANGEROUS_MODES.has(value)) {
      setPendingMode(value)
      return
    }
    apply(value)
  }

  return (
    <div data-component="permission-mode-select" class="flex items-center gap-1.5">
      <ConfirmDialog
        open={pendingMode() !== undefined}
        title={language.t("permission.mode.confirmDangerTitle")}
        description={pendingMode() ? confirmationDescription(pendingMode()!) : ""}
        confirmText={language.t(
          pendingMode() === "unattended" ? "permission.mode.confirmUnattended" : "permission.mode.confirmDanger",
        )}
        variant="danger"
        onConfirm={() => {
          const value = pendingMode()
          if (value) apply(value)
        }}
        onClose={() => setPendingMode(undefined)}
      />
      <DropdownMenu gutter={4} placement="top-end">
        <DropdownMenu.Trigger
          as="button"
          type="button"
          data-action="prompt-permission-mode"
          class="flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-12-medium transition-colors hover:bg-hover"
          aria-label={language.t("permission.mode.label")}
        >
          <Icon name={mode().icon} size="small" class={`shrink-0 ${TONE_ICON[mode().tone]}`} />
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
            {PERMISSION_MODES.map((item, index) => (
              <>
                <DropdownMenu.Item onSelect={() => choose(item.value)}>
                  <div class="flex w-full items-start gap-2.5">
                    <Icon name={item.icon} size="small" class={`mt-0.5 shrink-0 ${TONE_ICON[item.tone]}`} />
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
                      <Icon name="check" size="small" class={`mt-0.5 shrink-0 ${TONE_ICON[mode().tone]}`} />
                    </Show>
                  </div>
                </DropdownMenu.Item>
                <Show when={SEPARATOR_AFTER.has(index)}>
                  <DropdownMenu.Separator />
                </Show>
              </>
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
