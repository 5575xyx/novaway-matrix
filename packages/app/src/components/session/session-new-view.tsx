import { Show, createMemo, createSignal, onCleanup } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { PromptInput } from "@/components/prompt-input"
import { useOfficeAgent } from "@/pages/session/office-agent-context"
import { Mark } from "@novaway/ui/logo"

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
  const office = useOfficeAgent()

  const [ready, setReady] = createSignal(false)
  let timer: number | undefined

  const clear = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
  }

  const delay = 140
  clear()
  setReady(false)
  timer = window.setTimeout(() => {
    setReady(true)
    timer = undefined
  }, delay)

  onCleanup(clear)

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
          <div class="flex flex-col items-center gap-5">
            <div class="relative">
              <Mark class="w-10 animate-[logo-breathe_4s_ease-in-out_infinite]" />
              <div class="absolute inset-0 blur-xl bg-gradient-to-br from-[rgba(100,160,230,0.2)] to-[rgba(140,200,210,0.2)] rounded-full -z-10" />
            </div>
            <div class="text-20-medium gradient-text-aurora">
              {isOffice() ? office.activeAction().title : language.t("session.new.title")}
            </div>
            <Show when={isOffice()}>
              <div class="max-w-md text-13-regular leading-relaxed text-text-weak">
                {office.activeAction().description}
              </div>
            </Show>
          </div>
          <div class="w-full flex flex-col gap-3 items-center">
            <Show when={sync.project}>
              {(project) => (
                <div class="flex items-start justify-center gap-3 min-h-5">
                  <div class="text-11-medium text-text-weak leading-5 min-w-0 max-w-120 break-words text-center">
                    {language.t("session.new.lastModified")}&nbsp;
                    <span class="text-text-strong">
                      {DateTime.fromMillis(project().time.updated ?? project().time.created)
                        .setLocale(language.intl())
                        .toRelative()}
                    </span>
                  </div>
                </div>
              )}
            </Show>
          </div>

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
                        "border-border-weak-base bg-background-base/50 hover:border-border-strong-base hover:bg-surface-hover":
                          !active(),
                        "border-[var(--icon-agent-plan-base)]/40 bg-[var(--icon-agent-plan-base)]/10":
                          active() && agent.name === "plan",
                        "border-[var(--icon-agent-build-base)]/40 bg-[var(--icon-agent-build-base)]/10":
                          active() && agent.name === "build",
                      }}
                      onClick={() => local.agent.set(agent.name)}
                    >
                      <div class="mt-1 size-3 rounded-full shrink-0" style={{ "background-color": agent.color }} />
                      <div class="flex flex-col gap-1 min-w-0 text-left">
                        <div class="text-14-semibold text-text-strong">
                          {language.t(`session.new.agentSelector.${agent.name}.title`)}
                        </div>
                        <div class="text-12-regular text-text-weak leading-5">
                          {language.t(`session.new.agentSelector.${agent.name}.description`)}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </Show>
            <Show when={ready()}>
              <PromptInput
                ref={props.inputRef}
                newSessionWorktree={props.worktree}
                autoSubmitKey={props.autoSubmitKey}
                onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                onSubmit={props.onSubmit}
              />
            </Show>
            <Show when={!ready()}>
              <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                {language.t("prompt.loading")}
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
