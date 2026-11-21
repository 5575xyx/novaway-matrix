import { For, Show, createEffect, createMemo, onCleanup, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useSpring } from "@novaway/ui/motion-spring"
import { useLayout } from "@/context/layout"
import { useFile } from "@/context/file"
import { PromptInput } from "@/components/prompt-input"
import { createPromptVeil, PromptInputLoading } from "@/components/prompt-input/loading"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { useLocal } from "@/context/local"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionKey, useSessionLayout } from "@/pages/session/session-layout"
import { createOpenSessionFileTab } from "@/pages/session/helpers"
import { isSessionFresh } from "@/pages/session/fresh-session"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionRevertDock } from "@/pages/session/composer/session-revert-dock"
import { SessionInterruptedBar } from "@/pages/session/composer/session-interrupted-bar"
import { SessionContextWarning } from "@/components/session-context-warning"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { diffs } from "@/utils/diffs"

export function SessionComposerRegion(props: {
  state: SessionComposerState
  ready: boolean
  centered: boolean
  embedded?: boolean
  inputRef: (el: HTMLDivElement) => void
  autoSubmitKey?: string
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onNewSessionWorktreeSelect?: (directory: string) => void
  onSubmit: () => void
  onResponseSubmit: () => void
  followup?: {
    /** 会话正在跑且可接收输入（用于排队/引导逻辑）。 */
    queue: () => boolean
    items: { id: string; text: string }[]
    sending?: string
    edit?: { id: string; prompt: FollowupDraft["prompt"]; context: FollowupDraft["context"] }
    onQueue: (draft: FollowupDraft) => void
    onAbort: () => void
    onSend: (id: string) => void
    onEdit: (id: string) => void
    onDelete: (id: string) => void
    onEditLoaded: () => void
  }
  revert?: {
    items: { id: string; text: string }[]
    restoring?: string
    disabled?: boolean
    onRestore: (id: string) => void
  }
  setPromptDockRef: (el: HTMLDivElement) => void
}) {
  const navigate = useNavigate()
  const layout = useLayout()
  const file = useFile()
  const prompt = usePrompt()
  const language = useLanguage()
  const local = useLocal()
  const route = useSessionKey()
  const sync = useSync()
  const sessionLayout = useSessionLayout()
  const view = layout.view(route.sessionKey)
  const [changedFilesOpen, setChangedFilesOpen] = createSignal(false)

  const changedFiles = createMemo(() => {
    const id = route.params.id
    if (!id) return []
    const seen = new Set<string>()
    return (sync.data.message[id] ?? [])
      .filter((message) => message.role === "user")
      .flatMap((message) => diffs(message.summary?.diffs))
      .filter((diff) => {
        const path = diff.file ?? ""
        if (!path || seen.has(path)) return false
        seen.add(path)
        return true
      })
      .reverse()
  })

  const info = createMemo(() => (route.params.id ? sync.session.get(route.params.id) : undefined))
  const parentID = createMemo(() => info()?.parentID)
  const child = createMemo(() => !!parentID())
  const showComposer = createMemo(() => !props.state.blocked() || child())

  const previewPrompt = () =>
    prompt
      .current()
      .map((part) => {
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        if (part.type === "image") return `[image:${part.filename}]`
        return part.content
      })
      .join("")
      .trim()

  createEffect(() => {
    if (!prompt.ready()) return
    setSessionHandoff(route.sessionKey(), { prompt: previewPrompt() })
  })

  const [store, setStore] = createStore({
    ready: false,
    height: 320,
    body: undefined as HTMLDivElement | undefined,
  })

  // 输入框加载遮罩：就绪后淡出。
  // 刚由我们创建的会话（send the first message 的那一刻）必然是空草稿，
  // 不用等持久化存储的 IPC 往返，直接当就绪 —— 否则每发第一条消息都会先盖一下遮罩。
  const veiling = createPromptVeil(() => prompt.ready()() || isSessionFresh(route.params.id))
  let timer: number | undefined
  let frame: number | undefined

  const clear = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
    if (frame !== undefined) {
      cancelAnimationFrame(frame)
      frame = undefined
    }
  }

  createEffect(() => {
    route.sessionKey()
    const ready = props.ready
    const delay = 140

    clear()
    setStore("ready", false)
    if (!ready) return

    frame = requestAnimationFrame(() => {
      frame = undefined
      timer = window.setTimeout(() => {
        setStore("ready", true)
        timer = undefined
      }, delay)
    })
  })

  onCleanup(clear)

  const open = createMemo(() => store.ready && props.state.dock() && !props.state.closing())
  const progress = useSpring(() => (open() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const value = createMemo(() => Math.max(0, Math.min(1, progress())))
  const dock = createMemo(() => (store.ready && props.state.dock()) || value() > 0.001)
  const rolled = createMemo(() => (props.revert?.items.length ? props.revert : undefined))
  const lift = createMemo(() => (props.embedded ? 0 : rolled() ? 18 : 36 * value()))
  const full = createMemo(() => Math.max(78, store.height))

  const openParent = () => {
    const id = parentID()
    if (!id) return
    navigate(`/${route.params.dir}/session/${id}`)
  }

  const openFileTab = createOpenSessionFileTab({
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
    openTab: sessionLayout.tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel: () => {
      if (!sessionLayout.view().reviewPanel.opened()) sessionLayout.view().reviewPanel.open()
    },
    setActive: sessionLayout.tabs().setActive,
  })

  const handleOpenFile = async (fileName: string) => {
    const results = await file.searchFiles(fileName)
    if (results.length > 0) {
      openFileTab(results[0])
    }
  }

  createEffect(() => {
    const el = store.body
    if (!el) return
    const update = () => setStore("height", el.getBoundingClientRect().height)
    createResizeObserver(store.body, update)
    update()
  })

  return (
    <div
      ref={props.setPromptDockRef}
      data-component="session-prompt-dock"
      classList={{
        "shrink-0 w-full flex flex-col justify-center items-center pointer-events-none": true,
        // 底部只留一线空隙:输入框贴近会话区底缘,时间线自带 BottomSpacer 保证滚到底时内容不被压住。
        "pb-1 bg-background/80 backdrop-blur-sm": !props.embedded,
      }}
    >
      <div
        classList={{
          "w-full pointer-events-auto": true,
          // 与时间线行框同一套几何：外框 max-width 用同一个变量，内边距也同款，
          // 输入框外缘才能和消息内容（卡片/正文）左右缘完全对齐，并随「内容宽度」同宽变化。
          "px-4 md:px-5": !props.embedded,
          "mx-auto": !props.embedded,
          "w-full": props.embedded,
        }}
        style={!props.embedded ? { "max-width": "var(--session-content-max-width, 820px)" } : undefined}
      >
        <Show when={props.state.questionRequest()} keyed>
          {(request) => (
            <div>
              <SessionQuestionDock request={request} onSubmit={props.onResponseSubmit} />
            </div>
          )}
        </Show>

        <Show when={props.state.permissionRequest()} keyed>
          {(request) => (
            <div>
              <SessionPermissionDock
                request={request}
                responding={props.state.permissionResponding()}
                onDecide={(response) => {
                  props.onResponseSubmit()
                  props.state.decide(response)
                }}
              />
            </div>
          )}
        </Show>

        {/* 任务被意外中断时，在输入框正上方固定挂一条琥珀色提示，
            不再把大块报错塞在会话底部；用户主动停止不会出现这条。 */}
        <SessionInterruptedBar />

        <Show when={showComposer()}>
          {/*
            这里原来还有一层 `Show when={prompt.ready()}`：未就绪时用一个
            `min-h-40 rounded-md` 的占位盒顶着，就绪后整块换成输入框。
            换的是两套几何完全不同的东西（半径 6 ↔ 16px、高度 160 ↔ 182），
            所以每次冷启动/换会话都能看到一次跳动。现在输入框直接挂载，
            未就绪时在上面盖一层同几何的遮罩（PromptInputLoading）淡出。
          */}
          <div class="relative w-full">
            <Show when={sync.data.session_working(route.params.id ?? "") && changedFiles().length > 0}>
              <div
                class="absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2"
                onMouseEnter={() => setChangedFilesOpen(true)}
                onMouseLeave={() => setChangedFilesOpen(false)}
              >
                <button
                  type="button"
                  class="flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-background px-3 py-2 text-ui-xs text-foreground shadow-lg"
                  aria-expanded={changedFilesOpen()}
                  onFocus={() => setChangedFilesOpen(true)}
                  onBlur={() => setChangedFilesOpen(false)}
                >
                  <span>{changedFiles().length} 个文件已修改</span>
                  <span class="text-[var(--icon-diff-add-base)]">
                    +{changedFiles().reduce((sum, diff) => sum + diff.additions, 0)}
                  </span>
                  <span class="text-[var(--icon-diff-delete-base)]">
                    -{changedFiles().reduce((sum, diff) => sum + diff.deletions, 0)}
                  </span>
                </button>
                <Show when={changedFilesOpen()}>
                  <div class="absolute bottom-full left-1/2 mb-2 max-h-72 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-xl border border-border bg-background p-3 shadow-xl">
                    <div class="mb-2 px-1 text-ui-xs font-medium text-foreground">
                      {changedFiles().length} 个文件已修改
                    </div>
                    <For each={changedFiles()}>
                      {(diff) => (
                        <div class="flex items-center gap-3 px-1 py-1.5 text-ui-xs text-foreground-subtle">
                          <span class="min-w-0 flex-1 truncate" title={diff.file}>
                            {diff.file}
                          </span>
                          <span class="shrink-0 text-[var(--icon-diff-add-base)]">+{diff.additions}</span>
                          <span class="shrink-0 text-[var(--icon-diff-delete-base)]">-{diff.deletions}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
            <SessionContextWarning />
            <Show when={rolled()} keyed>
              {(revert) => (
                <div
                  style={{
                    "margin-top": props.embedded ? "0px" : `${-36 * value()}px`,
                  }}
                >
                  <SessionRevertDock
                    items={revert.items}
                    restoring={revert.restoring}
                    disabled={revert.disabled}
                    onRestore={revert.onRestore}
                  />
                </div>
              )}
            </Show>
            <div
              classList={{
                "relative z-10": true,
              }}
              style={{
                "margin-top": `${-lift()}px`,
              }}
            >
              <Show when={props.followup?.items.length}>
                <SessionFollowupDock
                  items={props.followup!.items}
                  sending={props.followup!.sending}
                  onSend={props.followup!.onSend}
                  onEdit={props.followup!.onEdit}
                  onDelete={props.followup!.onDelete}
                />
              </Show>
              <Show
                when={child()}
                fallback={
                  <Show when={!props.state.blocked()}>
                    <PromptInput
                      ref={props.inputRef}
                      autoSubmitKey={props.autoSubmitKey}
                      newSessionWorktree={props.newSessionWorktree}
                      onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                      onNewSessionWorktreeSelect={props.onNewSessionWorktreeSelect}
                      edit={props.followup?.edit}
                      onEditLoaded={props.followup?.onEditLoaded}
                      shouldQueue={props.followup?.queue}
                      onQueue={props.followup?.onQueue}
                      onAbort={props.followup?.onAbort}
                      onSubmit={props.onSubmit}
                    />
                  </Show>
                }
              >
                <div
                  ref={props.inputRef}
                  class="w-full rounded-[16px] border border-border bg-background p-3 text-16-regular text-foreground-subtle shadow-lg"
                >
                  <span>{language.t("session.child.promptDisabled")} </span>
                  <Show when={parentID()}>
                    <button
                      type="button"
                      class="text-foreground transition-colors hover:text-foreground"
                      onClick={openParent}
                    >
                      {language.t("session.child.backToParent")}
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
            <Show when={veiling()}>
              <PromptInputLoading fading={prompt.ready()()} />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
