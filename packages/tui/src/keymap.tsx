import { InputRenderable, TextareaRenderable, type CliRenderer, type KeyEvent, type Renderable } from "@opentui/core"
import {
  registerBackspacePopsPendingSequence,
  registerBaseLayoutFallback,
  registerCommaBindings,
  registerEscapeClearsPendingSequence,
  registerManagedTextareaLayer,
  registerTimedLeader,
} from "@opentui/keymap/addons/opentui"
import { stringifyKeyStroke, type Binding } from "@opentui/keymap"
import {
  formatCommandBindings as formatCommandBindingsExtra,
  formatKeySequence as formatKeySequenceExtra,
} from "@opentui/keymap/extras"
import { KeymapProvider, useKeymap, useKeymapSelector, useBindings } from "@opentui/keymap/solid"
import { createMemo, type Accessor } from "solid-js"
import { useTuiConfig } from "./config"
import { TuiKeybind } from "./config/keybind"

export const LEADER_TOKEN = "leader"
export const NovaWay_BASE_MODE = "base"
export const COMMAND_PALETTE_COMMAND = "command.palette.show"

const NovaWay_MODE_KEY = "NovaWay.mode"

export const NovaWayKeymapProvider = KeymapProvider
export const useNovaWayKeymap = useKeymap

export { useBindings, useKeymapSelector }

export type OpenTuiKeymap = ReturnType<typeof useKeymap>
type NovaWayModeStack = ReturnType<typeof createNovaWayModeStack>
type CommandSlashEntry = {
  display: string
  description?: string
  aliases?: string[]
  order?: number
  onSelect: () => void
}
type Command = ReturnType<OpenTuiKeymap["getCommands"]>[number]
type BindingLookup = {
  get(command: string): readonly Binding<Renderable, KeyEvent>[]
  gather(name: string, commands: readonly string[]): readonly Binding<Renderable, KeyEvent>[]
}
type FormatConfig = { keybinds: BindingLookup }
type ResolvedKeymapConfig = FormatConfig & { leader_timeout: number }

const modeStacks = new WeakMap<OpenTuiKeymap, NovaWayModeStack>()

function isVisiblePaletteCommand(command: Command) {
  return command.hidden !== true && command.name !== COMMAND_PALETTE_COMMAND
}

export function createNovaWayModeStack(keymap: OpenTuiKeymap) {
  keymap.setData(NovaWay_MODE_KEY, NovaWay_BASE_MODE)

  const offFields = keymap.registerLayerFields({
    mode(value, ctx) {
      ctx.require(NovaWay_MODE_KEY, value)
    },
  })

  const stack: { id: symbol; mode: string }[] = []
  let disposed = false

  const update = () => {
    keymap.setData(NovaWay_MODE_KEY, stack.at(-1)?.mode ?? NovaWay_BASE_MODE)
  }

  const stackApi = {
    current() {
      return stack.at(-1)?.mode ?? NovaWay_BASE_MODE
    },
    push(mode: string) {
      if (disposed) return () => {}
      const id = Symbol(mode)
      let active = true
      stack.push({ id, mode })
      update()

      return () => {
        if (!active) return
        active = false
        const index = stack.findIndex((item) => item.id === id)
        if (index !== -1) stack.splice(index, 1)
        update()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stack.length = 0
      offFields()
      keymap.setData(NovaWay_MODE_KEY, undefined)
      modeStacks.delete(keymap)
    },
  }

  modeStacks.set(keymap, stackApi)
  return stackApi
}

export function useNovaWayModeStack() {
  return getNovaWayModeStack(useNovaWayKeymap())
}

export function getNovaWayModeStack(keymap: OpenTuiKeymap) {
  const value = modeStacks.get(keymap)
  if (!value) throw new Error("NovaWay mode stack is not registered for this keymap")
  return value
}

const KEY_ALIASES = {
  enter: "return",
  esc: "escape",
  pgdown: "pagedown",
  pgup: "pageup",
} as const

function expandKeyAliases(input: string) {
  const result = Object.entries(KEY_ALIASES).reduce(
    (acc, [alias, key]) => acc.replace(new RegExp(`(^|[+,\\s>])${alias}(?=$|[+,\\s<])`, "gi"), `$1${key}`),
    input,
  )
  if (result === input) return
  return result
}

function registerKeyAliases(keymap: OpenTuiKeymap) {
  return keymap.appendBindingExpander((ctx) => {
    const key = expandKeyAliases(ctx.input)
    if (!key) return
    return [{ key, displays: ctx.displays }]
  })
}

const inputCommands = [
  "input.move.left",
  "input.move.right",
  "input.move.up",
  "input.move.down",
  "input.select.left",
  "input.select.right",
  "input.select.up",
  "input.select.down",
  "input.line.home",
  "input.line.end",
  "input.select.line.home",
  "input.select.line.end",
  "input.visual.line.home",
  "input.visual.line.end",
  "input.select.visual.line.home",
  "input.select.visual.line.end",
  "input.buffer.home",
  "input.buffer.end",
  "input.select.buffer.home",
  "input.select.buffer.end",
  "input.delete.line",
  "input.delete.to.line.end",
  "input.delete.to.line.start",
  "input.backspace",
  "input.delete",
  "input.newline",
  "input.undo",
  "input.redo",
  "input.word.forward",
  "input.word.backward",
  "input.select.word.forward",
  "input.select.word.backward",
  "input.delete.word.forward",
  "input.delete.word.backward",
  "input.select.all",
  "input.submit",
] as const

function hasManagedTextareaFocus(renderer: CliRenderer) {
  const editor = renderer.currentFocusedEditor
  return editor instanceof TextareaRenderable && !(editor instanceof InputRenderable)
}

function leaderDisplay(config: FormatConfig) {
  const key = config.keybinds.get(LEADER_TOKEN)?.[0]?.key
  if (!key) return TuiKeybind.LeaderDefault
  return typeof key === "string" ? key : stringifyKeyStroke(key)
}

function leaderKey(config: FormatConfig) {
  return config.keybinds.get(LEADER_TOKEN)?.[0]?.key
}

function formatOptions(config: FormatConfig) {
  return {
    tokenDisplay: {
      [LEADER_TOKEN]: leaderDisplay(config),
    },
    keyNameAliases: {
      pageup: "pgup",
      pagedown: "pgdn",
      delete: "del",
    },
    modifierAliases: {
      meta: "alt",
    },
  } as const
}

export function formatKeySequence(parts: Parameters<typeof formatKeySequenceExtra>[0], config: FormatConfig) {
  return formatKeySequenceExtra(parts, formatOptions(config))
}

export function formatKeyBindings(bindings: Parameters<typeof formatCommandBindingsExtra>[0], config: FormatConfig) {
  return formatCommandBindingsExtra(bindings, formatOptions(config))
}

export function registerNovaWayKeymap(keymap: OpenTuiKeymap, renderer: CliRenderer, config: ResolvedKeymapConfig) {
  const modeStack = createNovaWayModeStack(keymap)
  const offCommaBindings = registerCommaBindings(keymap)
  const offAliasExpander = registerKeyAliases(keymap)
  const offBaseLayout = registerBaseLayoutFallback(keymap)
  const leader = leaderKey(config)
  const offLeader = leader
    ? registerTimedLeader(keymap, {
        trigger: leader,
        name: LEADER_TOKEN,
        timeoutMs: config.leader_timeout,
      })
    : () => {}
  const offEscape = registerEscapeClearsPendingSequence(keymap)
  const offBackspace = registerBackspacePopsPendingSequence(keymap)
  const offInputBindings = registerManagedTextareaLayer(keymap, renderer, {
    enabled: () => hasManagedTextareaFocus(renderer),
    bindings: config.keybinds.gather("input", inputCommands),
  })

  return () => {
    offInputBindings()
    offBackspace()
    offEscape()
    offLeader()
    offAliasExpander()
    offBaseLayout()
    offCommaBindings()
    modeStack.dispose()
  }
}

export function useLeaderActive(): Accessor<boolean> {
  return useKeymapSelector((keymap: OpenTuiKeymap) => keymap.getPendingSequence()[0]?.tokenName === LEADER_TOKEN)
}

export function useCommandShortcut(command: string): Accessor<string> {
  const config = useTuiConfig()
  return useKeymapSelector((keymap: OpenTuiKeymap) =>
    formatKeySequence(
      keymap.getCommandBindings({ visibility: "registered", commands: [command] }).get(command)?.[0]?.sequence,
      config,
    ),
  )
}

// 斜杠命令的中文显示名。命中的命令在斜杠面板显示为 /中文,英文原名保留为别名(仍可 /english 输入)。
// 想改某条中文名或新增别名,改这里对应一行即可。
export const SLASH_ZH: Record<string, string[]> = {
  sessions: ["会话记录", "会话"],
  new: ["新会话"],
  workspaces: ["工作区"],
  models: ["模型"],
  agents: ["智能体"],
  "background-subagents": ["后台并行子代理", "后台并行", "后台子代理", "并行"],
  mcps: ["MCP服务"],
  variants: ["变体"],
  connect: ["连接"],
  org: ["组织"],
  status: ["状态"],
  debug: ["调试"],
  themes: ["主题"],
  help: ["帮助"],
  exit: ["退出"],
  share: ["分享"],
  rename: ["重命名"],
  timeline: ["时间线"],
  fork: ["分叉"],
  compact: ["压缩"],
  unshare: ["取消分享"],
  undo: ["撤销"],
  redo: ["重做"],
  timestamps: ["时间戳"],
  thinking: ["思考"],
  copy: ["复制"],
  export: ["导出"],
  memory: ["记忆"],
  evolution: ["进化"],
  icon: ["图标"],
  editor: ["编辑器"],
  skills: ["技能"],
  diff: ["差异"],
  warp: ["传送"],
  move: ["移动会话"],
  review: ["审查"],
  init: ["初始化"],
  fetch: ["抓取"],
}

// 斜杠命令的中文说明。服务端内置命令(init/review)和第三方 MCP 提示词的 description 常常是英文,
// 斜杠面板会直接照搬,于是出现"/初始化  guided AGENTS.md setup"这种中英混排。
// 这里按命令名覆盖成中文;命令名在 sync.data.command 里是什么就写什么,没列出的沿用原始 description。
export const SLASH_DESC_ZH: Record<string, string> = {
  init: "引导生成 AGENTS.md 项目说明",
  review: "审查代码改动 [提交|分支|PR],默认审查未提交的改动",
  fetch: "抓取网页内容并转成 Markdown",
  fetch_url: "抓取网页内容并转成 Markdown",
}

// 斜杠面板的优先级排序:靠前的先显示。未列出的排在最后并按名称字母序。
const SLASH_PRIORITY = [
  "agents",
  "models",
  "connect",
  "skills",
  "sessions",
  "new",
  "workspaces",
  "background-subagents",
  "variants",
  "memory",
  "evolution",
  "icon",
  "themes",
  "compact",
  "fork",
  "timeline",
  "rename",
  "share",
  "unshare",
  "undo",
  "redo",
  "copy",
  "export",
  "init",
  "review",
  "fetch",
  "editor",
  "move",
  "warp",
  "timestamps",
  "thinking",
  "diff",
  "mcps",
  "org",
  "status",
  "debug",
  "help",
  "exit",
]
export const SLASH_ORDER: Record<string, number> = Object.fromEntries(SLASH_PRIORITY.map((name, i) => [name, i]))

export function useCommandSlashes(): Accessor<readonly CommandSlashEntry[]> {
  const keymap = useNovaWayKeymap()
  const entries = useKeymapSelector((keymap: OpenTuiKeymap) =>
    keymap.getCommandEntries({
      visibility: "reachable",
      namespace: "palette",
      filter: isVisiblePaletteCommand,
    }),
  )

  return createMemo<CommandSlashEntry[]>(() =>
    entries().flatMap((entry) => {
      const slashName = entry.command.slashName
      if (typeof slashName !== "string" || !slashName) return []
      const slashAliases = entry.command.slashAliases
      // 中文优先展示;英文原名与其它别名一并保留为可输入别名。
      const zh = SLASH_ZH[slashName]
      const primary = zh?.[0]
      const display = primary ? `/${primary}` : `/${slashName}`
      const aliasSet = new Set<string>()
      if (primary) aliasSet.add(`/${slashName}`)
      if (zh) for (const z of zh.slice(1)) aliasSet.add(`/${z}`)
      if (Array.isArray(slashAliases))
        for (const a of slashAliases) if (typeof a === "string") aliasSet.add(`/${a}`)
      aliasSet.delete(display)
      return {
        display,
        description:
          SLASH_DESC_ZH[slashName] ??
          (typeof entry.command.desc === "string"
            ? entry.command.desc
            : typeof entry.command.title === "string"
              ? entry.command.title
              : undefined),
        aliases: aliasSet.size ? [...aliasSet] : undefined,
        order: SLASH_ORDER[slashName],
        onSelect: () => keymap.dispatchCommand(entry.command.name),
      }
    }),
  )
}
