import type { Message, Session } from "@novaway/sdk/v2/client"
import { showToast } from "@novaway/ui/toast"
import { base64Encode } from "@novaway/core/util/encode"
import { Binary } from "@novaway/core/util/binary"
import { useNavigate, useParams } from "@solidjs/router"
import { batch, type Accessor } from "solid-js"
import type { FileSelection } from "@/context/file"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import type { SessionPermissionMode } from "@/context/permission-risk"
import { useModels } from "@/context/models"
import { usePermission } from "@/context/permission"
import { type ContextItem, type ImageAttachmentPart, type Prompt, usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { TeamSelection } from "@/context/team-selection"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { buildRequestParts } from "./build-request-parts"
import { setCursorPosition } from "./editor-dom"
import { formatServerError } from "@/utils/server-errors"
import { markSessionFresh } from "@/pages/session/fresh-session"

type PendingPrompt = {
  abort: AbortController
  cleanup: VoidFunction
}

const pending = new Map<string, PendingPrompt>()

export type FollowupDraft = {
  sessionID: string
  sessionDirectory: string
  prompt: Prompt
  syntheticText?: string
  context: (ContextItem & { key: string })[]
  agent: string
  model: { providerID: string; modelID: string }
  variant?: string
  goalExecution?: { goalId: string; maxIterations: number; title: string }
}

type FollowupSendInput = {
  client: ReturnType<typeof useSDK>["client"]
  sdk: ReturnType<typeof useSDK>
  globalSync: ReturnType<typeof useGlobalSync>
  sync: ReturnType<typeof useSync>
  draft: FollowupDraft
  messageID?: string
  optimisticBusy?: boolean
  before?: () => Promise<boolean> | boolean
}

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: Prompt) => prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

export async function sendFollowupDraft(input: FollowupSendInput) {
  const text = draftText(input.draft.prompt)
  const images = draftImages(input.draft.prompt)
  const goalExecution = input.draft.goalExecution
  if (
    input.draft.sessionDirectory === "global-chat" &&
    (images.length > 0 ||
      input.draft.context.length > 0 ||
      input.draft.syntheticText !== undefined ||
      input.draft.prompt.some((part) => part.type !== "text"))
  ) {
    throw new Error("Global chat accepts only plain text messages.")
  }
  const [, setStore] = input.globalSync.child(input.draft.sessionDirectory)

  const setBusy = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "busy" })
  }

  const setIdle = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "idle" })
  }

  const pauseGoalIfPromptDidNotStart = async (cause?: unknown) => {
    if (!goalExecution) return
    const record =
      cause && typeof cause === "object" ? (cause as { data?: { status?: number; message?: string } }) : undefined
    const message = record?.data?.message ?? (cause instanceof Error ? cause.message : "")
    if (record?.data?.status === 409 || /busy|already running|正在运行|繁忙/i.test(message)) return
    try {
      const goalResponse = await input.sdk.request(
        `${input.sdk.url}/session/${encodeURIComponent(input.draft.sessionID)}/goals/${encodeURIComponent(goalExecution.goalId)}`,
        { headers: { "x-novaway-directory": input.sdk.directory } },
      )
      if (goalResponse.ok) {
        const goal = (await goalResponse.json().catch(() => undefined)) as
          | { executionConfig?: { mode?: string; superAgentRunId?: string } }
          | undefined
        const runID = goal?.executionConfig?.superAgentRunId
        if (runID) {
          await input.sdk
            .request(`${input.sdk.url}/super-agent/runs/${encodeURIComponent(runID)}/cancel`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-novaway-directory": input.sdk.directory },
              body: JSON.stringify({}),
            })
            .catch(() => {})
        }
      }
      await input.sdk.request(
        `${input.sdk.url}/session/${encodeURIComponent(input.draft.sessionID)}/goals/${encodeURIComponent(goalExecution.goalId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-novaway-directory": input.sdk.directory },
          body: JSON.stringify({ status: "paused" }),
        },
      )
    } catch {
      // The original send error is more useful to the user. The server-side
      // lease and scheduler will still prevent an immediate duplicate run.
    }
  }

  const wait = async () => {
    const ok = await input.before?.()
    if (ok === false) return false
    return true
  }

  const [head, ...tail] = text.split(" ")
  const cmd = head?.startsWith("/") ? head.slice(1) : undefined
  if (
    input.draft.sessionDirectory !== "global-chat" &&
    cmd &&
    input.sync.data.command.find((item) => item.name === cmd)
  ) {
    setBusy()
    try {
      if (!(await wait())) {
        setIdle()
        return false
      }

      await input.client.session.command({
        sessionID: input.draft.sessionID,
        command: cmd,
        arguments: tail.join(" "),
        agent: input.draft.agent,
        model: `${input.draft.model.providerID}/${input.draft.model.modelID}`,
        variant: input.draft.variant,
        parts: images.map((attachment) => ({
          id: Identifier.ascending("part"),
          type: "file" as const,
          mime: attachment.mime,
          url: attachment.dataUrl,
          filename: attachment.filename,
        })),
      })
      return true
    } catch (err) {
      setIdle()
      throw err
    }
  }

  const messageID = input.messageID ?? Identifier.ascending("message")
  const { requestParts, optimisticParts } = buildRequestParts({
    prompt: input.draft.prompt,
    context: input.draft.context,
    images,
    text,
    syntheticText: input.draft.syntheticText,
    sessionID: input.draft.sessionID,
    messageID,
    sessionDirectory: input.draft.sessionDirectory,
  })

  const message: Message = {
    id: messageID,
    sessionID: input.draft.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: input.draft.agent,
    model: { ...input.draft.model, variant: input.draft.variant },
  }

  const add = () =>
    input.sync.session.optimistic.add({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      message,
      parts: optimisticParts,
    })

  const remove = () =>
    input.sync.session.optimistic.remove({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      messageID,
    })

  batch(() => {
    setBusy()
    add()
  })

  try {
    if (!(await wait())) {
      await pauseGoalIfPromptDidNotStart()
      batch(() => {
        setIdle()
        remove()
      })
      return false
    }

    await input.client.session.promptAsync({
      sessionID: input.draft.sessionID,
      agent: input.draft.agent,
      model: input.draft.model,
      messageID,
      parts: requestParts,
      variant: input.draft.variant,
      ...(goalExecution ? { goalExecution } : {}),
    })
    return true
  } catch (err) {
    await pauseGoalIfPromptDidNotStart(err)
    batch(() => {
      setIdle()
      remove()
    })
    throw err
  }
}

type PromptSubmitInput = {
  info: Accessor<{ id: string } | undefined>
  imageAttachments: Accessor<ImageAttachmentPart[]>
  commentCount: Accessor<number>
  autoAccept: Accessor<boolean>
  /** 新建会话时写入的权限档位（来自输入框里的选择或全局默认）。 */
  permissionMode: Accessor<SessionPermissionMode>
  mode: Accessor<"normal" | "shell">
  working: Accessor<boolean>
  editor: () => HTMLDivElement | undefined
  queueScroll: () => void
  promptLength: (prompt: Prompt) => number
  addToHistory: (prompt: Prompt, mode: "normal" | "shell") => void
  resetHistoryNavigation: () => void
  setMode: (mode: "normal" | "shell") => void
  setPopover: (popover: "at" | "slash" | null) => void
  newSessionWorktree?: Accessor<string | undefined>
  onNewSessionWorktreeReset?: () => void
  shouldQueue?: Accessor<boolean>
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
  transformPrompt?: (prompt: Prompt) => Prompt | { prompt: Prompt; syntheticText?: string }
  /**
   * 固定角色（嵌入场景，如运营工作台）：给了它就跳过"按模式推断角色"的逻辑，
   * 也不用去动 local 里的角色选择 —— 那个选择属于整个工作区，不该被面板改掉。
   */
  agentOverride?: () => string | undefined
  goalExecution?: Accessor<{ sessionID: string; goalId: string; title: string } | undefined>
  createGoal?: (text: string, durable?: boolean) => Promise<{ goalId: string; title: string } | undefined>
  goalMode?: Accessor<boolean>
  goalMaxIterations?: Accessor<number>
  longTask?: Accessor<{ enabled: boolean }>
  createLongTask?: (text: string) => Promise<string | undefined>
}

type CommentItem = {
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export function createPromptSubmit(input: PromptSubmitInput) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const local = useLocal()
  const permission = usePermission()
  const prompt = usePrompt()
  const layout = useLayout()
  const language = useLanguage()
  const params = useParams()
  const modelsCtx = useModels()

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const abort = async (targetSessionID = params.id) => {
    const sessionID = targetSessionID
    if (!sessionID) return Promise.resolve()

    globalSync.todo.set(sessionID, [])
    const [, setStore] = globalSync.child(sdk.directory)
    setStore("todo", sessionID, [])

    input.onAbort?.()

    const queued = pending.get(sessionID)
    if (queued) {
      queued.abort.abort()
      queued.cleanup()
      pending.delete(sessionID)
      return Promise.resolve()
    }
    return sdk.client.session
      .abort({
        sessionID,
      })
      .catch(() => {})
  }

  const restoreCommentItems = (items: CommentItem[]) => {
    for (const item of items) {
      prompt.context.add({
        type: "file",
        path: item.path,
        selection: item.selection,
        comment: item.comment,
        commentID: item.commentID,
        commentOrigin: item.commentOrigin,
        preview: item.preview,
      })
    }
  }

  const removeCommentItems = (items: { key: string }[]) => {
    for (const item of items) {
      prompt.context.remove(item.key)
    }
  }

  const clearContext = () => {
    for (const item of prompt.context.items()) {
      prompt.context.remove(item.key)
    }
  }

  const seed = (dir: string, info: Session) => {
    const [, setStore] = globalSync.child(dir)
    setStore("session", (list: Session[]) => {
      const result = Binary.search(list, info.id, (item) => item.id)
      const next = [...list]
      if (result.found) {
        next[result.index] = info
        return next
      }
      next.splice(result.index, 0, info)
      return next
    })
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()

    const rawPrompt = prompt.current()
    const rawText = rawPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = input.imageAttachments().slice()
    const mode = input.mode()

    if (rawText.trim().length === 0 && images.length === 0 && input.commentCount() === 0) {
      if (input.working()) void abort()
      return
    }
    const transformed = input.transformPrompt?.(rawPrompt) ?? rawPrompt
    const currentPrompt = Array.isArray(transformed) ? transformed : transformed.prompt
    const syntheticText = Array.isArray(transformed) ? undefined : transformed.syntheticText
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")

    const currentModel = local.model.current()
    const overrideAgent = input.agentOverride?.()
    const currentAgent = overrideAgent ? { name: overrideAgent } : local.agent.current()
    const variant = local.model.variant.current()
    if (!currentModel || !currentAgent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    input.addToHistory(rawPrompt, mode)
    input.resetHistoryNavigation()

    const projectDirectory = sdk.directory
    const isNewSession = !params.id
    // A new message from the workspace-free entry uses the global-create API;
    // after creation it is an ordinary project-scoped session in its private cwd.
    const globalChat = projectDirectory === "global-chat" && isNewSession
    const shouldAutoAccept = isNewSession && input.autoAccept()
    const worktreeSelection = globalChat ? "main" : input.newSessionWorktree?.() || "main"

    let sessionDirectory = projectDirectory
    let client = sdk.client

    if (isNewSession) {
      if (worktreeSelection === "create") {
        const createdWorktree = await client.worktree
          .create({ directory: projectDirectory })
          .then((x) => x.data)
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.worktreeCreateFailed.title"),
              description: errorMessage(err),
            })
            return undefined
          })

        if (!createdWorktree?.directory) {
          showToast({
            title: language.t("prompt.toast.worktreeCreateFailed.title"),
            description: language.t("common.requestFailed"),
          })
          return
        }
        WorktreeState.pending(createdWorktree.directory)
        sessionDirectory = createdWorktree.directory
      }

      if (worktreeSelection !== "main" && worktreeSelection !== "create") {
        sessionDirectory = worktreeSelection
      }

      if (sessionDirectory !== projectDirectory) {
        client = sdk.createClient({
          directory: sessionDirectory,
          throwOnError: true,
        })
        globalSync.child(sessionDirectory)
      }

      input.onNewSessionWorktreeReset?.()
    }

    let session = input.info()
    if (!session && isNewSession) {
      // 新会话的团队选择先记在待定槽位，建会话时一起写进 teamMode/teamIDs ——
      // 第一条消息到达前内核就要知道该不该注入团队目录。
      const team = TeamSelection.pending(projectDirectory)
      const createInput = {
        permissionMode: input.permissionMode(),
        ...(team ? { teamMode: team.mode } : {}),
        ...(team?.mode === "selected" ? { teamIDs: team.teamIDs } : {}),
      }
      // 不能把 SDK 方法先取出来再调用：方法体依赖 this.client，脱离接收者会直接抛错。
      const created = await (globalChat ? client.session.globalCreate(createInput) : client.session.create(createInput))
        .then((x) => x.data ?? undefined)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      if (created) {
        seed(sessionDirectory, created)
        // 档位已经写进会话，清掉「新会话待定档位」，否则它会一直盖住全局默认。
        permission.consumePendingMode(projectDirectory)
        // 团队选择同理：已经落到会话字段上，待定槽位再留着会带到下一次新会话。
        TeamSelection.clearPending(projectDirectory)
        // 刚建出来的会话必然是空的，登记后时间线跳过骨架屏（否则发送第一条消息时
        // 会先闪一下骨架屏再显示时间线）。
        markSessionFresh(created.id)
        session = created
        if (shouldAutoAccept) permission.enableAutoAccept(session.id, sessionDirectory)
        local.session.promote(sessionDirectory, session.id)
        layout.handoff.setTabs(base64Encode(sessionDirectory), session.id)
        navigate(
          projectDirectory === "global-chat"
            ? `/global-chat/session/${session.id}`
            : `/${base64Encode(sessionDirectory)}/session/${session.id}`,
        )
      }
    }
    if (!session) {
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: language.t("prompt.toast.promptSendFailed.description"),
      })
      return
    }

    // Auto mode was removed: always send the model the user selected.
    const finalModel = currentModel

    const model = {
      modelID: finalModel.id,
      providerID: finalModel.provider.id,
    }
    // 固定角色（嵌入场景）不做模式推断：运营工作台的输入框永远发给运营主智能体。
    const agent = overrideAgent ?? currentAgent.name
    if (!overrideAgent && agent !== currentAgent.name) {
      local.agent.set(agent)
    }
    if (!agent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }
    const context = prompt.context.items().slice()
    const commandCandidate = text.trim().split(" ")[0]
    const customCommandRequested =
      mode === "normal" &&
      commandCandidate?.startsWith("/") &&
      sync.data.command.some((item) => item.name === commandCandidate.slice(1))
    const durableGoalRequested = input.goalMode?.() === true && input.longTask?.().enabled === true
    let goalExecution = input.goalExecution?.()
    if (input.goalMode?.() && !goalExecution && mode === "normal" && !customCommandRequested) {
      const created = await input.createGoal?.(text, durableGoalRequested)
      if (!created) return
      goalExecution = { sessionID: session.id, ...created }
    }
    const draft: FollowupDraft = {
      sessionID: session.id,
      sessionDirectory,
      prompt: currentPrompt,
      syntheticText,
      goalExecution:
        goalExecution?.sessionID === session.id
          ? {
              goalId: goalExecution.goalId,
              maxIterations: input.goalMaxIterations?.() ?? 20,
              title: goalExecution.title,
            }
          : undefined,
      context,
      agent,
      model,
      variant,
    }

    const clearInput = () => {
      prompt.reset()
      input.setMode("normal")
      input.setPopover(null)
    }

    const restoreInput = () => {
      prompt.set(rawPrompt, input.promptLength(rawPrompt))
      input.setMode(mode)
      input.setPopover(null)
      requestAnimationFrame(() => {
        const editor = input.editor()
        if (!editor) return
        editor.focus()
        setCursorPosition(editor, input.promptLength(rawPrompt))
        input.queueScroll()
      })
    }

    if (!isNewSession && mode === "normal" && input.shouldQueue?.()) {
      input.onQueue?.(draft)
      clearContext()
      clearInput()
      return
    }

    if (mode === "shell") {
      input.onSubmit?.()
      clearInput()
      client.session
        .shell({
          sessionID: session.id,
          agent,
          model,
          command: text,
        })
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.shellSendFailed.title"),
            description: errorMessage(err),
          })
          restoreInput()
        })
      return
    }

    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync.data.command.find((c) => c.name === commandName)
      if (customCommand) {
        input.onSubmit?.()
        clearInput()
        client.session
          .command({
            sessionID: session.id,
            command: commandName,
            arguments: args.join(" "),
            agent,
            model: `${model.providerID}/${model.modelID}`,
            variant,
            parts: images.map((attachment) => ({
              id: Identifier.ascending("part"),
              type: "file" as const,
              mime: attachment.mime,
              url: attachment.dataUrl,
              filename: attachment.filename,
            })),
          })
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.commandSendFailed.title"),
              description: formatServerError(err, language.t, language.t("common.requestFailed")),
            })
            restoreInput()
          })
        return
      }
    }

    input.onSubmit?.()
    const commentItems = context.filter(
      (item): item is Extract<ContextItem, { type: "file" }> & { key: string } =>
        item.type === "file" && !!item.comment?.trim(),
    )
    const messageID = Identifier.ascending("message")

    const removeOptimisticMessage = () => {
      sync.session.optimistic.remove({
        directory: sessionDirectory,
        sessionID: session.id,
        messageID,
      })
    }

    removeCommentItems(commentItems)
    clearInput()

    const waitForWorktree = async () => {
      const worktree = WorktreeState.get(sessionDirectory)
      if (!worktree || worktree.status !== "pending") return true

      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", session.id, { type: "busy" })
      }

      const controller = new AbortController()
      const cleanup = () => {
        if (sessionDirectory === projectDirectory) {
          sync.set("session_status", session.id, { type: "idle" })
        }
        removeOptimisticMessage()
        restoreCommentItems(commentItems)
        restoreInput()
      }

      pending.set(session.id, { abort: controller, cleanup })

      const abortWait = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        if (controller.signal.aborted) {
          resolve({ status: "failed", message: "aborted" })
          return
        }
        controller.signal.addEventListener(
          "abort",
          () => {
            resolve({ status: "failed", message: "aborted" })
          },
          { once: true },
        )
      })

      const timeoutMs = 5 * 60 * 1000
      const timer = { id: undefined as number | undefined }
      const timeout = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        timer.id = window.setTimeout(() => {
          resolve({
            status: "failed",
            message: language.t("workspace.error.stillPreparing"),
          })
        }, timeoutMs)
      })

      const result = await Promise.race([WorktreeState.wait(sessionDirectory), abortWait, timeout]).finally(() => {
        if (timer.id === undefined) return
        clearTimeout(timer.id)
      })
      pending.delete(session.id)
      if (controller.signal.aborted) return false
      if (result.status === "failed") throw new Error(result.message)
      return true
    }

    void sendFollowupDraft({
      client,
      sdk,
      sync,
      globalSync,
      draft,
      messageID,
      optimisticBusy: sessionDirectory === projectDirectory,
      before: waitForWorktree,
    }).catch((err) => {
      pending.delete(session.id)
      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", session.id, { type: "idle" })
      }
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: errorMessage(err),
      })
      removeOptimisticMessage()
      restoreCommentItems(commentItems)
      restoreInput()
    })
  }

  return {
    abort,
    handleSubmit,
  }
}
