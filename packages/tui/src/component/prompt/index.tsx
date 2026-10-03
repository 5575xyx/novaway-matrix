import {
  BoxRenderable,
  RGBA,
  StyledText,
  TextareaRenderable,
  MouseEvent,
  PasteEvent,
  decodePasteBytes,
  type KeyEvent,
  type Renderable,
} from "@opentui/core"
import type { CommandContext } from "@opentui/keymap"
import { createEffect, createMemo, onMount, createSignal, onCleanup, on, Show, Switch, Match } from "solid-js"
import { registerNovaWaySpinner } from "../register-spinner"
import path from "path"
import { fileURLToPath } from "url"
import { useLocal } from "../../context/local"
import { Flag } from "@novaway/core/flag/flag"
import { tint, useTheme } from "../../context/theme"
import { useTuiPaths, useTuiTerminalEnvironment } from "../../context/runtime"
import { useClipboard } from "../../context/clipboard"
import { Spinner } from "../spinner"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { useEvent } from "../../context/event"
import { editorSelectionKey, useEditorContext, type EditorSelection } from "../../context/editor"
import { normalizePromptContent, openEditor } from "../../editor"
import { useExit } from "../../context/exit"
import { promptOffsetWidth } from "../../prompt/display"
import { createStore, produce, unwrap } from "solid-js/store"
import { usePromptHistory, type PromptInfo } from "../../prompt/history"
import { computePromptTraits } from "../../prompt/traits"
import { nextQueueId, type QueueDraft } from "../../prompt/queue"
import { expandPastedTextPlaceholders, expandTrackedPastedText } from "../../prompt/part"
import { usePromptStash } from "../../prompt/stash"
import { DialogStash } from "../dialog-stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import type { FilePart, UserMessage } from "@novaway/sdk-v2-latest/v2"
import { Locale } from "../../util/locale"
import { agentDisplayName } from "../../util/agent-name"
import { errorMessage } from "../../util/error"
import { formatDuration } from "../../util/format"
import { animGradient } from "../../util/anim-spinner"
import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../spinner"
import { useDialog } from "../../ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { DialogAlert } from "../../ui/dialog-alert"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { createFadeIn } from "../../util/signal"
import { DialogSkill } from "../dialog-skill"
import { DialogWorkspaceUnavailable } from "../dialog-workspace-unavailable"
import { useArgs } from "../../context/args"
import { NovaWay_BASE_MODE, useBindings, useLeaderActive, useNovaWayKeymap } from "../../keymap"
import { useTuiConfig } from "../../config"
import { usePromptWorkspace } from "./workspace"
import { usePromptMove } from "./move"
import { readLocalAttachment } from "./local-attachment"
import { sessionUsage, usageLabel } from "../../util/usage"
import { PromptCard, PromptBottomRow, PromptHints, PromptSend, usageRowColumns } from "./card"

registerNovaWaySpinner()

export type PromptProps = {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef | undefined) => void
  hint?: JSX.Element
  right?: JSX.Element
  showPlaceholder?: boolean
  // readonly:调用方常写成 `as const` 的模块级常量(见 routes/session 的 SESSION_PLACEHOLDERS),
  // 这里只读不写,不该逼调用方去掉 as const。
  placeholders?: {
    normal?: readonly string[]
    shell?: readonly string[]
  }
  /** 返回 true 时，正常提示模式下的提交会被暂存到队列而非直接发送 */
  shouldQueue?: () => boolean
  /** 排队回调：会话忙碌时由 submitInner 调用 */
  onQueue?: (draft: QueueDraft) => void
  /**
   * 客户端本地斜杠命令。收到以 `/` 开头的整行输入时先问它:返回 true = 已就地处理、
   * 不要把它发给模型(输入框由 Prompt 清空),返回 false = 不是本地命令,照常发送。
   *
   * 只给真正需要在输入框里带参数的客户端命令用(会话页的 `/布局 bubble|flow`);
   * 纯开关类命令(时间戳、侧栏)走斜杠菜单选中即派发的那条路,不需要这个钩子。
   * 首页不传 —— 那里还没有会话,视图命令也就无从谈起。
   */
  onLocalCommand?: (line: string) => boolean
}

function pastedFilepath(value: string, platform: string) {
  const raw = value.replace(/^['"]+|['"]+$/g, "")
  if (raw.startsWith("file://")) {
    try {
      return fileURLToPath(raw)
    } catch {}
  }
  if (platform === "win32") return raw
  return raw.replace(/\\(.)/g, "$1")
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
  insertText(text: string): void
}

const DRAFT_RETENTION_MIN_CHARS = 20

// 示例占位符比提示语更沉的一档(alpha 见 buildPlaceholder 的调用处)。
const PLACEHOLDER_EXAMPLE_ALPHA = 0.55

function randomIndex(count: number) {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}

export function fadeColor(color: RGBA | undefined, alpha: number, fallback: RGBA = RGBA.fromInts(255, 255, 255)) {
  if (!color) color = fallback
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

function hasEditorRangeSelection(selection: EditorSelection["ranges"][number]) {
  return (
    selection.selection.start.line !== selection.selection.end.line ||
    selection.selection.start.character !== selection.selection.end.character
  )
}

// 占位符是两段式:提示语用 textMuted,后面那个示例再压暗一档 —— 原型里
// 「问我任何事...」和「"示例"」是主次两级,单色字符串区分不出来。
// Textarea 的 placeholder 收 StyledText,按两段 chunk 分别给色。
// exampleAlpha 把 textMuted 的 alpha 压下去:占位符画在输入卡的背景上,alpha 越低越沉。
// 抽成纯函数是为了能直接单测 —— Prompt 挂载要整套 session/local context,拆不动。
export function buildPlaceholder(input: {
  prefix: string
  examples: readonly string[]
  index: number
  muted: RGBA
  exampleAlpha: number
}) {
  if (input.examples.length === 0) return undefined
  return new StyledText([
    { __isChunk: true, text: input.prefix, fg: input.muted },
    {
      __isChunk: true,
      text: `"${input.examples[input.index % input.examples.length]}"`,
      fg: fadeColor(input.muted, input.exampleAlpha),
    },
  ])
}

function getEditorRangeLabel(selection: EditorSelection["ranges"][number]) {
  if (!hasEditorRangeSelection(selection)) return
  if (selection.selection.start.line === selection.selection.end.line) return `#${selection.selection.start.line}`
  return `#${selection.selection.start.line}-${selection.selection.end.line}`
}

function formatEditorContext(selection: EditorSelection) {
  const selected = selection.ranges.filter(hasEditorRangeSelection)
  if (selected.length === 0)
    return `<system-reminder>注意：用户打开了文件 "${selection.filePath}"。这可能与当前任务相关，也可能不相关。</system-reminder>\n`

  const ranges = selected.map((range, index) => {
    const prefix = selected.length > 1 ? `Selection ${index + 1}: ` : ""
    return `注意：用户选择了 ${prefix}${getEditorRangeLabel(range)} 来自 "${selection.filePath}"。\`\`\`${range.text}\`\`\`\n\n`
  })

  return `<system-reminder>${ranges.join("\n")} 这可能与当前任务相关，也可能不相关。</system-reminder>\n`
}

let stashed: { prompt: PromptInfo; cursor: number } | undefined

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  const [inputTarget, setInputTarget] = createSignal<TextareaRenderable | undefined>()

  const leader = useLeaderActive()
  const local = useLocal()
  const args = useArgs()
  const paths = useTuiPaths()
  const terminalEnvironment = useTuiTerminalEnvironment()
  const clipboard = useClipboard()
  const sdk = useSDK()
  const editor = useEditorContext()
  const route = useRoute()
  const project = useProject()
  const sync = useSync()
  const tuiConfig = useTuiConfig()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const keymap = useNovaWayKeymap()
  const renderer = useRenderer()
  const exit = useExit()
  const dimensions = useTerminalDimensions()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
  // 聚焦态驱动输入卡的流动描边(animated):on:focused/on:blurred 是 Renderable 的
  // EventEmitter 事件,由 solid 的 on: 前缀接线。
  const [promptFocused, setPromptFocused] = createSignal(false)
  const list = createMemo(() => props.placeholders?.normal ?? [])
  const shell = createMemo(() => props.placeholders?.shell ?? [])
  const fileContextEnabled = createMemo(() => kv.get("file_context_enabled", true))
  const [dismissedEditorSelectionKey, setDismissedEditorSelectionKey] = createSignal<string>()
  const editorContext = createMemo(() => {
    const selection = fileContextEnabled() ? editor.selection() : undefined
    if (!selection) return
    return editorSelectionKey(selection) === dismissedEditorSelectionKey() ? undefined : selection
  })
  const editorPath = createMemo(() => editorContext()?.filePath)
  const editorSelectionLabel = createMemo(() => {
    const ranges = editorContext()?.ranges
    if (!ranges) return
    const first = ranges.find(hasEditorRangeSelection) ?? ranges[0]
    if (!first) return
    return [getEditorRangeLabel(first), ranges.length > 1 ? `+${ranges.length - 1}` : undefined]
      .filter(Boolean)
      .join(" ")
  })
  const editorFileLabel = createMemo(() => {
    const value = editorPath()
    if (!value) return
    const filename = path.basename(value)
    const file = /^index\.[^./]+$/.test(filename)
      ? [path.basename(path.dirname(value)), filename].filter(Boolean).join("/")
      : filename
    return `${file.split(path.sep).join("/")}${editorSelectionLabel() ?? ""}`
  })
  const editorFileLabelDisplay = createMemo(() => {
    const file = editorFileLabel()
    if (!file) return
    return Locale.truncateMiddle(file, Math.max(12, Math.min(48, Math.floor(dimensions().width / 3))))
  })
  const editorContextLabelState = createMemo(() => editor.labelState())
  const [auto, setAuto] = createSignal<AutocompleteRef>()
  const workspace = usePromptWorkspace(props.sessionID)
  const move = usePromptMove({ projectID: project.project, sessionID: () => props.sessionID })
  const [cursorVersion, setCursorVersion] = createSignal(0)
  const currentProviderLabel = createMemo(() => local.model.parsed().provider)
  // 提交在飞的重入锁。做成 signal 而不是普通变量,是为了让 canSend() 能读它 ——
  // 见下面 canSend 的说明。
  const [submitting, setSubmitting] = createSignal(false)

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "连接提供商以发送提示",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  function dismissEditorContext() {
    setDismissedEditorSelectionKey(editorSelectionKey(editorContext()))
    editor.clearSelection()
  }
  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0
  const event = useEvent()

  // 退订函数必须收着:Prompt 会随会话切换重建,漏一次就多一个永久监听,
  // 而它捕获的 input 是上一个已销毁的输入框。
  onCleanup(
    event.on("tui.prompt.append", (evt, { workspace }) => {
      if (workspace !== project.workspace.current()) return
      if (!input || input.isDestroyed) return
      input.insertText(evt.properties.text)
      setTimeout(() => {
        // setTimeout is a workaround and needs to be addressed properly
        if (!input || input.isDestroyed) return
        input.getLayoutNode().markDirty()
        input.gotoBufferEnd()
        renderer.requestRender()
      }, 0)
    }),
  )

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
    if (tuiConfig.cursor) input.cursorStyle = tuiConfig.cursor
  })

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m): m is UserMessage => m.role === "user")
  })

  // 上下文占用。口径在 util/usage:输入卡状态行与标签行的 `8.2K ctx` 胶囊问的是同一个数。
  const usage = createMemo(() => (props.sessionID ? sessionUsage(sync, props.sessionID) : undefined))

  // 这一行到底要不要渲染。**判据是「除 usage 外还有没有东西要说」** —— usage 已经折进卡内
  // 底部行(见 PromptBottomRow 的 usage 段),空闲时若还留着这条状态行,输入卡底下就只剩
  // 一条几乎全空的行(80 列里只有右端 5 列有字),用户报的就是这个「输入卡下面空了一行」。
  //
  // 逐条对应下面那个 Switch 的分支,加新分支时**必须同步加进这里**,否则那一档会静默地
  // 渲染在一张零高度的宿主盒子里(什么都不出现)。左边四档各自独占一行内容:
  //   · status ≠ idle —— 转圈 + retry 文案 + `esc 中断`(retry 时右半边整块不画);
  //   · workspace.notice / workspace.label —— 「Warped to X」/「Workspace <名>」与建工作区进度;
  //   · move.progress / move.pendingNew —— 移动会话进度与「(new working copy)」。
  // 右半边只剩编辑器文件标签(usage 搬走之后),它在时也要留这一行,否则标签会没地方显示。
  // props.hint 是首页自己给的提示(目标是目录,与会话页底栏那份不同语义),给了就画。
  const statusRowVisible = createMemo(
    () =>
      Boolean(props.hint) ||
      status().type !== "idle" ||
      Boolean(workspace.notice()) ||
      Boolean(workspace.label()) ||
      Boolean(move.progress()) ||
      Boolean(move.pendingNew()) ||
      (editorContextLabelState() !== "none" && Boolean(editorFileLabelDisplay())),
  )

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: randomIndex(list().length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  // 发送按钮能不能点:与 submitInner 的前置守卫(见下面 disabled / creating / 弹层可见 /
  // 空输入 / 无 agent 那五条)以及 submit() 的重入锁同一组条件,只是提前把结果画在按钮上 ——
  // 真判定仍在 submit() 里,这里不给它开旁路。
  // submitting 必须算进来:提交在飞的那一两帧里 store.prompt.input 还没清空,
  // 不看这个信号的话按钮会一直亮着,点下去被重入锁静默吞掉。
  //
  // 这个 memo 必须声明在 store 之后:createMemo 会立即跑一次求值,而这里读的
  // store.prompt.input 在声明之前会撞 TDZ(Cannot access 'store' before initialization),
  // 整个 Prompt 渲染直接崩。新增依赖 store 的 memo 时留意这条。
  const canSend = createMemo(
    () =>
      !props.disabled &&
      !workspace.creating() &&
      !move.creating() &&
      !auto()?.visible &&
      Boolean(store.prompt.input) &&
      Boolean(local.agent.current()) &&
      !submitting(),
  )

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", randomIndex(list().length))
      },
      { defer: true },
    ),
  )

  // Initialize agent/model/variant from last user message when session changes
  let syncedSessionID: string | undefined
  createEffect(() => {
    const sessionID = props.sessionID
    const msg = lastUserMessage()

    if (sessionID !== syncedSessionID) {
      if (!sessionID || !msg) return

      syncedSessionID = sessionID

      // Only set agent if it's a primary agent (not a subagent)
      const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
      if (msg.agent && isPrimaryAgent) {
        // Keep command line --agent if specified.
        if (!args.agent) local.agent.set(msg.agent)
        if (msg.model) {
          local.model.set(msg.model)
          local.model.variant.set(msg.model.variant)
        }
      }
    }
  })

  const promptCommands = createMemo(() =>
    [
      {
        title: "清除提示",
        name: "prompt.clear",
        category: "输入",
        hidden: true,
        run: () => {
          clearPrompt()
          dialog.clear()
        },
      },
      {
        title: "提交提示",
        name: "prompt.submit",
        category: "输入",
        hidden: true,
        run: async () => {
          if (!input.focused) return
          const handled = await submit()
          if (!handled) return

          dialog.clear()
        },
      },
      {
        title: "移除编辑器上下文",
        name: "prompt.editor_context.clear",
        category: "输入",
        enabled: Boolean(editorContext()),
        run: () => {
          dismissEditorContext()
          dialog.clear()
        },
      },
      {
        title: "粘贴",
        name: "prompt.paste",
        category: "输入",
        hidden: true,
        run: async (ctx: CommandContext<Renderable, KeyEvent>) => {
          ctx.event.preventDefault()
          ctx.event.stopPropagation()
          const content = await clipboard.read?.()
          if (content?.mime.startsWith("image/")) {
            await pasteAttachment({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
            return
          }
          if (content?.mime === "text/plain") {
            await pasteInputText(content.data)
          }
        },
      },
      {
        title: "中断会话",
        name: "session.interrupt",
        category: "会话",
        hidden: true,
        enabled: status().type !== "idle",
        run: () => {
          if (auto()?.visible) return
          if (!input.focused) return
          // TODO: this should be its own command
          if (store.mode === "shell") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            void sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "打开编辑器",
        category: "会话",
        name: "prompt.editor",
        slashName: "editor",
        run: async () => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = text
          const content = await openEditor({
            renderer,
            value,
            cwd:
              (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree) ||
              project.instance.directory() ||
              paths.cwd,
          })
          if (!content) return
          const normalized = normalizePromptContent(content)

          input.setText(normalized)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = normalized.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: normalized,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(normalized)
        },
      },
      {
        title: "技能",
        name: "prompt.skills",
        category: "输入",
        slashName: "skills",
        run: () => {
          dialog.replace(() => (
            <DialogSkill
              onSelect={(skill) => {
                input.setText(`/${skill} `)
                setStore("prompt", {
                  input: `/${skill} `,
                  parts: [],
                })
                input.gotoBufferEnd()
              }}
            />
          ))
        },
      },
      {
        title: "传送",
        desc: "更改会话的工作区",
        name: "workspace.set",
        category: "会话",
        enabled: Flag.NOVAWAY_EXPERIMENTAL_WORKSPACES,
        slashName: "warp",
        run: () => {
          workspace.open()
        },
      },
      {
        title: "移动会话",
        desc: "移动到其他项目目录",
        name: "session.move",
        category: "会话",
        slashName: "move",
        run: () => {
          move.open()
        },
      },
    ].map((entry) => ({
      namespace: "palette",
      ...entry,
    })),
  )

  useBindings(() => ({
    commands: promptCommands(),
  }))

  useBindings(() => ({
    mode: NovaWay_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("prompt.palette", [
      "prompt.submit",
      "prompt.editor",
      "prompt.editor_context.clear",
      "prompt.stash",
      "prompt.stash.pop",
      "prompt.stash.list",
      "prompt.skills",
      "session.interrupt",
      "workspace.set",
      "session.move",
    ]),
  }))

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
    submit() {
      void submit()
    },
    insertText(text: string) {
      input.insertText(text)
    },
  }

  onMount(() => {
    const saved = stashed
    stashed = undefined
    if (store.prompt.input) return
    if (saved && saved.prompt.input) {
      input.setText(saved.prompt.input)
      setStore("prompt", saved.prompt)
      restoreExtmarksFromParts(saved.prompt.parts)
      input.cursorOffset = saved.cursor
    }
  })

  onCleanup(() => {
    if (store.prompt.input) {
      stashed = { prompt: unwrap(store.prompt), cursor: input.cursorOffset }
    }
    setInputTarget(undefined)
    props.ref?.(undefined)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.visible === false || dialog.stack.length > 0) {
      if (input.focused) input.blur()
      return
    }

    // Slot/plugin updates can remount the background prompt while a dialog is open.
    // Keep focus with the dialog and let the prompt reclaim it after the dialog closes.
    if (!input.focused) input.focus()
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    input.traits = {
      ...input.traits,
      ...computePromptTraits({
        mode: store.mode,
        autocompleteVisible: !!auto()?.visible,
      }),
    }
  })

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = fileStyleId
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = agentStyleId
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = pasteStyleId
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  const stashCommands = createMemo(() =>
    [
      {
        title: "暂存提示",
        name: "prompt.stash",
        category: "输入",
        enabled: !!store.prompt.input,
        run: () => {
          if (!store.prompt.input) return
          stash.push({
            input: store.prompt.input,
            parts: store.prompt.parts,
          })
          input.extmarks.clear()
          input.clear()
          setStore("prompt", { input: "", parts: [] })
          setStore("extmarkToPartIndex", new Map())
          dialog.clear()
        },
      },
      {
        title: "暂存弹出",
        name: "prompt.stash.pop",
        category: "输入",
        enabled: stash.list().length > 0,
        run: () => {
          const entry = stash.pop()
          if (entry) {
            input.setText(entry.input)
            setStore("prompt", { input: entry.input, parts: entry.parts })
            restoreExtmarksFromParts(entry.parts)
            input.gotoBufferEnd()
          }
          dialog.clear()
        },
      },
      {
        title: "暂存列表",
        name: "prompt.stash.list",
        category: "输入",
        enabled: stash.list().length > 0,
        run: () => {
          dialog.replace(() => (
            <DialogStash
              onSelect={(entry) => {
                input.setText(entry.input)
                setStore("prompt", { input: entry.input, parts: entry.parts })
                restoreExtmarksFromParts(entry.parts)
                input.gotoBufferEnd()
              }}
            />
          ))
        },
      },
    ].map((entry) => ({
      namespace: "palette",
      ...entry,
    })),
  )

  useBindings(() => ({
    commands: stashCommands(),
  }))

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && !props.disabled,
      bindings: tuiConfig.keybinds.get("prompt.paste"),
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && !props.disabled && store.prompt.input !== "",
      bindings: tuiConfig.keybinds.get("prompt.clear"),
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return (
          inputTarget() !== undefined &&
          !props.disabled &&
          store.mode === "normal" &&
          !auto()?.visible &&
          input?.visualCursor.offset === 0
        )
      })(),
      bindings: [
        {
          key: "!",
          desc: "Shell 模式",
          group: "Prompt",
          cmd: () => {
            setStore("placeholder", randomIndex(shell().length))
            setStore("mode", "shell")
          },
        },
      ],
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && store.mode === "shell",
      bindings: [{ key: "escape", desc: "退出 Shell 模式", group: "Prompt", cmd: () => setStore("mode", "normal") }],
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && store.mode === "shell" && input?.visualCursor.offset === 0
      })(),
      bindings: [{ key: "backspace", desc: "退出 Shell 模式", group: "Prompt", cmd: () => setStore("mode", "normal") }],
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && !props.disabled && !auto()?.visible && input !== undefined
      })(),
      commands: [
        {
          name: "prompt.history.previous",
          title: "上一个提示历史",
          category: "输入",
          run() {
            if (input.cursorOffset !== 0) {
              if (input.scrollY + input.visualCursor.visualRow === 0) input.cursorOffset = 0
              return false
            }

            const item = history.move(-1, input.plainText)
            if (!item) return false
            input.setText(item.input)
            setStore("prompt", item)
            setStore("mode", item.mode ?? "normal")
            restoreExtmarksFromParts(item.parts)
            input.cursorOffset = 0
          },
        },
      ],
      bindings: tuiConfig.keybinds.get("prompt.history.previous"),
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && !props.disabled && !auto()?.visible && input !== undefined
      })(),
      commands: [
        {
          name: "prompt.history.next",
          title: "下一个提示历史",
          category: "输入",
          run() {
            if (input.cursorOffset !== input.plainText.length) {
              if (
                input.scrollY + input.visualCursor.visualRow ===
                Math.max(0, input.editorView.getTotalVirtualLineCount() - 1)
              )
                input.cursorOffset = input.plainText.length
              return false
            }

            const item = history.move(1, input.plainText)
            if (!item) return false
            input.setText(item.input)
            setStore("prompt", item)
            setStore("mode", item.mode ?? "normal")
            restoreExtmarksFromParts(item.parts)
            input.cursorOffset = input.plainText.length
          },
        },
      ],
      bindings: tuiConfig.keybinds.get("prompt.history.next"),
    }
  })

  async function submit() {
    // Prevent overlapping invocations (e.g. a double-pressed Enter, or the
    // input's native onSubmit racing another dispatch). Without this guard,
    // a second call slips past the empty-input check before the first call
    // clears `store.prompt.input`, then awaits its own `session.create` and
    // ultimately reads the now-empty store 鈥?sending a phantom empty prompt
    // to a freshly created session.
    if (submitting()) return false
    setSubmitting(true)
    try {
      return await submitInner()
    } finally {
      setSubmitting(false)
    }
  }

  async function submitInner() {
    workspace.clearNotice()

    // IME: double-defer may fire before onContentChange flushes the last
    // composed character (e.g. Korean hangul) to the store, so read
    // plainText directly and sync before any downstream reads.
    if (input && !input.isDestroyed && input.plainText !== store.prompt.input) {
      setStore("prompt", "input", input.plainText)
      syncExtmarksWithPromptParts()
    }
    if (props.disabled) return false
    if (workspace.creating() || move.creating()) return false
    if (auto()?.visible) return false
    if (!store.prompt.input) return false
    const agent = local.agent.current()
    if (!agent) return false
    const trimmed = store.prompt.input.trim()
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      void exit()
      return true
    }
    // 客户端本地斜杠命令(会话页的 `/布局 bubble|flow`)。必须排在建会话与选模型**之前**:
    // 这类命令根本不产生一条消息,让它走到发送路径就等于把「/布局 flow」当提示词发给模型。
    // 不写进 history —— 它不是一条提示,上下方向键翻出来的应该是用户真发过的话。
    if (trimmed.startsWith("/") && props.onLocalCommand?.(trimmed)) {
      input.extmarks.clear()
      setStore("prompt", { input: "", parts: [] })
      setStore("extmarkToPartIndex", new Map())
      input.clear()
      return true
    }
    const selectedModel = local.model.current()
    if (!selectedModel) {
      void promptModelWarning()
      return false
    }

    const workspaceSession = props.sessionID ? sync.session.get(props.sessionID) : undefined
    const workspaceID = workspaceSession?.workspaceID
    const workspaceStatus = workspaceID ? (project.workspace.status(workspaceID) ?? "error") : undefined
    if (props.sessionID && workspaceID && workspaceStatus !== "connected") {
      dialog.replace(() => (
        <DialogWorkspaceUnavailable
          onRestore={() => {
            workspace.open()
            return false
          }}
        />
      ))
      return false
    }

    const variant = local.model.variant.current()
    let sessionID = props.sessionID
    let finishMoveProgress = false
    if (sessionID == null) {
      const selectedWorkspace = workspace.selection()
      const workspaceID = selectedWorkspace?.type === "existing" ? selectedWorkspace.workspaceID : undefined

      const directory = await move.getDirectory(store.prompt.input)
      if (move.pending() && !directory) return false
      finishMoveProgress = Boolean(move.progress())

      const res = await sdk.client.session.create({
        directory,
        workspace: workspaceID,
        agent: agent.name,
        model: {
          providerID: selectedModel.providerID,
          id: selectedModel.modelID,
          variant,
        },
      })

      if (res.error) {
        if (finishMoveProgress) move.finishSubmit()
        console.log("Creating a session failed:", res.error)

        toast.show({
          message: "创建会话失败。打开控制台查看详情。",
          variant: "error",
        })

        return true
      }

      sessionID = res.data.id
    }

    const inputText = expandTrackedPastedText(
      store.prompt.input,
      input.extmarks.getAllForTypeId(promptPartTypeId).flatMap((extmark) => {
        const partIndex = store.extmarkToPartIndex.get(extmark.id)
        const part = partIndex === undefined ? undefined : store.prompt.parts[partIndex]
        if (part?.type !== "text") return []
        return [{ start: extmark.start, end: extmark.end, text: part.text }]
      }),
    )

    // Filter out text parts (pasted content) since they're now expanded inline
    const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")

    // Capture mode before it gets reset
    const currentMode = store.mode
    const editorSelection = editorContext()
    const editorParts =
      editorSelection && editor.labelState() === "pending"
        ? [
            {
              type: "text" as const,
              text: formatEditorContext(editorSelection),
              synthetic: true,
              metadata: {
                kind: "editor_context",
                source: editorSelection.source ?? "editor",
                filePath: editorSelection.filePath,
                ranges: editorSelection.ranges,
              },
            },
          ]
        : []

    // 会话忙碌且父会话允许排队时，把当前提示暂存到队列而不是直接发送。
    // 队列由 session 层管理，等会话空闲后按顺序自动发送。
    if (store.mode === "normal" && sessionID && props.shouldQueue?.() && props.onQueue) {
      move.startSubmit()
      props.onQueue({
        id: nextQueueId(),
        sessionID,
        agent: agent.name,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
          variant,
        },
        inputText,
        nonTextParts,
        editorParts,
      })
      history.append({
        ...store.prompt,
        mode: currentMode,
      })
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
      props.onSubmit?.()
      if (editorParts.length > 0) editor.markSelectionSent()
      if (finishMoveProgress) move.finishSubmit()
      input.clear()
      return true
    }

    if (store.mode === "shell") {
      move.startSubmit()
      void sdk.client.session.shell({
        sessionID,
        agent: agent.name,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
        },
        command: inputText,
      })
      setStore("mode", "normal")
    } else if (
      inputText.startsWith("/") &&
      sync.data.command.some((x) => x.name === inputText.split("\n")[0].split(" ")[0].slice(1))
    ) {
      move.startSubmit()
      // Parse command from first line, preserve multi-line content in arguments
      const firstLineEnd = inputText.indexOf("\n")
      const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
      const [command, ...firstLineArgs] = firstLine.split(" ")
      const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
      const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")

      void sdk.client.session.command({
        sessionID,
        command: command.slice(1),
        arguments: args,
        agent: agent.name,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        variant,
        parts: nonTextParts.filter((x) => x.type === "file"),
      })
    } else {
      move.startSubmit()
      sdk.client.session
        .prompt(
          {
            sessionID,
            ...selectedModel,
            agent: agent.name,
            model: selectedModel,
            variant,
            parts: [
              ...editorParts,
              {
                type: "text",
                text: inputText,
              },
              ...nonTextParts,
            ],
          },
          { throwOnError: true },
        )
        .catch((error) => {
          toast.show({
            title: "发送提示失败",
            message: errorMessage(error),
            variant: "error",
          })
        })
      if (editorParts.length > 0) editor.markSelectionSent()
    }
    history.append({
      ...store.prompt,
      mode: currentMode,
    })
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID) {
      if (editorParts.length > 0) editor.preserveSelectionFromNewSession()
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
    }
    input.clear()
    if (finishMoveProgress) move.finishSubmit()
    return true
  }

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.cursorOffset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + promptOffsetWidth(virtualText)

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteInputText(text: string) {
    const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const pastedContent = normalizedText.trim()
    const filepath = pastedFilepath(pastedContent, terminalEnvironment.platform)
    const isUrl = /^(https?):\/\//.test(filepath)
    if (!isUrl) {
      const attachment = await readLocalAttachment(filepath)
      const filename = path.basename(filepath)
      if (attachment?.type === "text") {
        pasteText(attachment.content, `[SVG: ${filename ?? "image"}]`)
        return
      }
      if (attachment?.type === "binary") {
        await pasteAttachment({
          filename,
          filepath,
          mime: attachment.mime,
          content: Buffer.from(attachment.content).toString("base64"),
        })
        return
      }
    }

    const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
    if (
      (lineCount >= 3 || pastedContent.length > 150) &&
      kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary)
    ) {
      pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
      return
    }

    input.insertText(normalizedText)

    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      renderer.requestRender()
    }, 0)
  }

  async function pasteAttachment(file: { filename?: string; filepath?: string; content: string; mime: string }) {
    const currentOffset = input.cursorOffset
    const extmarkStart = currentOffset
    const pdf = file.mime === "application/pdf"
    const count = store.prompt.parts.filter((x) => {
      if (x.type !== "file") return false
      if (pdf) return x.mime === "application/pdf"
      return x.mime.startsWith("image/")
    }).length
    const virtualText = pdf ? `[PDF ${count + 1}]` : `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filepath ?? file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    return
  }

  function clearPrompt() {
    if (store.prompt.input.trim().length >= DRAFT_RETENTION_MIN_CHARS || store.prompt.parts.length > 0) {
      history.append({
        ...store.prompt,
        mode: store.mode,
      })
    }
    input.clear()
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
  }

  const highlight = createMemo(() => {
    if (leader()) return theme.border
    if (store.mode === "shell") return theme.primary
    const agent = local.agent.current()
    if (!agent) return theme.border
    return local.agent.color(agent.name)
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const agentMetaAlpha = createFadeIn(() => !!local.agent.current(), animationsEnabled)
  const modelMetaAlpha = createFadeIn(() => !!local.agent.current() && store.mode === "normal", animationsEnabled)
  const variantMetaAlpha = createFadeIn(
    () => !!local.agent.current() && store.mode === "normal" && showVariant(),
    animationsEnabled,
  )
  const borderHighlight = createMemo(() => tint(theme.border, highlight(), agentMetaAlpha()))

  const placeholderText = createMemo(() => {
    if (props.showPlaceholder === false) return undefined
    const shellMode = store.mode === "shell"
    return buildPlaceholder({
      prefix: shellMode ? "运行命令... " : "问我任何事... ",
      examples: shellMode ? shell() : list(),
      index: store.placeholder,
      muted: theme.textMuted,
      exampleAlpha: PLACEHOLDER_EXAMPLE_ALPHA,
    })
  })

  // crush 式工作指示:扰动字符带主题双色(primary→secondary)渐变,颜色固定,
  // 不再跟 agent 色走 —— 这是"正在干活"的全局信号,和聊天区的思考/工具指示同一套。
  const spinnerDef = createMemo(() => {
    return {
      frames: SPINNER_FRAMES,
      interval: SPINNER_INTERVAL,
      color: animGradient(theme.primary, theme.secondary),
    }
  })
  const maxHeight = createMemo(() => tuiConfig.prompt?.max_height ?? Math.max(6, Math.floor(dimensions().height / 3)))

  // 卡外状态行里那个「上下文占用 · 花费」要搬进**卡内底部行**(PromptBottomRow 的 usage 段)。
  // 折进来之后空闲时输入卡底下什么都不剩,底边直接压到屏幕底 —— 用户报的就是那条几乎全空的行。
  // shell 模式不显示:那时没有「这一轮」的 token,拿上一次会话的数字接着报是假信息。
  // 列数不够时不是让渲染器裁,而是 usageLabel 自己按档降级、末档整段不画(宁可没有,
  // 也不能显示一个被裁成「7」的假数字)。
  const usageFigure = createMemo(() => {
    const item = usage()
    if (!item || store.mode !== "normal") return undefined
    return usageLabel(item, usageRowColumns(dimensions().width)) || undefined
  })

  return (
    <>
      <box
        ref={(r: BoxRenderable) => (anchor = r)}
        visible={props.visible !== false}
        width="100%"
        flexDirection="column"
      >
        {/* 输入区霓虹输入卡:四行(输入行 / 呼吸行 / 底部行 / 提示行),聚焦时描边流动 + 扫光。
            卡壳、底部行与提示行在 ./card 里 —— 只依赖 useTheme/useKV/键位表,测试能直接挂载真壳。
            anchor 仍是这个最外层盒子:autocomplete 弹层按 anchor.x/y/width 定位到卡片上方
            (component/prompt/autocomplete.tsx 的 top = position().y − height())。

            visible 也传进卡片参与 animated:visible={false} 时这个盒子仍挂在树上,
            不掐掉定时器就会 12.5 次/秒地空 requestRender 一棵没人看的子树。

            autocomplete 弹层与卡片上边框的间距(改卡片化时实测的结论):
            弹层是 position="absolute" + top = anchor.y − 高度 + zIndex=100,anchor 就是
            这个最外层盒子,所以弹层下沿正好压在**卡片上边框那一行**上,永远不与卡片内容重叠。
            代价是原来 crush 式布局里 NeonRail 上方那 1 行视觉间隔没有了 ——
            弹层会贴上霓虹边框。要留间隔只能给 anchor 加 marginTop(整块输入区下移一行),
            代价是消息区少一行,没这么做。

            与原型 card-design-v7.html:1114-1131 的偏离(有意,用户明确要求):
            原型把模型芯片与发送按钮放在**输入行**右端,这里按用户的话「agent、模型、发送等
            这几个都显示在输入的最底下排列」改成输入行只留提示符 + 输入框,芯片与按钮搬到
            底部行右端、agent/meta 搬到底部行左端。原样画回原型那版就会被再次报成
            「字挤在一起」,所以别「修」回去。
            按钮文案用 `发送 <键>` 而不是原型的 `发送 ⏎`,理由见 card.tsx 的 PromptSend。 */}
        <PromptCard focused={promptFocused()} visible={props.visible !== false}>
          {/* 卡内第一行:只有 ">" 与输入框。这一行不混任何 meta —— 混进来就是上一版的
              「挤成一团」(用户原话:「字不要挤到一起」)。 */}
          <box width="100%" flexDirection="row" gap={1} flexShrink={0}>
            <box flexShrink={0} width={2} height={1}>
              {/* ASCII ">" 而不是 ❯:U+276F 的 East Asian Width 是 N(Neutral,不是 Ambiguous),
              所以这不是宽度问题 —— 是 Dingbats 装饰区字符,字形各家终端差异大,
              而 ASCII ">" 在哪儿都长一个样。 */}
              <text fg={props.disabled ? theme.textMuted : borderHighlight()}>{">"}</text>
            </box>
            <box flexGrow={1} flexShrink={1} minWidth={4}>
              <textarea
                width="100%"
                placeholder={placeholderText()}
                placeholderColor={theme.textMuted}
                textColor={leader() ? theme.textMuted : theme.text}
                focusedTextColor={leader() ? theme.textMuted : theme.text}
                minHeight={1}
                maxHeight={maxHeight()}
                onContentChange={() => {
                  const value = input.plainText
                  setStore("prompt", "input", value)
                  auto()?.onInput(value)
                  syncExtmarksWithPromptParts()
                  setCursorVersion((value) => value + 1)
                }}
                onCursorChange={() => setCursorVersion((value) => value + 1)}
                onKeyDown={(e: { preventDefault(): void }) => {
                  if (props.disabled) {
                    e.preventDefault()
                    return
                  }
                }}
                onSubmit={() => {
                  // IME: double-defer so the last composed character (e.g. Korean
                  // hangul) is flushed to plainText before we read it for submission.
                  setTimeout(() => setTimeout(() => submit(), 0), 0)
                }}
                onPaste={async (event: PasteEvent) => {
                  if (props.disabled) {
                    event.preventDefault()
                    return
                  }

                  // Normalize line endings at the boundary
                  // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
                  // Replace CRLF first, then any remaining CR
                  const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                  const pastedContent = normalizedText.trim()

                  // Windows Terminal <1.25 can surface image-only clipboard as an
                  // empty bracketed paste. Windows Terminal 1.25+ does not.
                  if (!pastedContent) {
                    keymap.dispatchCommand("prompt.paste")
                    return
                  }

                  // Once we cross an async boundary below, the terminal may perform its
                  // default paste unless we suppress it first and handle insertion ourselves.
                  event.preventDefault()

                  await pasteInputText(normalizedText)
                }}
                ref={(r: TextareaRenderable) => {
                  input = r
                  Object.assign(r, {
                    getClipboardText: (text: string) => expandPastedTextPlaceholders(text, store.prompt.parts),
                  })
                  setInputTarget(r)
                  if (promptPartTypeId === 0) {
                    promptPartTypeId = input.extmarks.registerType("prompt-part")
                  }
                  props.ref?.(ref)
                  setTimeout(() => {
                    // setTimeout is a workaround and needs to be addressed properly
                    if (!input || input.isDestroyed) return
                    input.cursorColor = theme.text
                    if (tuiConfig.cursor) input.cursorStyle = tuiConfig.cursor
                  }, 0)
                }}
                onMouseDown={(r: MouseEvent) => r.target?.focus()}
                on:focused={() => setPromptFocused(true)}
                on:blurred={() => setPromptFocused(false)}
                cursorColor={props.disabled ? theme.backgroundElement : theme.text}
                cursorStyle={tuiConfig.cursor}
                syntaxStyle={syntax()}
              />
            </box>
          </box>
          {/* 卡内第二行:呼吸行。
              用一个 height={1} 的空盒,而不是给底部行加 marginTop / 给两行加 gap ——
              padding 格已经被边框吃掉(见 card.tsx 的 PromptCard),padding 给不出行间空隙;
              gap 则要为了它把卡片的所有子节点再套一层列盒(多一个盒子、多一道宽度约束),
              而一个显式的 height={1} 就是**一行真实布局高度**:行数可数、可测,调用方想
              去掉呼吸只要不渲染它。flexShrink={0} 是为了终端压扁时这一行不被收掉。 */}
          <box height={1} flexShrink={0} />
          {/* 卡内第三行:底部行。左 = 插件槽 + agent/权限/提供商/变体 meta(可截断),
              右 = 模型芯片 + 发送按钮(不截断)。meta 里每一段都 wrapMode="none" +
              flexShrink={0}:少了前者会被软折行顶高一倍,少了后者会被 yoga 按内容宽度压、
              同一段文字折成好几行。两个都固定住之后,整段保持自然宽,由 PromptBottomRow 里
              minWidth=0 + overflow hidden 的盒子从右边裁掉。 */}
          <PromptBottomRow
            right={props.right}
            usage={
              usageFigure() ? (
                <text fg={theme.textMuted} wrapMode="none">
                  {usageFigure()}
                </text>
              ) : undefined
            }
            trailing={
              <PromptSend
                model={store.mode === "normal" ? local.model.parsed().model : ""}
                canSend={canSend()}
                // 模型名颜色与 meta 里的 provider / variant 共用同一个表达式:
                // modelMetaAlpha 是挂载淡入,leader() 是键序在等下一个键时压暗一档 ——
                // 芯片化之后这两档不能丢,否则模型名会在挂载瞬间「啪」地出现。
                modelColor={fadeColor(leader() ? theme.textMuted : theme.text, modelMetaAlpha())}
                onSend={() => void submit()}
              />
            }
            meta={
              <box flexDirection="row" gap={1}>
                <Show when={local.agent.current()} fallback={<box height={1} />}>
                  {(agent) => (
                    <>
                      <text flexShrink={0} fg={fadeColor(highlight(), agentMetaAlpha())} wrapMode="none">
                        {store.mode === "shell" ? "Shell" : agentDisplayName(agent().name, agent().options)}
                      </text>
                      <Show when={store.mode === "normal" && local.permission.mode === "auto"}>
                        <text flexShrink={0} fg={fadeColor(theme.textMuted, agentMetaAlpha())} wrapMode="none">
                          auto
                        </text>
                      </Show>
                      <Show when={store.mode === "normal"}>
                        <box flexDirection="row" gap={1}>
                          <text flexShrink={0} fg={fadeColor(theme.textMuted, modelMetaAlpha())} wrapMode="none">
                            ·
                          </text>
                          <text flexShrink={0} fg={fadeColor(theme.textMuted, modelMetaAlpha())} wrapMode="none">
                            {currentProviderLabel()}
                          </text>
                          <Show when={showVariant()}>
                            <text flexShrink={0} fg={fadeColor(theme.textMuted, variantMetaAlpha())} wrapMode="none">
                              ·
                            </text>
                            <text flexShrink={0} wrapMode="none">
                              <span style={{ fg: fadeColor(theme.warning, variantMetaAlpha()), bold: true }}>
                                {local.model.variant.current()}
                              </span>
                            </text>
                          </Show>
                        </box>
                      </Show>
                    </>
                  )}
                </Show>
              </box>
            }
          />
          {/* 卡内第四行:键位提示(左对齐)。提交键不在这里 —— 它跟着底部行的发送按钮走。 */}
          <PromptHints shell={store.mode === "shell"} />
        </PromptCard>
        {/* 状态行留在卡外:工作指示 / retry / 工作区提示 / 编辑器文件标签都属于「这次会话」,
            不属于输入卡。**目录不在这一行** —— 它由会话页底栏(routes/session/footer.tsx)
            独家显示,理由见下面 Match when={true} 那条。

            **token 花费也已经搬走了**(折进卡内底部行的 usage 段,见上面 usageFigure):
            空闲时这一行别的什么都不剩,留着它就是一条几乎全空的行 —— 80 列里只有右端 5 列
            有字,用户读到的「输入卡下面空了一行」就是它。整行的显隐由 statusRowVisible 判,
            逐条对应下面这个 Switch 的分支。

            flexShrink={0} 是补的 —— 原来这里没钉,长 retry 文案(「retrying in … attempt #3」)
            会把上面的输入卡挤扁。 */}
        <Show when={statusRowVisible()}>
          <box width="100%" flexDirection="row" justifyContent="space-between" flexShrink={0}>
            <Switch>
              <Match when={status().type !== "idle"}>
                <box
                  flexDirection="row"
                  gap={1}
                  flexGrow={1}
                  justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
                >
                  <box flexShrink={0} flexDirection="row" gap={1}>
                    <box marginLeft={1}>
                      <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[--]</text>}>
                        <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                      </Show>
                    </box>
                    <box flexDirection="row" gap={1} flexShrink={0}>
                      {(() => {
                        const retry = createMemo(() => {
                          const s = status()
                          if (s.type !== "retry") return
                          return s
                        })
                        const message = createMemo(() => {
                          const r = retry()
                          if (!r) return
                          if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                            return "gemini is way too hot right now"
                          if (r.message.length > 80) return r.message.slice(0, 80) + "..."
                          return r.message
                        })
                        const isTruncated = createMemo(() => {
                          const r = retry()
                          if (!r) return false
                          return r.message.length > 120
                        })
                        const [seconds, setSeconds] = createSignal(0)
                        onMount(() => {
                          const timer = setInterval(() => {
                            const next = retry()?.next
                            if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                          }, 1000)

                          onCleanup(() => {
                            clearInterval(timer)
                          })
                        })
                        const handleMessageClick = () => {
                          const r = retry()
                          if (!r) return
                          if (isTruncated()) {
                            void DialogAlert.show(dialog, "Retry Error", r.message)
                          }
                        }

                        const retryText = () => {
                          const r = retry()
                          if (!r) return ""
                          const baseMessage = message()
                          const truncatedHint = isTruncated() ? " (click to expand)" : ""
                          const duration = formatDuration(seconds())
                          const retryInfo = ` [retrying ${duration ? `in ${duration} ` : ""}attempt #${r.attempt}]`
                          return baseMessage + truncatedHint + retryInfo
                        }

                        return (
                          <Show when={retry()}>
                            <box onMouseUp={handleMessageClick}>
                              <text fg={theme.error}>{retryText()}</text>
                            </box>
                          </Show>
                        )
                      })()}
                    </box>
                  </box>
                  <text fg={store.interrupt > 0 ? theme.primary : theme.text}>
                    esc{" "}
                    <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                      {store.interrupt > 0 ? "再次中断" : "中断"}
                    </span>
                  </text>
                </box>
              </Match>
              <Match when={workspace.notice()}>
                {(notice) => (
                  <box paddingLeft={3}>
                    <text fg={theme.accent}>{notice()}</text>
                  </box>
                )}
              </Match>
              <Match when={workspace.label()}>
                {(label) => (
                  <box paddingLeft={3} flexDirection="row" gap={1}>
                    <Show when={workspace.creating()}>
                      <Spinner color={theme.accent} />
                    </Show>
                    <text fg={workspace.creating() ? theme.accent : theme.text}>
                      {(() => {
                        const item = label()
                        if (item.type === "new") {
                          if (workspace.creating())
                            return `Creating ${item.workspaceType}${".".repeat(workspace.creatingDots())}`
                          return (
                            <>
                              Workspace <span style={{ fg: theme.textMuted }}>(new {item.workspaceType})</span>
                            </>
                          )
                        }
                        return (
                          <>
                            Workspace <span style={{ fg: theme.textMuted }}>{item.workspaceName}</span>
                          </>
                        )
                      })()}
                    </text>
                  </box>
                )}
              </Match>
              <Match when={move.progress()}>
                {(progress) => (
                  <box paddingLeft={3}>
                    <Spinner color={theme.accent}>
                      {progress()}
                      <span style={{ fg: theme.textMuted }}>{".".repeat(move.creatingDots())}</span>
                    </Spinner>
                  </box>
                )}
              </Match>
              <Match when={move.pendingNew()}>
                <box paddingLeft={3}>
                  <text fg={theme.accent}>(new working copy)</text>
                </box>
              </Match>
              <Match when={true}>
                {/* 空闲时的左半边。**这里原来印的是 `location()?.directory ?? paths.cwd`,
                  现在不印了** —— 那一行与会话页底栏(path.get().directory)显示的是同一个
                  目录,屏幕底部于是上下叠着两条一模一样的路径(用户报的就是这个重复)。

                  为什么两个值必然相同(不是「多半相同」):
                  服务端 `Session.createNext` 只接受调用方传的 directory,而它的两个调用方
                  (`Session.create` / `Session.fork`)都传 `InstanceState.context.directory`;
                  `path.get` 返回的 `directory` 也正是 `InstanceState.context.directory`
                  (packages/novaway/src/server/routes/instance/httpapi/handlers/instance.ts:36)。
                  也就是说会话的 directory 按构造就等于实例目录 —— API schema 里那个
                  `CreateInput.directory` 被 `Session.create` 忽略,任何会话都建不出第二个目录。
                  底栏那一份还多做了 `abbreviateHome`,所以它才是该留的那一份。

                  留一个弹性空盒而不是干脆什么都不渲染:外层是 justifyContent="space-between",
                  左半边一旦消失,右端的编辑器文件标签会跳到屏幕左边。
                  首页那条 `props.hint` 是调用方自己给的(routes/home 传的是**目标**目录,
                  与底栏那一份不是同一个语义),不动。 */}
                {props.hint ?? <box flexGrow={1} minWidth={0} />}
              </Match>
            </Switch>
            <Show when={status().type !== "retry"}>
              {/* 右半边现在只剩编辑器文件标签 —— token/花费折进了卡内底部行(见 usageFigure)。
                键位提示也在那边:tab agents / ctrl+p commands / esc exit shell mode 搬进了
                输入卡的提示行,所以这里只留「不是键位」的状态。 */}
              <box gap={2} flexDirection="row" flexShrink={0}>
                <Show when={editorContextLabelState() !== "none" ? editorFileLabelDisplay() : undefined}>
                  {(file) => (
                    <text fg={editorContextLabelState() === "pending" ? theme.secondary : theme.textMuted}>
                      {file()}
                    </text>
                  )}
                </Show>
              </box>
            </Show>
          </box>
        </Show>
      </box>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => {
          setAuto(() => r)
        }}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
    </>
  )
}
