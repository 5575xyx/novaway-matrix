import { createMemo, For, Show } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Message } from "@novaway/ui/message-part"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { SideChatComposer } from "@/pages/session/side-chat-composer"
import { useSync } from "@/context/sync"
import { useLayout, type SidePaneSessionTab } from "@/context/layout"
import { base64Encode } from "@novaway/core/util/encode"

/** 面板里最多渲染多少条消息（更早的请点"打开完整会话"）。 */
const MAX_ROWS = 40

/**
 * Side Pane 里的**会话面板**：子代理钻取与侧边对话共用。
 *
 * 对齐 ZCode 的 `SubagentDrilldown` / `SelectionSideChatPane`：
 * 两者都是"在右侧面板里看另一个会话"，而不是整页跳走 —— 整页跳会把主线从眼前挪走。
 *
 * 与 ZCode 的差别（刻意简化，避免把主时间线那套虚拟滚动/历史窗口搬进 360px 的面板）：
 * - **不虚拟化**，只渲染最近 `MAX_ROWS` 条；
 * - **只读**：不提供 fork / retry / 编辑。要这些能力点顶部的"在主线打开"回到完整会话。
 *
 * 两种标签的区别只在于**关闭时是否删除服务端会话**（调用方负责，见 `closeSessionTab`）：
 * 子代理的会话属于父会话的一部分，关了面板不该消失；侧边对话是关掉即删。
 */
export function SidePaneSessionPanel(props: { tab: SidePaneSessionTab }) {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const layout = useLayout()

  const directory = createMemo(() => sdk.directory)
  // `sync.data` 就是当前 directory 的会话 store（message / part 都挂在上面）。
  const store = createMemo(() => sync.data)

  // `message[sessionID]` 直接就是按 id 排好序的 Message 数组（见 event-reducer 的单测）。
  const messages = createMemo(() => store().message[props.tab.sessionID] ?? [])

  /** 取最近 N 条：面板只有 360px 宽，渲染整条会话既慢也没意义。 */
  const rows = createMemo(() => messages().slice(-MAX_ROWS))
  const hidden = createMemo(() => Math.max(0, messages().length - rows().length))
  const emptyIcon = () => (props.tab.kind === "subagent" ? "task" : "speech-bubble")

  const openFull = () => {
    // 完整会话走路由（与子代理原来的行为一致），把当前会话切过去。
    window.location.hash = ""
    history.pushState(null, "", `/${base64Encode(directory())}/session/${props.tab.sessionID}`)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }

  return (
    <div data-component="side-pane-session" class="flex h-full min-h-0 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <Icon
          name={props.tab.kind === "subagent" ? "task" : "speech-bubble"}
          size="small"
          class="shrink-0 text-foreground-subtle"
        />
        <span class="min-w-0 flex-1 truncate text-ui-caption text-foreground" title={props.tab.title}>
          {props.tab.title}
        </span>
        <Button
          variant="ghost"
          size="small"
          class="shrink-0"
          icon="square-arrow-top-right"
          onClick={openFull}
          aria-label={language.t("sidePane.session.openFull")}
        >
          {language.t("sidePane.session.openFull")}
        </Button>
      </div>

      <Show when={hidden() > 0}>
        <div class="shrink-0 px-3 py-1.5 text-ui-xs text-foreground-subtlest">
          {language.t("sidePane.session.recent", { count: rows().length, total: messages().length })}
        </div>
      </Show>

      <div class="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        <Show
          when={rows().length > 0}
          fallback={
            // 空会话 ≠ 加载中：新建的侧边对话本来就没有消息。
            // 之前这里用「0 条消息」当加载态，新会话会永远转圈。
            <div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Icon name={emptyIcon()} size="small" class="text-foreground-subtlest" />
              <p class="text-ui-caption leading-5 text-foreground-subtle">
                {language.t(props.tab.kind === "subagent" ? "sidePane.session.emptySubagent" : "sidePane.session.empty")}
              </p>
            </div>
          }
        >
          <div class="flex flex-col gap-3">
            <For each={rows()}>
              {(row) => (
                <Message message={row} parts={store().part[row.id] ?? []} showReasoningSummaries={false} />
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* 侧边对话带自己的输入框：它的全部意义就是"不用切回主线就能问一句"。 */}
      <Show when={props.tab.kind === "sideChat"}>
        <SideChatComposer tab={props.tab} />
      </Show>
    </div>
  )
}

/** 关闭会话标签：只移除标签；是否删除服务端会话由调用方决定（见组件说明）。 */
export function closeSessionTab(tab: SidePaneSessionTab) {
  useLayout().sidePane.closeSession(tab.id)
}
