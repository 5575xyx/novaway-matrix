import { Show, createMemo, createSignal, onCleanup } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useCommand } from "@/context/command"
import { useProviders } from "@/hooks/use-providers"
import { usePermission } from "@/context/permission"
import { PromptInput } from "@/components/prompt-input"
import { Icon } from "@opencode-ai/ui/icon"
import { Mark } from "@opencode-ai/ui/logo"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"

const MAIN_WORKTREE = "main"
const CREATE_WORKTREE = "create"
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
  const sdk = useSDK()
  const language = useLanguage()
  const prompt = usePrompt()
  const command = useCommand()
  const providers = useProviders()
  const permission = usePermission()

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

  const sandboxes = createMemo(() => sync.project?.sandboxes ?? [])
  const options = createMemo(() => [MAIN_WORKTREE, ...sandboxes(), CREATE_WORKTREE])
  const current = createMemo(() => {
    const selection = props.worktree
    if (options().includes(selection)) return selection
    return MAIN_WORKTREE
  })
  const projectRoot = createMemo(() => sync.project?.worktree ?? sdk.directory)
  const isWorktree = createMemo(() => {
    const project = sync.project
    if (!project) return false
    return sdk.directory !== project.worktree
  })

  const label = (value: string) => {
    if (value === MAIN_WORKTREE) {
      if (isWorktree()) return language.t("session.new.worktree.main")
      const branch = sync.data.vcs?.branch
      if (branch) return language.t("session.new.worktree.mainWithBranch", { branch })
      return language.t("session.new.worktree.main")
    }

    if (value === CREATE_WORKTREE) return language.t("session.new.worktree.create")

    return getFilename(value)
  }

  return (
    <div class={ROOT_CLASS}>
      <div class="flex-1 flex flex-col items-center justify-center text-center">
        <div class="w-full max-w-lg flex flex-col items-center text-center gap-8 px-6">
          <div class="flex flex-col items-center gap-5">
            <div class="relative">
              <Mark class="w-10 animate-[logo-breathe_4s_ease-in-out_infinite]" />
              <div class="absolute inset-0 blur-xl bg-gradient-to-br from-[rgba(100,160,230,0.2)] to-[rgba(140,200,210,0.2)] rounded-full -z-10" />
            </div>
            <div class="text-20-medium gradient-text-aurora">{language.t("session.new.title")}</div>
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
          <div class="w-full px-4 pointer-events-auto">
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
