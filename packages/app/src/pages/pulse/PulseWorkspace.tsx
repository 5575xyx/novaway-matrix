import { onMount } from "solid-js"
import { IconButton } from "@novaway/ui/icon-button"
import { useLanguage } from "@/context/language"
import { PlatformAccountsProvider, usePlatformAccounts } from "@/context/platform-accounts"
import { PulseMain } from "./PulseMain"
import { PulseSidebar } from "./PulseSidebar"

function PulseWorkspaceInner(props: { onBack: () => void }) {
  const language = useLanguage()
  const platform = usePlatformAccounts()

  onMount(() => {
    platform.refreshAccounts()
    platform.refreshGroups()
  })

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div class="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <IconButton
          icon="arrow-left"
          variant="ghost"
          size="small"
          aria-label={language.t("common.back")}
          onClick={props.onBack}
        />
        <span class="text-14-medium text-foreground">{language.t("pulse.workspace.title")}</span>
        <span class="min-w-0 flex-1 truncate text-12-regular text-foreground-subtle">
          {language.t("pulse.workspace.subtitle")}
        </span>
      </div>
      {/* 账号列表 + 账号详情/发布。**聊天不在这里**：所有模式共用同一套会话界面，
          运营助手就是普通的会话（区别只在 agent / 技能 / MCP）。 */}
      <div class="flex min-h-0 flex-1">
        <div class="w-60 shrink-0 overflow-y-auto border-r border-border bg-background-alt/40">
          <PulseSidebar />
        </div>
        <div class="min-w-0 flex-1 overflow-auto">
          <PulseMain />
        </div>
      </div>
    </div>
  )
}

/**
 * 运营工作台（原 `/pulse` 整窗页面）。
 *
 * 以前运营模式是一个**独立的窗口级布局**：自带顶栏、账号栏和一套手写的聊天气泡，
 * 切过去时左侧图标条（数据库/知识库/扩展/设置）整块消失。现在它变成主帧内的
 * 普通页面（和设置/数据库/自动化一致），图标条与会话侧栏始终保留；
 * 需要聊天时用的就是标准会话界面。
 */
export default function PulseWorkspace(props: { onBack: () => void }) {
  return (
    <PlatformAccountsProvider>
      <PulseWorkspaceInner onBack={props.onBack} />
    </PlatformAccountsProvider>
  )
}
