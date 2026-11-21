import { createStore, produce } from "solid-js/store"
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import { createSimpleContext } from "@novaway/ui/context"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useGlobalSync } from "./global-sync"
import { useGlobalSDK } from "./global-sdk"
import { useServer } from "./server"
import { usePlatform } from "./platform"
import { Project } from "@novaway/sdk/v2"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { decode64 } from "@/utils/base64"
import { same } from "@/utils/same"
import { createScrollPersistence, type SessionScroll } from "./layout-scroll"
import { createPathHelpers } from "./file/path"
import { pathKey } from "@/utils/path-key"

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const
// 侧栏宽度规格：default = min = 264px，max 为容器 50%，键盘步进 16px。
const DEFAULT_SIDEBAR_WIDTH = 264
const DEFAULT_SESSION_WIDTH = 600
const DEFAULT_TERMINAL_HEIGHT = 280
const DEFAULT_SIDE_PANE_WIDTH = 360
export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number]
export type AppMode = string

export type AppModeConfig = {
  id: AppMode
  name: string
  shortName: string
  icon: string
  description: string
  color: string
  foreground: string
  /** Plugin-declared group used by the host's optional productized UI. */
  group?: string
}

/**
 * 只有宿主内核模式固定存在；所有产品化工作台都由已激活插件的 Agent
 * `options.workbench` 元数据动态提供。这里不能放 Zen、办公、短剧等模式，
 * 否则卸载插件后它们仍会被宿主重新创建。
 */
export const APP_MODES: AppModeConfig[] = [
  {
    id: "forge",
    name: "Creova",
    shortName: "Creova",
    icon: "N",
    description: "NovaWay 通用工作模式，可使用已启用的工作台、智能体与技能。",
    color: "var(--app-mode-forge)",
    foreground: "var(--app-mode-forge-foreground)",
  },
]

export const appModeConfig = (mode: AppMode | undefined | null) => APP_MODES.find((item) => item.id === mode)

/** 通过插件声明的 group 判断产品化 UI，不依赖某个固定模式 id。 */
export function appModeIsGroup(mode: AppMode | undefined | null, group: string, modes: readonly AppModeConfig[]) {
  return Boolean(mode && modes.find((item) => item.id === mode)?.group === group)
}

type WorkbenchAgent = {
  mode?: string
  hidden?: boolean
  options?: Record<string, unknown>
}

function textOption(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/** 从插件 Agent 的 options 中读取工作台元数据。没有显式 id 时，使用插件声明的 modeGroup；宿主不再把 office 映射成 Zen。 */
export function workbenchModeFromAgent(agent: WorkbenchAgent): AppModeConfig | undefined {
  if (agent.mode === "subagent" || agent.hidden || !agent.options) return undefined
  const group = textOption(agent.options.modeGroup)
  if (!group || group === "forge") return undefined
  const raw = agent.options.workbench
  const workbench = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const id = textOption(workbench.id) ?? group
  if (!id || id === "forge" || RETIRED_APP_MODES.has(id)) return undefined

  return {
    id,
    group,
    name: textOption(workbench.name) ?? id,
    shortName: textOption(workbench.shortName) ?? id,
    icon: textOption(workbench.icon) ?? "W",
    description: textOption(workbench.description) ?? `${id} 工作台。`,
    color: textOption(workbench.color) ?? "var(--app-mode-workbench, var(--app-mode-forge))",
    foreground:
      textOption(workbench.foreground) ?? "var(--app-mode-workbench-foreground, var(--app-mode-forge-foreground))",
  }
}

/**
 * 曾经存在、后已下线的模式。
 *
 * "pulse"（运营）改为图标条常驻入口；"spark"（创意）、"future"（探索）整体下线。
 * 持久化里残留的这些 id 必须在迁移时清掉 ——
 * 否则侧栏读到的 current 是个未知模式，模式开关会显示成未选择的占位、项目过滤也全部失效。
 */
const RETIRED_APP_MODES = new Set(["pulse", "spark", "future"])

export function getAvatarColors(key?: string) {
  if (key && AVATAR_COLOR_KEYS.includes(key as AvatarColorKey)) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface)",
    foreground: "var(--foreground)",
  }
}

type SessionTabs = {
  active?: string
  all: string[]
}

type SessionView = {
  scroll: Record<string, SessionScroll>
  reviewOpen?: string[]
  pendingMessage?: string
  pendingMessageAt?: number
  todoHeight?: number
}

type TabHandoff = {
  dir: string
  id: string
  at: number
}

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export type ReviewDiffStyle = "unified" | "split"

/**
 * Side Pane 的标签 id。
 *
 * 内置的是 `preview` / `review` / `terminal`；动态的（见 SidePaneSessionTab）
 * 是 `subagent:<sessionID>` / `sideChat:<sessionID>` 这样的字符串。
 * 历史实现把三个内置值写成字面量联合，加了动态标签之后会到处需要窄化，
 * 所以这里收敛成 `string` —— 合法性由 `isSidePaneTab` 裁决（它会查动态表）。
 */
export type SidePaneTab = string
export type SidebarView = "tasks" | "tree"

/** 侧栏任务列表的视图偏好（「视图」菜单的四项）。 */
export type TaskGroupBy = "workspace" | "date" | "custom" | "none"
export type TaskSortBy = "recent" | "created" | "name"
export type TaskRecency = "all" | "today" | "week" | "month"

/** 自定义分组的一个组；`id` 稳定，改名不动归属。 */
export type TaskGroup = { id: string; name: string }

export const DEFAULT_TASK_LIST_VIEW = {
  groupBy: "workspace" as TaskGroupBy,
  sortBy: "recent" as TaskSortBy,
  /** pathKey(worktree)，"all" = 不按工作区筛。 */
  workspace: "all",
  recency: "all" as TaskRecency,
}

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  touch(key)
  seed(key)
  return key
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => void) {
  const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
  return () => {
    const value = key()
    ensure(value)
    return value
  }
}

export function pruneSessionKeys(input: {
  keep?: string
  max: number
  used: Map<string, number>
  view: string[]
  tabs: string[]
}) {
  if (!input.keep) return []

  const keys = new Set<string>([...input.view, ...input.tabs])
  if (keys.size <= input.max) return []

  const score = (key: string) => {
    if (key === input.keep) return Number.MAX_SAFE_INTEGER
    return input.used.get(key) ?? 0
  }

  return Array.from(keys)
    .sort((a, b) => score(b) - score(a))
    .slice(input.max)
}

function nextSessionTabsForOpen(current: SessionTabs | undefined, tab: string): SessionTabs {
  const all = current?.all ?? []
  if (tab === "review") return { all: all.filter((x) => x !== "review"), active: tab }
  if (tab === "context") return { all: [tab, ...all.filter((x) => x !== tab)], active: tab }
  if (!all.includes(tab)) return { all: [...all, tab], active: tab }
  return { all, active: tab }
}

const sessionPath = (key: string) => {
  const dir = key.split("/")[0]
  if (!dir) return
  const root = decode64(dir)
  if (!root) return
  return createPathHelpers(() => root)
}

const normalizeSessionTab = (path: ReturnType<typeof createPathHelpers> | undefined, tab: string) => {
  if (!tab.startsWith("file://")) return tab
  if (!path) return tab
  return path.tab(tab)
}

const normalizeSessionTabList = (path: ReturnType<typeof createPathHelpers> | undefined, all: string[]) => {
  const seen = new Set<string>()
  return all.flatMap((tab) => {
    const value = normalizeSessionTab(path, tab)
    if (seen.has(value)) return []
    seen.add(value)
    return [value]
  })
}

const normalizeStoredSessionTabs = (key: string, tabs: SessionTabs) => {
  const path = sessionPath(key)
  return {
    all: normalizeSessionTabList(path, tabs.all),
    active: tabs.active ? normalizeSessionTab(path, tabs.active) : tabs.active,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** 项目列表对象的逐字段内容比较（数组 / 对象按 JSON 值比较，不做引用比较）。 */
function sameProjectContent(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const left = a[key]
    const right = b[key]
    if (left === right) continue
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false
    if (JSON.stringify(left) !== JSON.stringify(right)) return false
  }
  return true
}

export type SidePaneState = {
  opened: boolean
  tabs: SidePaneTab[]
  activeTab: SidePaneTab | null
  /** 动态标签的元数据，键 = 标签 id（见 SidePaneSessionTab）。 */
  dynamic: Record<string, SidePaneSessionTab>
  /** 分屏：有值时内容区拆成主 + 次两栏。 */
  secondary?: SidePaneSecondary
  /**
   * 「工作区文件」面板内嵌的文件树右栏是否展开（可折叠树）。
   * 可选：旧持久化数据没有这个键，按收起处理。
   */
  tree?: boolean
  /** 内嵌文件树的宽度（像素）；旧数据没有这个键时用默认值。 */
  treeWidth?: number
}

/** 分屏方向：左右并排或上下排列。 */
export type SidePaneSplitAxis = "right" | "below"

export type SidePaneSecondary = {
  /** 次要窗格显示的标签（文件标签 id 或内置标签）。 */
  tab: SidePaneTab
  axis: SidePaneSplitAxis
  /** 主窗格占比，0.15–0.85。 */
  ratio: number
}

export type SidePaneAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "add"; tab: SidePaneTab }
  | { type: "remove"; tab: SidePaneTab }
  | { type: "setActive"; tab: SidePaneTab }
  | { type: "move"; from: number; to: number }
  | { type: "addSession"; tab: SidePaneSessionTab }
  | { type: "removeSession"; id: string }
  | { type: "openSecondary"; tab: SidePaneTab; axis: SidePaneSplitAxis }
  | { type: "closeSecondary" }
  | { type: "setSecondaryRatio"; ratio: number }
  | { type: "setTree"; value: boolean }

export const DEFAULT_SIDE_PANE_STATE: SidePaneState = {
  opened: true,
  tabs: [],
  activeTab: null,
  dynamic: {},
  tree: false,
}

/** 内嵌文件树的宽度约束：太窄放不下文件名，太宽会把内容区挤没。 */
export const SIDE_PANE_TREE_MIN_WIDTH = 180
export const SIDE_PANE_TREE_MAX_WIDTH = 480
export const DEFAULT_SIDE_PANE_TREE_WIDTH = 260

// 网页预览（浏览器）、工作区文件与 Office 文件是并列的内置标签。
export const SIDE_PANE_TABS = ["preview", "office", "browser", "terminal", "review"] as const

/**
 * Side Pane 的动态标签：一个标签对应一个**会话**（`background` 例外——它对应
 * 一个后台任务的输出视图，挂在发起会话下面）。
 *
 * 一个可辨识联合，三种标签：
 *
 * - `subagent` —— 从工具行的子代理摘要点进来的子会话
 * - `sideChat` —— 侧边对话：独立小会话，继承主对话上下文但**不写入主对话历史**
 * - `background` —— 后台任务输出：任务 id 编在标签 id 里
 *
 * 生命周期上子代理/侧边对话都是「跟着父会话走」：父会话结束或标签关闭时，服务端的会话一起关掉。
 */
export type SidePaneSessionTab = {
  id: string
  kind: "subagent" | "sideChat" | "background"
  sessionID: string
  /** 父会话 id：侧边对话/子代理都挂在它下面（清理与"回到主线"要用）。 */
  parentID: string
  title: string
  /** kind = "background" 时：要展示输出的后台任务 id。 */
  jobID?: string
}

export const sidePaneSubagentTabId = (sessionID: string) => `subagent:${sessionID}`
export const sidePaneSideChatTabId = (sessionID: string) => `sideChat:${sessionID}`
/** 后台任务输出标签：任务 id 全局唯一，直接编进标签 id（重复打开只聚焦已有的）。 */
export const sidePaneBackgroundTabId = (jobID: string) => `background:${jobID}`

const isSidePaneBuiltinTab = (value: unknown): value is SidePaneTab =>
  typeof value === "string" && (SIDE_PANE_TABS as readonly string[]).includes(value)

/** 内置标签**或**已知的动态标签都算合法；动态标签要在 `dynamic` 里查得到才算数。 */
export const isSidePaneTab = (value: unknown, dynamic?: Record<string, SidePaneSessionTab>): value is SidePaneTab =>
  typeof value === "string" && (isSidePaneBuiltinTab(value) || !!dynamic?.[value])

/** 旧单值 tab → 新模型；被移除的 tab 映射到承接它的那个，无法识别的值回落为 undefined（空态）。 */
const migrateLegacySidePaneTab = (value: unknown): SidePaneTab | undefined => {
  if (value === "files") return "review"
  if (value === "git" || value === "context") return "preview"
  return isSidePaneTab(value) ? value : undefined
}

export function migrateLayoutStore(value: unknown) {
  if (!isRecord(value)) return value

  const sidebar = value.sidebar
  const migratedSidebar = (() => {
    if (!isRecord(sidebar)) return sidebar
    const base =
      typeof sidebar.workspaces === "boolean"
        ? {
            ...sidebar,
            workspaces: {},
            workspacesDefault: sidebar.workspaces,
          }
        : sidebar
    if (base.defaultCollapsedV1 === true) return base
    return {
      ...base,
      opened: false,
      defaultCollapsedV1: true,
    }
  })()

  const review = value.review
  // 历史 fileTree 状态已移除：这里只保留对旧持久化数据的只读读取，
  // 用于把旧的 fileTree.opened 迁移进 review.panelOpened，读取后被整体丢弃。
  const fileTree = value.fileTree

  const migratedReview = (() => {
    if (!isRecord(review)) return review
    if (typeof review.panelOpened === "boolean") return review

    const opened = isRecord(fileTree) && typeof fileTree.opened === "boolean" ? fileTree.opened : false
    return {
      ...review,
      panelOpened: opened,
    }
  })()

  const sessionTabs = value.sessionTabs
  const migratedSessionTabs = (() => {
    if (!isRecord(sessionTabs)) return sessionTabs

    let changed = false
    const next = Object.fromEntries(
      Object.entries(sessionTabs).map(([key, tabs]) => {
        if (!isRecord(tabs) || !Array.isArray(tabs.all)) return [key, tabs]

        const current = {
          all: tabs.all.filter((tab): tab is string => typeof tab === "string"),
          active: typeof tabs.active === "string" ? tabs.active : undefined,
        }
        const normalized = normalizeStoredSessionTabs(key, current)
        if (current.all.length !== tabs.all.length) changed = true
        if (!same(current.all, normalized.all) || current.active !== normalized.active) changed = true
        if (tabs.active !== undefined && typeof tabs.active !== "string") changed = true
        return [key, normalized]
      }),
    )

    if (!changed) return sessionTabs
    return next
  })()

  const sessionView = value.sessionView
  const migratedSessionView = (() => {
    if (!isRecord(sessionView)) return sessionView

    let changed = false
    const next = Object.fromEntries(
      Object.entries(sessionView).map(([key, entry]) => {
        if (!isRecord(entry) || (!("viewMode" in entry) && !("previewWidth" in entry) && !("todoCollapsed" in entry))) {
          return [key, entry]
        }

        const cleaned = { ...entry }
        delete cleaned.viewMode
        delete cleaned.previewWidth
        delete cleaned.todoCollapsed
        changed = true
        return [key, cleaned]
      }),
    )

    if (!changed) return sessionView
    return next
  })()

  const sidePane = value.sidePane
  const migratedSidePane = (() => {
    if (!isRecord(sidePane)) return sidePane

    const legacy = migrateLegacySidePaneTab(sidePane.tab)
    // 动态标签的元数据先读出来，`isSidePaneTab` 需要它来判断某个 id 是否还算合法
    // （会话被删掉后残留的 id 必须过滤掉，否则会渲染出一个空白面板）。
    const dynamic: Record<string, SidePaneSessionTab> = isRecord(sidePane.dynamic)
      ? Object.fromEntries(
          Object.entries(sidePane.dynamic).filter(
            (entry): entry is [string, SidePaneSessionTab] =>
              isRecord(entry[1]) &&
              typeof entry[1].id === "string" &&
              (entry[1].kind === "subagent" ||
                entry[1].kind === "sideChat" ||
                (entry[1].kind === "background" && typeof entry[1].jobID === "string")) &&
              typeof entry[1].sessionID === "string" &&
              typeof entry[1].parentID === "string" &&
              typeof entry[1].title === "string",
          ),
        )
      : {}
    const storedTabs: SidePaneTab[] = Array.isArray(sidePane.tabs)
      ? (sidePane.tabs as unknown[])
          .filter((tab) => isSidePaneTab(tab, dynamic))
          .filter((tab, index, all) => all.indexOf(tab) === index)
      : legacy
        ? [legacy]
        : []
    const activeTab: SidePaneTab | null =
      isSidePaneTab(sidePane.activeTab, dynamic) && storedTabs.includes(sidePane.activeTab)
        ? sidePane.activeTab
        : (storedTabs[0] ?? null)
    const opened = typeof sidePane.opened === "boolean" ? sidePane.opened : DEFAULT_SIDE_PANE_STATE.opened
    const width = typeof sidePane.width === "number" ? sidePane.width : DEFAULT_SIDE_PANE_WIDTH
    // 文件树只属于「工作区文件」宿主。旧持久化状态可能在宿主被关闭后
    // 仍留下 tree: true，恢复时必须一并丢弃，不能让重新打开的空面板带回文件树。
    const tree = sidePane.tree === true && opened && storedTabs.includes("preview")
    const treeWidth =
      typeof sidePane.treeWidth === "number"
        ? Math.min(SIDE_PANE_TREE_MAX_WIDTH, Math.max(SIDE_PANE_TREE_MIN_WIDTH, sidePane.treeWidth))
        : DEFAULT_SIDE_PANE_TREE_WIDTH
    // 分屏状态只在「标签非空且与主窗格不同」时保留。文件标签不在 sidePane.tabs 里，
    // 所以这里只校验字符串本身；已移除的内置标签会在这里被清理。
    const secondary: SidePaneSecondary | undefined = (() => {
      const raw = sidePane.secondary
      if (!isRecord(raw)) return undefined
      if (typeof raw.tab !== "string" || !raw.tab) return undefined
      // Super-Agent is no longer a side-pane tab; remove stale persisted splits.
      if (raw.tab === "super-agent") return undefined
      if (raw.tab === activeTab) return undefined
      const axis = raw.axis === "below" ? "below" : "right"
      const ratio = typeof raw.ratio === "number" ? Math.min(0.85, Math.max(0.15, raw.ratio)) : 0.5
      return { tab: raw.tab, axis, ratio }
    })()
    const secondarySame = (() => {
      const raw = sidePane.secondary
      if (!secondary) return raw === undefined
      if (!isRecord(raw)) return false
      return raw.tab === secondary.tab && raw.axis === secondary.axis && raw.ratio === secondary.ratio
    })()

    if (
      !("tab" in sidePane) &&
      opened === sidePane.opened &&
      width === sidePane.width &&
      tree === sidePane.tree &&
      treeWidth === sidePane.treeWidth &&
      activeTab === sidePane.activeTab &&
      same(Array.isArray(sidePane.tabs) ? sidePane.tabs : [], storedTabs) &&
      // `same` 只比数组；动态表按「键与值都一致」比（值本身是纯数据，逐字段比没有意义，
      // 引用相等就够 —— 迁移时要么原样返回、要么新建，不会出现"内容相同但引用不同"）。
      sameDynamicTabs(sidePane.dynamic, dynamic) &&
      secondarySame
    ) {
      return sidePane
    }

    const { tab: _legacyTab, dynamic: _legacyDynamic, ...rest } = sidePane
    return { ...rest, opened, tabs: storedTabs, activeTab, width, dynamic, secondary, tree, treeWidth }
  })()

  const mode = value.mode
  const migratedMode = (() => {
    if (!isRecord(mode)) return mode
    const projectModes = isRecord(mode.projects) ? mode.projects : {}
    const keptProjects = Object.fromEntries(
      Object.entries(projectModes).filter((entry): entry is [string, AppMode] => {
        const id = entry[1]
        return typeof id === "string" && !RETIRED_APP_MODES.has(id)
      }),
    )
    const current = typeof mode.current === "string" && !RETIRED_APP_MODES.has(mode.current) ? mode.current : undefined
    const droppedCurrent = current === undefined && typeof mode.current === "string"
    if (!droppedCurrent && Object.keys(keptProjects).length === Object.keys(projectModes).length) return mode
    return {
      ...mode,
      current,
      // 模式被下线后不能还留着"已选择"：否则首页不会回到未选择状态。
      hasSelected: current === undefined ? false : mode.hasSelected,
      projects: keptProjects,
    }
  })()

  if (
    !("git" in value) &&
    !("fileTree" in value) &&
    migratedSidebar === sidebar &&
    migratedReview === review &&
    migratedSessionTabs === sessionTabs &&
    migratedSessionView === sessionView &&
    migratedSidePane === sidePane &&
    migratedMode === mode
  ) {
    return value
  }

  const { git: _legacyGit, fileTree: _legacyFileTree, ...rest } = value
  return {
    ...rest,
    sidebar: migratedSidebar,
    review: migratedReview,
    sessionTabs: migratedSessionTabs,
    sessionView: migratedSessionView,
    sidePane: migratedSidePane,
    mode: migratedMode,
  }
}

/** 动态标签表是否等价（键集合 + 每个值的引用都一致）。 */
function sameDynamicTabs(a: unknown, b: Record<string, SidePaneSessionTab>): boolean {
  if (!isRecord(a)) return Object.keys(b).length === 0
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

function closeSidePaneState(state: SidePaneState): SidePaneState {
  const tabs = state.tabs.filter((tab) => tab !== "preview" && tab !== "office")
  const activeTab = tabs.includes(state.activeTab as SidePaneTab) ? state.activeTab : (tabs[0] ?? null)
  const secondary =
    state.secondary && state.secondary.tab !== "preview" && state.secondary.tab !== "office"
      ? state.secondary
      : undefined
  return {
    ...state,
    opened: false,
    tabs,
    activeTab,
    ...(state.secondary !== undefined ? { secondary } : {}),
    ...(state.tree !== undefined ? { tree: false } : {}),
  }
}

/** Side Pane 状态模型的唯一写入口：容器展开/收起与 tab 集合的操作语义都在这里裁决。 */
export function reduceSidePane(state: SidePaneState, action: SidePaneAction): SidePaneState {
  if (action.type === "toggle") {
    if (!state.opened) return { ...closeSidePaneState(state), opened: true }
    return closeSidePaneState(state)
  }
  if (action.type === "open") {
    if (state.opened) return state
    return { ...closeSidePaneState(state), opened: true }
  }
  if (action.type === "close") return closeSidePaneState(state)
  if (action.type === "setTree") return state.tree === action.value ? state : { ...state, tree: action.value }
  if (action.type === "add") {
    const tabs = state.tabs.includes(action.tab) ? state.tabs : [...state.tabs, action.tab]
    return { ...state, opened: true, tabs, activeTab: action.tab }
  }
  if (action.type === "setActive") return { ...state, opened: true, activeTab: action.tab }
  if (action.type === "addSession") {
    const { tab } = action
    const tabs = state.tabs.includes(tab.id) ? state.tabs : [...state.tabs, tab.id]
    // 同一会话的标签不重复：id 就是 `kind:sessionID`，重复打开只会聚焦已有的那个。
    return { ...state, opened: true, tabs, activeTab: tab.id, dynamic: { ...state.dynamic, [tab.id]: tab } }
  }
  if (action.type === "removeSession") {
    const tabs = state.tabs.filter((id) => id !== action.id)
    const dynamic = { ...state.dynamic }
    delete dynamic[action.id]
    if (tabs.length === 0) return { ...state, opened: false, tabs, activeTab: null, dynamic, secondary: undefined }
    const secondary = state.secondary?.tab === action.id ? undefined : state.secondary
    return {
      ...state,
      tabs,
      dynamic,
      ...(secondary ? { secondary } : { secondary: undefined }),
      ...(state.activeTab === action.id ? { activeTab: tabs[tabs.length - 1] ?? null } : {}),
    }
  }
  if (action.type === "openSecondary") {
    // 文件标签不在 sidePane.tabs 里（它们是会话级标签，由标签条单独渲染），
    // 只有内置面板/动态会话标签才需要顺手补进标签集合。
    const isPanel = (SIDE_PANE_TABS as readonly string[]).includes(action.tab) || !!state.dynamic[action.tab]
    const tabs = isPanel && !state.tabs.includes(action.tab) ? [...state.tabs, action.tab] : state.tabs
    // 同一标签不能同时占两个窗格：次要窗格用了内置面板且正是当前激活标签时，把主窗格换到另一个标签。
    const activeTab =
      isPanel && action.tab === state.activeTab
        ? (tabs.find((tab) => tab !== action.tab) ?? state.activeTab)
        : state.activeTab
    return {
      ...state,
      opened: true,
      tabs,
      activeTab,
      secondary: { tab: action.tab, axis: action.axis, ratio: state.secondary?.ratio ?? 0.5 },
    }
  }
  if (action.type === "closeSecondary") {
    if (!state.secondary) return state
    return { ...state, secondary: undefined }
  }
  if (action.type === "setSecondaryRatio") {
    if (!state.secondary) return state
    const ratio = Math.min(0.85, Math.max(0.15, action.ratio))
    if (ratio === state.secondary.ratio) return state
    return { ...state, secondary: { ...state.secondary, ratio } }
  }
  if (action.type === "move") {
    const { from, to } = action
    if (from === to || from < 0 || to < 0 || from >= state.tabs.length || to >= state.tabs.length) return state
    const tabs = [...state.tabs]
    const [moved] = tabs.splice(from, 1)
    if (!moved) return state
    tabs.splice(to, 0, moved)
    return { ...state, tabs }
  }

  const index = state.tabs.indexOf(action.tab)
  if (index === -1) return state
  const tabs = state.tabs.filter((tab) => tab !== action.tab)
  // 文件树只在 preview 宿主存在时有效。关闭工作区文件宿主（顶部标签的 ×）
  // 走的是 remove，不是 close；这里也必须清掉 tree，否则下一次展开面板会把
  // 上一次的文件树带回来。
  const tree = state.tree !== undefined ? tabs.includes("preview") && state.tree : undefined
  const treeState = tree === undefined ? {} : { tree }
  // 关掉一个动态标签时，它的元数据也一起清掉，否则会永远留在持久化里。
  const dynamic = { ...state.dynamic }
  delete dynamic[action.tab]
  // 关掉的正是次要窗格里的标签：分屏一起收起，内容区回到单栏。
  const secondary = state.secondary?.tab === action.tab ? undefined : state.secondary
  if (tabs.length === 0)
    return { ...state, opened: false, tabs, activeTab: null, dynamic, secondary: undefined, ...treeState }
  if (state.activeTab !== action.tab) return { ...state, tabs, dynamic, secondary, ...treeState }
  return { ...state, tabs, dynamic, secondary, activeTab: tabs[Math.min(index, tabs.length - 1)] ?? null, ...treeState }
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  init: () => {
    const globalSdk = useGlobalSDK()
    const globalSync = useGlobalSync()
    const server = useServer()
    const platform = usePlatform()

    const target = Persist.global("layout", ["layout.v8"])
    const [store, setStore, _, ready] = persisted(
      { ...target, migrate: migrateLayoutStore },
      createStore({
        sidebar: {
          opened: false,
          // 桌面端侧栏是否展开。此前散落两处状态：`layout.page` 里的 workspaceSidebarExpanded（真正生效的那个）
          // 与上面这个恒为 false 的 `opened`（遗留）。合并到 `expanded` 一处，
          // 会话帧 Header 才能读到同一个值来渲染「展开侧栏」入口。
          expanded: true,
          width: DEFAULT_SIDEBAR_WIDTH,
          workspaces: {} as Record<string, boolean>,
          workspacesDefault: false,
          defaultCollapsedV1: true,
        },
        terminal: {
          height: DEFAULT_TERMINAL_HEIGHT,
          opened: false,
        },
        review: {
          diffStyle: "split" as ReviewDiffStyle,
          panelOpened: true,
        },
        session: {
          width: DEFAULT_SESSION_WIDTH,
        },
        mobileSidebar: {
          opened: false,
        },
        sidePane: {
          opened: DEFAULT_SIDE_PANE_STATE.opened,
          tabs: [] as SidePaneTab[],
          activeTab: DEFAULT_SIDE_PANE_STATE.activeTab,
          dynamic: {} as Record<string, SidePaneSessionTab>,
          secondary: undefined as SidePaneSecondary | undefined,
          tree: false,
          treeWidth: DEFAULT_SIDE_PANE_TREE_WIDTH,
          width: DEFAULT_SIDE_PANE_WIDTH,
          // false = 用户没手动拖过宽度，跟随「窗口 45%」的默认值（见 sidePane.width）。
          // 旧持久化数据没有这个键 → undefined → 也会走默认值，属于一次性对齐。
          widthCustom: false,
        },
        sidebarView: "tasks" as SidebarView,
        // 侧栏任务列表的视图偏好；老数据缺这个键时 merge() 用上面的默认值补齐。
        taskListView: { ...DEFAULT_TASK_LIST_VIEW },
        // 自定义分组（手动归类）：组定义 + sessionID → 组 id 的归属。
        // 换回「按工作区」等别的分组方式时这两份数据照旧留着 ——
        // 视图偏好不该把用户整理出来的结果丢掉。
        taskGroups: [] as TaskGroup[],
        taskGroupOf: {} as Record<string, string>,
        sessionTabs: {} as Record<string, SessionTabs>,
        sessionView: {} as Record<string, SessionView>,
        handoff: {
          tabs: undefined as TabHandoff | undefined,
        },
        mode: {
          current: undefined as AppMode | undefined,
          hasSelected: false,
          projects: {} as Record<string, AppMode>,
        },
        statusPanel: {
          workspaces: {} as Record<string, { collapsed: boolean; open: Record<string, boolean> }>,
          workspacesDefault: { collapsed: false, open: {} as Record<string, boolean> },
        },
        /**
         * 置顶。存的是**置顶时间**而不是布尔值：多个置顶项之间要按"最近置顶的在上"
         * 排序，只存 true/false 的话顺序会随列表本身变化而抖动。
         *
         * 键：项目用 `pathKey(worktree)`，任务用 sessionID。
         */
        pinned: {
          projects: {} as Record<string, number>,
          sessions: {} as Record<string, number>,
        },
      }),
    )

    // 视口宽度信号：sidePane 默认宽度按「窗口 45%」计算，
    // 窗口缩放时默认宽度要跟着变。
    const [viewportWidth, setViewportWidth] = createSignal(typeof window === "undefined" ? 1280 : window.innerWidth)
    if (typeof window !== "undefined") {
      makeEventListener(window, "resize", () => setViewportWidth(window.innerWidth))
    }

    const MAX_SESSION_KEYS = 50
    const PENDING_MESSAGE_TTL_MS = 2 * 60 * 1000
    const usage = {
      active: undefined as string | undefined,
      pruned: false,
      used: new Map<string, number>(),
    }

    const SESSION_STATE_KEYS = [
      { key: "prompt", legacy: "prompt", version: "v2" },
      { key: "terminal", legacy: "terminal", version: "v1" },
      { key: "file-view", legacy: "file", version: "v1" },
    ] as const

    const dropSessionState = (keys: string[]) => {
      for (const key of keys) {
        const parts = key.split("/")
        const dir = parts[0]
        const session = parts[1]
        if (!dir) continue

        for (const entry of SESSION_STATE_KEYS) {
          const target = session ? Persist.session(dir, session, entry.key) : Persist.workspace(dir, entry.key)
          void removePersisted(target, platform)

          const legacyKey = `${dir}/${entry.legacy}${session ? "/" + session : ""}.${entry.version}`
          void removePersisted({ key: legacyKey }, platform)
        }
      }
    }

    function prune(keep?: string) {
      const drop = pruneSessionKeys({
        keep,
        max: MAX_SESSION_KEYS,
        used: usage.used,
        view: Object.keys(store.sessionView),
        tabs: Object.keys(store.sessionTabs),
      })
      if (drop.length === 0) return

      setStore(
        produce((draft) => {
          for (const key of drop) {
            delete draft.sessionView[key]
            delete draft.sessionTabs[key]
          }
        }),
      )

      scroll.drop(drop)
      dropSessionState(drop)

      for (const key of drop) {
        usage.used.delete(key)
      }
    }

    function touch(sessionKey: string) {
      usage.active = sessionKey
      usage.used.set(sessionKey, Date.now())

      if (!ready()) return
      if (usage.pruned) return

      usage.pruned = true
      prune(sessionKey)
    }

    const scroll = createScrollPersistence({
      debounceMs: 250,
      getSnapshot: (sessionKey) => store.sessionView[sessionKey]?.scroll,
      onFlush: (sessionKey, next) => {
        const current = store.sessionView[sessionKey]
        const keep = usage.active ?? sessionKey
        if (!current) {
          setStore("sessionView", sessionKey, { scroll: next })
          prune(keep)
          return
        }

        setStore("sessionView", sessionKey, "scroll", (prev) => ({ ...prev, ...next }))
        prune(keep)
      },
    })

    const ensureKey = (key: string) => ensureSessionKey(key, touch, (sessionKey) => scroll.seed(sessionKey))

    createEffect(() => {
      if (!ready()) return
      if (usage.pruned) return
      const active = usage.active
      if (!active) return
      usage.pruned = true
      prune(active)
    })

    onMount(() => {
      const flush = () => batch(() => scroll.flushAll())
      const handleVisibility = () => {
        if (document.visibilityState !== "hidden") return
        flush()
      }

      makeEventListener(window, "pagehide", flush)
      makeEventListener(document, "visibilitychange", handleVisibility)

      onCleanup(() => {
        scroll.dispose()
      })
    })

    const [colors, setColors] = createStore<Record<string, AvatarColorKey>>({})
    const colorRequested = new Map<string, AvatarColorKey>()

    function pickAvailableColor(used: Set<string>): AvatarColorKey {
      const available = AVATAR_COLOR_KEYS.filter((c) => !used.has(c))
      if (available.length === 0) return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
      return available[Math.floor(Math.random() * available.length)]
    }

    function enrich(project: { worktree: string; expanded: boolean }) {
      const [childStore] = globalSync.child(project.worktree, { bootstrap: false })
      const projectID = childStore.project
      const metadata = projectID
        ? globalSync.data.project.find((x) => x.id === projectID)
        : globalSync.data.project.find((x) => x.worktree === project.worktree)

      // Preserve local icon override from per-workspace localStorage cache (childStore.icon).
      // Without this, different subdirectories of the same git repo would share the same
      // icon from the database instead of using their individual overrides.
      const base = { ...metadata, ...project }
      if (childStore.icon) {
        return { ...base, icon: { ...base.icon, override: childStore.icon } }
      }
      return base
    }

    /*
     * 项目对象按内容复用。
     *
     * `enrich` / `allProjects` 每次重算都会生成新对象，而侧栏用 `<For each={项目列表}>`
     * 渲染：对象身份一变，整个分组连同下面的任务列表会被拆掉重建。
     * 保存设置这类会触发全局 bootstrap 的操作会重写 project 列表，于是「一操作侧栏就闪」。
     * 这里按 worktree 缓存上一次的对象，内容没变就直接复用，`For` 只动真正变化的行。
     */
    const projectSnapshots = new Map<string, LocalProject>()
    function stableProject(project: LocalProject) {
      const previous = projectSnapshots.get(project.worktree)
      if (previous && sameProjectContent(previous as Record<string, unknown>, project as Record<string, unknown>)) {
        return previous
      }
      projectSnapshots.set(project.worktree, project)
      return project
    }

    const roots = createMemo(() => {
      const map = new Map<string, string>()
      for (const project of globalSync.data.project) {
        const sandboxes = project.sandboxes ?? []
        for (const sandbox of sandboxes) {
          map.set(sandbox, project.worktree)
        }
      }
      return map
    })

    const rootFor = (directory: string) => {
      const map = roots()
      if (map.size === 0) return directory

      const visited = new Set<string>()
      const chain = [directory]

      while (chain.length) {
        const current = chain[chain.length - 1]
        if (!current) return directory

        const next = map.get(current)
        if (!next) return current

        if (visited.has(next)) return directory
        visited.add(next)
        chain.push(next)
      }

      return directory
    }

    createEffect(() => {
      const projects = server.projects.list()
      const seen = new Set(projects.map((project) => project.worktree))

      batch(() => {
        for (const project of projects) {
          const root = rootFor(project.worktree)
          if (root === project.worktree) continue

          server.projects.close(project.worktree)

          if (!seen.has(root)) {
            server.projects.open(root)
            seen.add(root)
          }

          if (project.expanded) server.projects.expand(root)
        }
      })
    })

    const enriched = createMemo(() => server.projects.list().map(enrich))
    const allProjects = createMemo(() => {
      const projects = enriched()
      return projects.map((project) => {
        const color = project.icon?.color ?? colors[project.worktree]
        if (!color) return project
        const icon = project.icon ? { ...project.icon, color } : { color }
        return { ...project, icon }
      })
    })
    const list = createMemo(() => {
      const mode = store.mode.current
      const visible = !mode
        ? allProjects()
        : allProjects().filter((project) => (store.mode.projects[pathKey(project.worktree)] ?? mode) === mode)
      // 置顶的项目排在最前（多个置顶按置顶时间倒序），其余保持原有顺序。
      const pins = store.pinned?.projects ?? {}
      return [...visible]
        .sort((a, b) => {
          const pa = pins[pathKey(a.worktree)] ?? 0
          const pb = pins[pathKey(b.worktree)] ?? 0
          if (pa && pb) return pb - pa
          if (pa) return -1
          if (pb) return 1
          return 0
        })
        .map(stableProject)
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return
      if (!globalSync.ready) return

      for (const project of projects) {
        if (!project.id) continue
        if (project.id === "global") continue
        globalSync.project.icon(project.worktree, project.icon?.override)
      }
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return

      for (const project of projects) {
        if (project.icon?.color) colorRequested.delete(project.worktree)
      }

      const used = new Set<string>()
      for (const project of projects) {
        const color = project.icon?.color ?? colors[project.worktree]
        if (color) used.add(color)
      }

      for (const project of projects) {
        if (project.icon?.color || project.icon?.override || project.icon?.url) continue
        const worktree = project.worktree
        const existing = colors[worktree]
        const color = existing ?? pickAvailableColor(used)
        if (!existing) {
          used.add(color)
          setColors(worktree, color)
        }
        if (!project.id) continue

        const requested = colorRequested.get(worktree)
        if (requested === color) continue
        colorRequested.set(worktree, color)

        if (project.id === "global") {
          globalSync.project.meta(worktree, { icon: { color } })
          continue
        }

        void globalSdk.client.project
          .update({ projectID: project.id, directory: worktree, icon: { color } })
          .catch(() => {
            if (colorRequested.get(worktree) === color) colorRequested.delete(worktree)
          })
      }
    })

    let sessionFrame: number | undefined
    let sessionTimer: number | undefined

    onMount(() => {
      sessionFrame = requestAnimationFrame(() => {
        sessionFrame = undefined
        sessionTimer = window.setTimeout(() => {
          sessionTimer = undefined
          void Promise.all(
            server.projects.list().map((project) => {
              return globalSync.project.loadSessions(project.worktree)
            }),
          )
        }, 0)
      })
    })

    onCleanup(() => {
      if (sessionFrame !== undefined) cancelAnimationFrame(sessionFrame)
      if (sessionTimer !== undefined) window.clearTimeout(sessionTimer)
    })

    const [projectPickerOpen, setProjectPickerOpen] = createSignal(false)

    const readSidePane = (): SidePaneState => ({
      opened: store.sidePane?.opened ?? DEFAULT_SIDE_PANE_STATE.opened,
      tabs: store.sidePane?.tabs ?? DEFAULT_SIDE_PANE_STATE.tabs,
      activeTab: store.sidePane?.activeTab ?? DEFAULT_SIDE_PANE_STATE.activeTab,
      dynamic: store.sidePane?.dynamic ?? DEFAULT_SIDE_PANE_STATE.dynamic,
      secondary: store.sidePane?.secondary,
      tree: store.sidePane?.tree ?? false,
      treeWidth: store.sidePane?.treeWidth ?? DEFAULT_SIDE_PANE_TREE_WIDTH,
    })
    const updateSidePane = (action: SidePaneAction) => {
      setStore("sidePane", {
        ...reduceSidePane(readSidePane(), action),
        width: store.sidePane?.width ?? DEFAULT_SIDE_PANE_WIDTH,
      })
    }

    /**
     * 工作台不是宿主硬编码菜单：插件激活后，它的 primary Agent options 中的
     * `workbench`/`modeGroup` 会被实时合并进左上角切换器。plugin.changed 事件会让
     * global-sync 重拉 Agent，因此安装、启用、停用都不需要重启客户端。
     */
    const availableModes = createMemo<AppModeConfig[]>(() => {
      const result = [APP_MODES[0]!] as AppModeConfig[]
      const seen = new Set<string>([result[0]!.id])
      const directories = new Set<string>([
        ...server.projects.list().map((project) => project.worktree),
        ...globalSync.data.project.map((project) => project.worktree),
      ])
      for (const directory of directories) {
        // Bootstrap on demand so a plugin installed after the project was opened
        // can contribute a workbench without requiring a reload or reopening it.
        const [child] = globalSync.child(directory, { bootstrap: true })
        const byGroup = new Map<string, WorkbenchAgent>()
        for (const agent of child.agent as WorkbenchAgent[]) {
          if (agent.mode === "subagent" || agent.hidden || !agent.options) continue
          const group = textOption(agent.options.modeGroup)
          if (!group || group === "forge") continue
          // Prefer the Agent that carries the complete workbench metadata. The
          // remaining Agents in that group inherit the same dynamic mode.
          const raw = agent.options.workbench
          const hasWorkbench = raw && typeof raw === "object" && !Array.isArray(raw)
          if (!byGroup.has(group) || hasWorkbench) byGroup.set(group, agent)
        }
        for (const agent of byGroup.values()) {
          const mode = workbenchModeFromAgent(agent)
          if (!mode || seen.has(mode.id)) continue
          seen.add(mode.id)
          result.push(mode)
        }
      }
      return result
    })

    createEffect(() => {
      const current = store.mode.current
      if (!current || current === "forge") return
      if (availableModes().some((mode) => mode.id === current)) return
      // 插件被停用/卸载后，当前工作台立即回到编码模式，避免输入框仍引用已消失的 Agent。
      batch(() => {
        setStore("mode", "current", "forge")
        setStore("mode", "hasSelected", true)
      })
    })

    return {
      ready,
      handoff: {
        tabs: createMemo(() => store.handoff?.tabs),
        setTabs(dir: string, id: string) {
          setStore("handoff", "tabs", { dir, id, at: Date.now() })
        },
        clearTabs() {
          if (!store.handoff?.tabs) return
          setStore("handoff", "tabs", undefined)
        },
      },
      projectPicker: {
        open: projectPickerOpen,
        show() {
          setProjectPickerOpen(true)
        },
        hide() {
          setProjectPickerOpen(false)
        },
        toggle() {
          setProjectPickerOpen((value) => !value)
        },
      },
      pinned: {
        project: (worktree: string) => (store.pinned?.projects ?? {})[pathKey(worktree)] !== undefined,
        session: (id: string) => (store.pinned?.sessions ?? {})[id] !== undefined,
        /** sessionID → 置顶时间。任务列表用它排序。 */
        sessions: createMemo<Record<string, number>>(() => store.pinned?.sessions ?? {}),
        toggleProject(worktree: string) {
          const key = pathKey(worktree)
          const next = { ...(store.pinned?.projects ?? {}) }
          if (next[key] !== undefined) delete next[key]
          else next[key] = Date.now()
          setStore("pinned", "projects", next)
        },
        toggleSession(id: string) {
          const next = { ...(store.pinned?.sessions ?? {}) }
          if (next[id] !== undefined) delete next[id]
          else next[id] = Date.now()
          setStore("pinned", "sessions", next)
        },
      },
      projects: {
        list,
        all: allProjects,
        open(directory: string) {
          const root = rootFor(directory)
          if (server.projects.list().find((x) => x.worktree === root)) return
          const mode = store.mode.current
          if (mode) setStore("mode", "projects", pathKey(root), mode)
          void globalSync.project.loadSessions(root)
          server.projects.open(root)
        },
        assign(directory: string, mode = store.mode.current) {
          if (!mode) return
          setStore("mode", "projects", pathKey(rootFor(directory)), mode)
        },
        close(directory: string) {
          server.projects.close(directory)
        },
        expand(directory: string) {
          server.projects.expand(directory)
        },
        collapse(directory: string) {
          server.projects.collapse(directory)
        },
        move(directory: string, toIndex: number) {
          server.projects.move(directory, toIndex)
        },
      },
      mode: {
        all: availableModes,
        current: createMemo(() => store.mode.current),
        hasSelected: createMemo(() => store.mode.hasSelected),
        projectMode(directory: string) {
          return store.mode.projects[pathKey(directory)]
        },
        select(mode: AppMode) {
          batch(() => {
            setStore("mode", "current", mode)
            setStore("mode", "hasSelected", true)
            // 切模式时强制覆盖所有项目的 mode，确保项目列表按新模式过滤正确
            for (const project of server.projects.list()) {
              const key = pathKey(project.worktree)
              setStore("mode", "projects", key, mode)
            }
          })
        },
        reset() {
          setStore("mode", "current", undefined)
          setStore("mode", "hasSelected", false)
        },
      },
      sidebar: {
        opened: createMemo(() => store.sidebar.opened),
        open() {
          setStore("sidebar", "opened", true)
        },
        close() {
          setStore("sidebar", "opened", false)
        },
        toggle() {
          setStore("sidebar", "opened", (x) => !x)
        },
        // 桌面侧栏展开/收起（单一口径，见 store 里的注释）。
        expanded: createMemo(() => store.sidebar.expanded ?? true),
        setExpanded(value: boolean) {
          setStore("sidebar", "expanded", value)
        },
        toggleExpanded() {
          setStore("sidebar", "expanded", (x) => !(x ?? true))
        },
        width: createMemo(() => store.sidebar.width),
        resize(width: number) {
          setStore("sidebar", "width", width)
        },
        workspaces(directory: string) {
          return () => store.sidebar.workspaces[directory] ?? store.sidebar.workspacesDefault ?? false
        },
        setWorkspaces(directory: string, value: boolean) {
          setStore("sidebar", "workspaces", directory, value)
        },
        toggleWorkspaces(directory: string) {
          const current = store.sidebar.workspaces[directory] ?? store.sidebar.workspacesDefault ?? false
          setStore("sidebar", "workspaces", directory, !current)
        },
      },
      /**
       * 侧栏任务列表的视图偏好（「视图」菜单）。
       *
       * 存持久化 store 而不是组件里的 signal：刷新后分组/排序不该回到默认，
       * 而且「不分组」这种视图选择本来就该跨项目记住。
       */
      taskList: {
        groupBy: createMemo(() => store.taskListView?.groupBy ?? DEFAULT_TASK_LIST_VIEW.groupBy),
        sortBy: createMemo(() => store.taskListView?.sortBy ?? DEFAULT_TASK_LIST_VIEW.sortBy),
        workspace: createMemo(() => store.taskListView?.workspace ?? DEFAULT_TASK_LIST_VIEW.workspace),
        recency: createMemo(() => store.taskListView?.recency ?? DEFAULT_TASK_LIST_VIEW.recency),
        setGroupBy(value: TaskGroupBy) {
          setStore("taskListView", "groupBy", value)
        },
        setSortBy(value: TaskSortBy) {
          setStore("taskListView", "sortBy", value)
        },
        setWorkspace(value: string) {
          setStore("taskListView", "workspace", value)
        },
        setRecency(value: TaskRecency) {
          setStore("taskListView", "recency", value)
        },
        /** 自定义分组的组定义（按用户创建顺序）。 */
        groups: createMemo<TaskGroup[]>(() => store.taskGroups ?? []),
        createGroup(name: string) {
          const id = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          setStore(
            "taskGroups",
            produce((draft) => draft.push({ id, name })),
          )
          return id
        },
        renameGroup(id: string, name: string) {
          setStore("taskGroups", (list) => list.map((group) => (group.id === id ? { ...group, name } : group)))
        },
        /** 删组时把组里的会话退回「未分组」，否则归属表会一直留着指向不存在组的键。 */
        deleteGroup(id: string) {
          setStore("taskGroups", (list) => list.filter((group) => group.id !== id))
          setStore(
            "taskGroupOf",
            produce((draft) => {
              for (const [sessionID, groupId] of Object.entries(draft)) {
                if (groupId === id) delete draft[sessionID]
              }
            }),
          )
        },
        assignGroup(sessionID: string, groupId: string | null) {
          if (!groupId) {
            setStore(
              "taskGroupOf",
              produce((draft) => {
                delete draft[sessionID]
              }),
            )
            return
          }
          setStore("taskGroupOf", sessionID, groupId)
        },
        groupOf: (sessionID: string) => store.taskGroupOf?.[sessionID],
        reset() {
          setStore("taskListView", { ...DEFAULT_TASK_LIST_VIEW })
        },
      },
      terminal: {
        height: createMemo(() => store.terminal.height),
        resize(height: number) {
          setStore("terminal", "height", height)
        },
      },
      review: {
        diffStyle: createMemo(() => store.review?.diffStyle ?? "split"),
        setDiffStyle(diffStyle: ReviewDiffStyle) {
          if (!store.review) {
            setStore("review", { diffStyle, panelOpened: true })
            return
          }
          setStore("review", "diffStyle", diffStyle)
        },
      },
      sidePane: {
        opened: createMemo(() => store.sidePane?.opened ?? DEFAULT_SIDE_PANE_STATE.opened),
        tabs: createMemo<SidePaneTab[]>(() => store.sidePane?.tabs ?? DEFAULT_SIDE_PANE_STATE.tabs),
        /** 动态标签（会话）的元数据表，键 = 标签 id。 */
        dynamicTabs: createMemo<Record<string, SidePaneSessionTab>>(
          () => store.sidePane?.dynamic ?? DEFAULT_SIDE_PANE_STATE.dynamic,
        ),
        /** 当前激活的动态标签（内置标签返回 undefined）。 */
        activeSessionTab: createMemo<SidePaneSessionTab | undefined>(() => {
          const id = store.sidePane?.activeTab
          if (typeof id !== "string") return
          return store.sidePane?.dynamic?.[id]
        }),
        activeTab: createMemo<SidePaneTab | null>(() => store.sidePane?.activeTab ?? DEFAULT_SIDE_PANE_STATE.activeTab),
        /** 分屏的次要窗格；undefined = 单栏。 */
        secondary: createMemo<SidePaneSecondary | undefined>(() => store.sidePane?.secondary),
        /** 「工作区文件」面板内的文件树右栏是否展开。 */
        tree: createMemo(() => store.sidePane?.tree ?? false),
        setTree(value: boolean) {
          updateSidePane({ type: "setTree", value })
        },
        toggleTree() {
          updateSidePane({ type: "setTree", value: !(store.sidePane?.tree ?? false) })
        },
        /** 内嵌文件树宽度：拖动分割线时写回持久化。 */
        treeWidth: createMemo(() => store.sidePane?.treeWidth ?? DEFAULT_SIDE_PANE_TREE_WIDTH),
        resizeTree(width: number) {
          setStore(
            "sidePane",
            "treeWidth",
            Math.min(SIDE_PANE_TREE_MAX_WIDTH, Math.max(SIDE_PANE_TREE_MIN_WIDTH, Math.round(width))),
          )
        },
        /**
         * 面板宽度。用户拖过（widthCustom）就用持久化的像素值；
         * 没拖过就跟随「窗口 45%」的默认值
         * （下限取 ResizeHandle 的 min 320）。
         */
        width: createMemo(() => {
          const pane = store.sidePane
          if (pane?.widthCustom && typeof pane.width === "number") return pane.width
          return Math.max(320, Math.round(viewportWidth() * 0.45))
        }),
        open() {
          setStore("sidePane", "opened", true)
        },
        close() {
          updateSidePane({ type: "close" })
        },
        toggle() {
          updateSidePane({ type: "toggle" })
        },
        add(tab: SidePaneTab) {
          updateSidePane({ type: "add", tab })
        },
        /**
         * 打开（或聚焦）一个会话标签。同一 `kind:sessionID` 只会有一个标签。
         *
         * 子代理与侧边对话都是"在右侧面板里看另一个会话"，而不是整页跳走 ——
         * 整页跳转会把主线上下文从眼前挪走，回来还得再找。
         */
        openSession(tab: SidePaneSessionTab) {
          updateSidePane({ type: "addSession", tab })
        },
        /**
         * 关闭会话标签。**只移除标签**，不删服务端会话 ——
         * 删除是调用方的事：子代理的会话属于父会话的一部分，不该因为关了面板就消失；
         * 侧边对话才是"关掉即删除"（见 side-chat 的说明）。
         */
        closeSession(id: string) {
          updateSidePane({ type: "removeSession", id })
        },
        remove(tab: SidePaneTab) {
          updateSidePane({ type: "remove", tab })
        },
        setActive(tab: SidePaneTab) {
          updateSidePane({ type: "setActive", tab })
        },
        move(from: number, to: number) {
          updateSidePane({ type: "move", from, to })
        },
        resize(width: number) {
          batch(() => {
            setStore("sidePane", "width", width)
            setStore("sidePane", "widthCustom", true)
          })
        },
        /** 把标签拆到次要窗格（右/下）。 */
        openSecondary(tab: SidePaneTab, axis: SidePaneSplitAxis) {
          updateSidePane({ type: "openSecondary", tab, axis })
        },
        closeSecondary() {
          updateSidePane({ type: "closeSecondary" })
        },
        setSecondaryRatio(ratio: number) {
          updateSidePane({ type: "setSecondaryRatio", ratio })
        },
      },
      statusPanel: {
        collapsed(directory: string) {
          return () =>
            store.statusPanel.workspaces[directory]?.collapsed ?? store.statusPanel.workspacesDefault.collapsed ?? false
        },
        open(directory: string, sectionId: string, defaultOpen?: boolean) {
          return () => {
            const workspace = store.statusPanel.workspaces[directory]
            // 默认折叠:收起时标题行仍显示摘要,用户点击展开;
            // 运行相关的区块由面板在「出现」时自动展开一次(见 status-panel 的 AUTO_EXPAND)。
            return workspace?.open[sectionId] ?? defaultOpen ?? false
          }
        },
        setCollapsed(directory: string, value: boolean) {
          setStore("statusPanel", "workspaces", directory, (current) => {
            const base = current ?? { collapsed: store.statusPanel.workspacesDefault.collapsed ?? false, open: {} }
            return { ...base, collapsed: value }
          })
        },
        toggleCollapsed(directory: string) {
          const current =
            store.statusPanel.workspaces[directory]?.collapsed ?? store.statusPanel.workspacesDefault.collapsed ?? false
          this.setCollapsed(directory, !current)
        },
        setOpen(directory: string, sectionId: string, value: boolean) {
          setStore("statusPanel", "workspaces", directory, (current) => {
            const base = current ?? { collapsed: store.statusPanel.workspacesDefault.collapsed ?? false, open: {} }
            return { ...base, open: { ...base.open, [sectionId]: value } }
          })
        },
        toggleOpen(directory: string, sectionId: string, defaultOpen?: boolean) {
          setStore("statusPanel", "workspaces", directory, (current) => {
            const base = current ?? { collapsed: store.statusPanel.workspacesDefault.collapsed ?? false, open: {} }
            const open = base.open[sectionId] ?? defaultOpen ?? false
            return { ...base, open: { ...base.open, [sectionId]: !open } }
          })
        },
      },
      sidebarView: {
        current: createMemo<SidebarView>(() => store.sidebarView ?? "tasks"),
        set(view: SidebarView) {
          setStore("sidebarView", view)
        },
      },
      session: {
        width: createMemo(() => store.session?.width ?? DEFAULT_SESSION_WIDTH),
        resize(width: number) {
          if (!store.session) {
            setStore("session", { width })
            return
          }
          setStore("session", "width", width)
        },
      },
      mobileSidebar: {
        opened: createMemo(() => store.mobileSidebar?.opened ?? false),
        show() {
          setStore("mobileSidebar", "opened", true)
        },
        hide() {
          setStore("mobileSidebar", "opened", false)
        },
        toggle() {
          setStore("mobileSidebar", "opened", (x) => !x)
        },
      },
      pendingMessage: {
        set(sessionKey: string, messageID: string) {
          const at = Date.now()
          touch(sessionKey)
          const current = store.sessionView[sessionKey]
          if (!current) {
            setStore("sessionView", sessionKey, {
              scroll: {},
              pendingMessage: messageID,
              pendingMessageAt: at,
            })
            prune(usage.active ?? sessionKey)
            return
          }

          setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              draft.pendingMessage = messageID
              draft.pendingMessageAt = at
            }),
          )
        },
        consume(sessionKey: string) {
          const current = store.sessionView[sessionKey]
          const message = current?.pendingMessage
          const at = current?.pendingMessageAt
          if (!message || !at) return

          setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              delete draft.pendingMessage
              delete draft.pendingMessageAt
            }),
          )

          if (Date.now() - at > PENDING_MESSAGE_TTL_MS) return
          return message
        },
      },
      view(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const s = createMemo(() => store.sessionView[key()] ?? { scroll: {} })
        const terminalOpened = createMemo(() => store.terminal?.opened ?? false)
        const reviewPanelOpened = createMemo(() => store.review?.panelOpened ?? true)

        function setTerminalOpened(next: boolean) {
          const current = store.terminal
          if (!current) {
            setStore("terminal", { height: DEFAULT_TERMINAL_HEIGHT, opened: next })
            return
          }

          const value = current.opened ?? false
          if (value === next) return
          setStore("terminal", "opened", next)
        }

        function setReviewPanelOpened(next: boolean) {
          const current = store.review
          if (!current) {
            setStore("review", { diffStyle: "split" as ReviewDiffStyle, panelOpened: next })
            return
          }

          const value = current.panelOpened ?? true
          if (value === next) return
          setStore("review", "panelOpened", next)
        }

        return {
          scroll(tab: string) {
            return scroll.scroll(key(), tab)
          },
          setScroll(tab: string, pos: SessionScroll) {
            scroll.setScroll(key(), tab, pos)
          },
          todoHeight: {
            get: () => s().todoHeight ?? 200,
            set(height: number) {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, { scroll: {}, todoHeight: height })
              } else {
                setStore("sessionView", session, "todoHeight", height)
              }
            },
          },
          terminal: {
            opened: terminalOpened,
            open() {
              setTerminalOpened(true)
            },
            close() {
              setTerminalOpened(false)
            },
            toggle() {
              setTerminalOpened(!terminalOpened())
            },
          },
          reviewPanel: {
            opened: reviewPanelOpened,
            open() {
              setReviewPanelOpened(true)
            },
            close() {
              setReviewPanelOpened(false)
            },
            toggle() {
              setReviewPanelOpened(!reviewPanelOpened())
            },
          },
          review: {
            open: createMemo(() => s().reviewOpen ?? []),
            setOpen(open: string[]) {
              const session = key()
              const next = Array.from(new Set(open))
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: next,
                })
                return
              }

              if (same(current.reviewOpen, next)) return
              setStore("sessionView", session, "reviewOpen", next)
            },
            openPath(path: string) {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: [path],
                })
                return
              }

              if (!current.reviewOpen) {
                setStore("sessionView", session, "reviewOpen", [path])
                return
              }

              if (current.reviewOpen.includes(path)) return
              setStore("sessionView", session, "reviewOpen", current.reviewOpen.length, path)
            },
            closePath(path: string) {
              const session = key()
              const current = store.sessionView[session]?.reviewOpen
              if (!current) return

              const index = current.indexOf(path)
              if (index === -1) return
              setStore(
                "sessionView",
                session,
                "reviewOpen",
                produce((draft) => {
                  if (!draft) return
                  draft.splice(index, 1)
                }),
              )
            },
            togglePath(path: string) {
              const session = key()
              const current = store.sessionView[session]?.reviewOpen
              if (!current || !current.includes(path)) {
                this.openPath(path)
                return
              }

              this.closePath(path)
            },
          },
        }
      },
      tabs(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const path = createMemo(() => sessionPath(key()))
        const tabs = createMemo(() => store.sessionTabs[key()] ?? { all: [] })
        const normalize = (tab: string) => normalizeSessionTab(path(), tab)
        const normalizeAll = (all: string[]) => normalizeSessionTabList(path(), all)
        return {
          tabs,
          active: createMemo(() => tabs().active),
          all: createMemo(() => tabs().all.filter((tab) => tab !== "review")),
          setActive(tab: string | undefined) {
            const session = key()
            const next = tab ? normalize(tab) : tab
            if (!store.sessionTabs[session]) {
              setStore("sessionTabs", session, { all: [], active: next })
            } else {
              setStore("sessionTabs", session, "active", next)
            }
          },
          setAll(all: string[]) {
            const session = key()
            const next = normalizeAll(all).filter((tab) => tab !== "review")
            if (!store.sessionTabs[session]) {
              setStore("sessionTabs", session, { all: next, active: undefined })
            } else {
              setStore("sessionTabs", session, "all", next)
            }
          },
          async open(tab: string) {
            const session = key()
            const next = nextSessionTabsForOpen(store.sessionTabs[session], normalize(tab))
            setStore("sessionTabs", session, next)
          },
          close(tab: string) {
            const session = key()
            const current = store.sessionTabs[session]
            if (!current) return

            if (tab === "review") {
              if (current.active !== tab) return
              setStore("sessionTabs", session, "active", current.all[0])
              return
            }

            const all = current.all.filter((x) => x !== tab)
            if (current.active !== tab) {
              setStore("sessionTabs", session, "all", all)
              return
            }

            const index = current.all.findIndex((f) => f === tab)
            const next = current.all[index - 1] ?? current.all[index + 1] ?? all[0]
            batch(() => {
              setStore("sessionTabs", session, "all", all)
              setStore("sessionTabs", session, "active", next)
            })
          },
          move(tab: string, to: number) {
            const session = key()
            const current = store.sessionTabs[session]
            if (!current) return
            const index = current.all.findIndex((f) => f === tab)
            if (index === -1) return
            setStore(
              "sessionTabs",
              session,
              "all",
              produce((opened) => {
                opened.splice(to, 0, opened.splice(index, 1)[0])
              }),
            )
          },
        }
      },
    }
  },
})
