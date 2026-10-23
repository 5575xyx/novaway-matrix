import { Show, createMemo } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { permissionForAgent } from "@/context/agent-permission"
import { usePrompt } from "@/context/prompt"
import { PromptInput } from "@/components/prompt-input"
import { createPromptVeil, PromptInputLoading } from "@/components/prompt-input/loading"
import { useOfficeAgent } from "@/pages/session/office-agent-context"
import { greetingMessageId } from "@/utils/greeting"

const ROOT_CLASS = "size-full flex flex-col"

interface NewSessionViewProps {
  worktree: string
  centered: boolean
  inputRef: (el: HTMLDivElement) => void
  autoSubmitKey?: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const language = useLanguage()
  const layout = useLayout()
  const local = useLocal()
  const permission = usePermission()
  const sdk = useSDK()
  const office = useOfficeAgent()

  const prompt = usePrompt()

  /**
   * 加载遮罩的显隐。
   *
   * 原来这里是「140ms 后把占位盒换成输入框」——那 140ms 是纯粹凭空加出来的延迟，
   * 而且遮罩盒与真实输入框的几何完全不同（见 PromptInputLoading 的注释），
   * 换过去就是一次跳动。现在改成：输入框**立刻挂载**、遮罩盖在上面，
   * 等到 `prompt.ready()` 后再淡出 —— 没有人为延迟，也没有布局跳动。
   */
  const veiling = createPromptVeil(() => prompt.ready()())

  const isForge = createMemo(() => layout.mode.current() === "forge")
  const isOffice = createMemo(() => layout.mode.current() === "zen")
  const currentAgent = createMemo(() => {
    const name = local.agent.current()?.name
    if (name === "plan" || name === "build") return name
    return "build"
  })

  return (
    <div class={ROOT_CLASS}>
      <div class="flex-1 flex flex-col items-center justify-center text-center">
        <div class="w-full max-w-xl flex flex-col items-center text-center gap-8 px-6">
          {/* 问候语：对齐 ZCode 草稿态空位（`ConversationDraftEmptyState`）——
              按时段换一句问候、居中、大字；不再用品牌 logo + 呼吸动画 + 渐变文字，
              那套 Aurora 装饰在 B8 已清掉（这条引用一度成了断链，本次一并修正）。 */}
          <div class="flex flex-col items-center gap-3">
            <p class="text-ui-xl font-semibold leading-tight text-foreground">
              {isOffice()
                ? office.activeAction().title
                : language.t(greetingMessageId() as Parameters<typeof language.t>[0])}
            </p>
            <Show when={isOffice()}>
              <p class="max-w-md text-ui-base leading-relaxed text-foreground-subtle">
                {office.activeAction().description}
              </p>
            </Show>
          </div>
          <Show when={sync.project}>
            {(project) => (
              <div class="flex items-start justify-center gap-3 min-h-5">
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
          <div class="w-full px-4 pointer-events-auto flex flex-col gap-3">
            <Show when={isForge()}>
              <div class="w-full flex gap-3">
                {(
                  [
                    { name: "plan" as const, color: "var(--icon-agent-plan-base)" },
                    { name: "build" as const, color: "var(--icon-agent-build-base)" },
                  ] as const
                ).map((agent) => {
                  const active = () => currentAgent() === agent.name
                  return (
                    <button
                      type="button"
                      class="flex-1 flex items-start gap-4 px-5 py-4 rounded-xl border text-left transition-all"
                      classList={{
                        "border-border bg-background/50 hover:border-border-hover hover:bg-hover": !active(),
                        "border-[var(--icon-agent-plan-base)]/40 bg-[var(--icon-agent-plan-base)]/10":
                          active() && agent.name === "plan",
                        "border-[var(--icon-agent-build-base)]/40 bg-[var(--icon-agent-build-base)]/10":
                          active() && agent.name === "build",
                      }}
                      onClick={() => {
                        // 角色决定执行能力，档位决定闸门：选哪个角色就带出对应档位，
                        // 避免出现"锻造工程 + 只读"这类互相打架的组合。
                        const next = permissionForAgent(agent.name, permission.mode(undefined, sdk.directory))
                        if (next) permission.setMode(undefined, sdk.directory, next)
                        local.agent.set(agent.name)
                      }}
                    >
                      <div class="mt-1 size-3 rounded-full shrink-0" style={{ "background-color": agent.color }} />
                      <div class="flex flex-col gap-1 min-w-0 text-left">
                        <div class="text-14-semibold text-foreground">
                          {language.t(`session.new.agentSelector.${agent.name}.title`)}
                        </div>
                        <div class="text-12-regular text-foreground-subtle leading-5">
                          {language.t(`session.new.agentSelector.${agent.name}.description`)}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </Show>
            <div class="relative w-full">
              <PromptInput
                ref={props.inputRef}
                newSessionWorktree={props.worktree}
                autoSubmitKey={props.autoSubmitKey}
                onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                onSubmit={props.onSubmit}
              />
              <Show when={veiling()}>
                <PromptInputLoading fading={prompt.ready()()} />
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
