import { Show, createMemo } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useLayout, appModeIsGroup } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { PromptInput } from "@/components/prompt-input"
import { createPromptVeil, PromptInputLoading } from "@/components/prompt-input/loading"
import { DraftEmptyState } from "@/components/session/draft-empty-state"
import { OfficeSuggestedPrompts } from "@/components/office-suggested-prompts"
import { useOfficeAgent } from "@/pages/session/office-agent-context"
import { useSettings } from "@/context/settings"

const ROOT_CLASS = "size-full flex flex-col"

interface NewSessionViewProps {
  worktree: string
  centered: boolean
  inputRef: (el: HTMLDivElement) => void
  autoSubmitKey?: string
  onNewSessionWorktreeReset: () => void
  onNewSessionWorktreeSelect?: (directory: string) => void
  onSubmit: () => void
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const language = useLanguage()
  const layout = useLayout()
  const prompt = usePrompt()
  const office = useOfficeAgent()
  const settings = useSettings()

  /**
   * 加载遮罩的显隐。
   *
   * 原来这里是「140ms 后把占位盒换成输入框」——那 140ms 是纯粹凭空加出来的延迟，
   * 而且遮罩盒与真实输入框的几何完全不同（见 PromptInputLoading 的注释），
   * 换过去就是一次跳动。现在改成：输入框**立刻挂载**、遮罩盖在上面，
   * 等到 `prompt.ready()` 后再淡出 —— 没有人为延迟，也没有布局跳动。
   */
  const veiling = createPromptVeil(() => prompt.ready()())

  const isOffice = createMemo(() => appModeIsGroup(layout.mode.current(), "office", layout.mode.all()))

  return (
    <div class={ROOT_CLASS}>
      <div class="flex-1 flex flex-col items-center justify-center text-center">
        <div
          data-component="session-new-hero"
          class="relative w-full max-w-2xl flex flex-col items-center text-center gap-8 px-6"
        >
          {/* 氛围层：一层会呼吸的极光辉光 + 被径向遮罩烧成圆的网格，纯装饰，
              不参与布局、不吃点击（见 index.css 的 session-new-aurora）。 */}
          <div data-component="session-new-aurora" aria-hidden="true" />
          {/* 问候语：草稿态空位（DraftEmptyState）——
              按时段换一句问候、居中、大字，办公模式换成「今天有什么工作，交给我吧」。
              组件里自带那枚巨大的品牌水印，只是氛围，不参与布局。 */}
          <DraftEmptyState class="z-10" />
          <Show when={sync.project}>
            {(project) => (
              <div class="relative z-10 flex items-start justify-center gap-3 min-h-5">
                <div class="text-ui-sm text-foreground-subtle leading-5 min-w-0 max-w-120 break-words text-center">
                  {language.t("session.new.lastModified")}&nbsp;
                  <span class="text-foreground-subtle">
                    {DateTime.fromMillis(project().time.updated ?? project().time.created)
                      .setLocale(language.intl())
                      .toRelative()}
                  </span>
                </div>
              </div>
            )}
          </Show>

          {/* Prompt input for new session */}
          <div class="relative z-10 w-full px-4 pointer-events-auto flex flex-col gap-3">
            <div class="relative w-full">
              <PromptInput
                ref={props.inputRef}
                newSessionWorktree={props.worktree}
                autoSubmitKey={props.autoSubmitKey}
                onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                onNewSessionWorktreeSelect={props.onNewSessionWorktreeSelect}
                onSubmit={props.onSubmit}
              />
              <Show when={veiling()}>
                <PromptInputLoading fading={prompt.ready()()} />
              </Show>
            </div>
            {/* 办公模式的推荐提示词：放在**输入框正下方**（草稿态才出现）。
                点一条等于「选好插件 + 写好开场白」；插件没启用时先问一句再启用。
                这里写入的是真正的输入框（PromptInput 的 reconcile 会把 store 同步回 DOM），
                不是另起一个假 textarea。 */}
            <Show when={isOffice() && settings.office.showSuggestions()}>
              <OfficeSuggestedPrompts
                class="mt-1 px-1"
                onSelect={(item) => {
                  // 场景跟着提示词走，否则办公上下文还是上一次选的场景。
                  if (item.scene && item.scene !== office.activeID()) office.select(item.scene)
                  prompt.set(
                    [{ type: "text", content: item.prompt, start: 0, end: item.prompt.length }],
                    item.prompt.length,
                  )
                }}
              />
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
