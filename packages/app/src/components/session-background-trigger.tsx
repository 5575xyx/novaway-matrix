import { For, createMemo, type JSX } from "solid-js"
import { Tooltip } from "@novaway/ui/tooltip"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"

import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { JOB_ICONS, runningKindCounts } from "@/pages/session/status-panel/background-section-model"

/** 每个 kind 的 tooltip 文案；任务种类标签与状态卡片共用一套叫法。 */
const KIND_TOOLTIP_KEY = {
  shell: "prompt.action.background.shell",
  agent: "prompt.action.background.agent",
  monitor: "prompt.action.background.monitor",
  subscribe: "prompt.action.background.subscribe",
  orchestrator: "prompt.action.background.orchestrator",
  other: "prompt.action.background.other",
} as const

/**
 * composer 左下角的「后台任务运行中」入口，对齐 ZCode 的
 * ConversationBackgroundWorkTrigger：只在有运行中任务时出现，每个类型一个
 * 「图标 + 数量」按钮（终端=命令、分屏=子代理）；点击展开右上角状态卡片并
 * 定位到后台任务分区。
 */
export function SessionBackgroundTrigger(props: { style?: JSX.CSSProperties }) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const layout = useLayout()
  const { params } = useSessionLayout()

  const groups = createMemo(() => (params.id ? runningKindCounts(sync.data.backgroundJob[params.id] ?? []) : []))

  const open = () => {
    layout.statusPanel.setCollapsed(sdk.directory, false)
    layout.statusPanel.setOpen(sdk.directory, "background", true)
  }

  return (
    <For each={groups()}>
      {(group) => (
        <Tooltip placement="top" value={language.t(KIND_TOOLTIP_KEY[group.kind], { count: group.count })}>
          <Button
            type="button"
            data-action="prompt-background"
            variant="ghost"
            class="size-8 gap-1 p-0"
            style={props.style}
            onClick={open}
            aria-label={language.t(KIND_TOOLTIP_KEY[group.kind], { count: group.count })}
          >
            <Icon name={JOB_ICONS[group.kind]} class="size-4.5 text-icon-blue" />
            <span class="text-xs tabular-nums">{group.count}</span>
          </Button>
        </Tooltip>
      )}
    </For>
  )
}
