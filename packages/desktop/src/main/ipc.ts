import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  BrowserWindow,
  Notification,
  app,
  clipboard,
  dialog,
  ipcMain,
  screen,
  session,
  shell,
  webContents,
} from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron"

import { copyLocalFileToClipboard, downloadUrlToTempFile } from "./clipboard-file"

import type {
  FloatingAgentState,
  FloatingNotification,
  FloatingPanelTab,
  FloatingPetAction,
  FloatingPetActionResult,
  FloatingPetGame,
  FloatingPetGameResult,
  FloatingPetProfile,
  FloatingPetPreset,
  FloatingPetAvatar,
  FloatingPetAccessory,
  FloatingPetDifficulty,
  FloatingPetReaction,
  FloatingPetRpsChoice,
  FloatingPetRpsResult,
  FloatingPetSkin,
  FloatingPetState,
  FloatingTask,
  FloatingTaskEvent,
  FloatingTaskGroup,
  InitStep,
  ServerReadyData,
  SqliteMigrationProgress,
  TitlebarTheme,
  WindowConfig,
  WslConfig,
} from "../preload/types"
import { getStore } from "./store"
import {
  clearReadFloatingNotifications,
  markFloatingNotificationsRead,
  normalizeFloatingNotifications,
  prependFloatingNotification,
  resolveFloatingNotification,
} from "./floating-notifications"
import {
  getAccounts,
  addOrUpdateAccount,
  removeAccount,
  getAccount,
  updateAccountStatus,
  updateAccountInfo,
  getAccountGroups,
  saveAccountGroup,
  deleteAccountGroup,
  editAccountGroup,
  PlatformLoginManager,
  getSupportedPlatforms,
  getPlatform,
} from "./platform"
import { PET_VISIBLE_KEY } from "./constants"
import { resolveFloatingRestoreAnchor, resolveFloatingWidgetMode } from "./floating-widget-state"
import {
  FLOATING_COLLAPSED_SIZE,
  FLOATING_MINIMAL_SIZE,
  appIconPath,
  createFloatingPanelWindow,
  createFloatingSkinWindow,
  clampFloatingPetPosition,
  getFloatingCollapsedBounds,
  getFloatingPetHitBounds,
  positionFloatingMinimal,
  positionFloatingPanel,
  positionFloatingRestore,
  positionFloatingSkinMenu,
  setFloatingCollapsedPosition,
  setTitlebar,
  updateTitlebar,
} from "./windows"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
}

const isFloatingPetSkin = (value: string): value is FloatingPetSkin =>
  value === "snow" ||
  value === "honey" ||
  value === "ash" ||
  value === "aurora" ||
  value === "violet" ||
  value === "crimson" ||
  /^#[0-9a-f]{6}$/i.test(value)

let mainWindowRef: BrowserWindow | null = null
let floatingWindowRef: BrowserWindow | null = null
let floatingPanelWindowRef: BrowserWindow | null = null
let floatingSkinWindowRef: BrowserWindow | null = null
let floatingAgentState: FloatingAgentState = { agents: [] }
let floatingPetReactionID = 0
let floatingWidgetReady = false
let floatingWidgetVisible = false
let floatingWidgetRequested = false
/** 当前是否处于“捕获鼠标”状态（false=穿透） */
let floatingMouseCapture = false
/** 拖拽中强制保持捕获，避免拖出命中区后丢手势 */
let floatingDragActive = false
let floatingHitPollTimer: ReturnType<typeof setInterval> | undefined
const floatingDragOrigins = new WeakMap<WebContents, { pointerX: number; pointerY: number; x: number; y: number }>()

const activeNotifications = new Set<Notification>()

type FloatingTaskTiming = {
  status: FloatingTask["status"]
  startedAt?: number
  completedAt?: number
  durationMs?: number
  updatedAt: number
}

function floatingTaskKey(group: FloatingTaskGroup, task: FloatingTask, index: number) {
  return `${group.sessionID}:${task.id ?? `${task.content}:${task.priority}:${index}`}`
}

function restoreFloatingTaskTimings() {
  const stored = getStore().get("floatingWidget.taskTimings")
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {} as Record<string, FloatingTaskTiming>
  return stored as Record<string, FloatingTaskTiming>
}

function restoreFloatingTaskEvents() {
  const stored = getStore().get("floatingWidget.taskEvents")
  if (!Array.isArray(stored)) return [] as FloatingTaskEvent[]
  return stored as FloatingTaskEvent[]
}

function restoreFloatingNotifications() {
  return normalizeFloatingNotifications(getStore().get("floatingWidget.notifications"))
}

function restoreFloatingAgentNotifications() {
  if (floatingAgentState.notifications) return
  floatingAgentState = { ...floatingAgentState, notifications: restoreFloatingNotifications() }
}

function liveWebContents(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return
  const contents = win.webContents
  if (contents.isDestroyed()) return
  return contents
}

function sendWindowEvent(win: BrowserWindow | null, channel: string, ...args: unknown[]) {
  const contents = liveWebContents(win)
  if (!contents) return
  try {
    contents.send(channel, ...args)
  } catch (error) {
    if (win?.isDestroyed() || contents.isDestroyed()) return
    throw error
  }
}

function broadcastFloatingAgentState(includeMain = false) {
  const windows = includeMain
    ? [mainWindowRef, floatingWindowRef, floatingPanelWindowRef]
    : [floatingWindowRef, floatingPanelWindowRef]
  for (const win of windows) {
    sendWindowEvent(win, "floating-agent-change", floatingAgentState)
  }
}

function applyFloatingTaskTimings(groups: FloatingTaskGroup[] | undefined) {
  if (!groups) return undefined
  const now = Date.now()
  const stored = restoreFloatingTaskTimings()
  const events: FloatingTaskEvent[] = []
  const next: Record<string, FloatingTaskTiming> = {}
  const normalized = groups.map((group) => {
    let changed = false
    const tasks = group.tasks.map((task, index) => {
      const key = floatingTaskKey(group, task, index)
      const previous = stored[key]
      const restarted =
        (previous?.status === "completed" || previous?.status === "cancelled") &&
        (task.status === "pending" || task.status === "in_progress")
      const startedAt =
        task.startedAt ??
        (restarted ? (task.status === "in_progress" ? now : undefined) : previous?.startedAt) ??
        (task.status === "in_progress" ? now : undefined)
      const completedAt =
        task.completedAt ??
        (restarted ? undefined : previous?.completedAt) ??
        (task.status === "completed" && previous?.status === "in_progress" ? now : undefined)
      const durationMs =
        task.durationMs ??
        (restarted ? undefined : previous?.durationMs) ??
        (completedAt && startedAt ? Math.max(0, completedAt - startedAt) : undefined) ??
        (task.status === "cancelled" && startedAt ? Math.max(0, now - startedAt) : undefined)
      next[key] = { status: task.status, startedAt, completedAt, durationMs, updatedAt: now }
      if (previous?.status !== task.status) {
        changed = true
        if (previous) {
          events.push({
            id: `${key}:${now}`,
            groupID: group.id,
            groupLabel: group.label,
            taskContent: task.content,
            status: task.status,
            at: now,
            durationMs,
          })
        }
      }
      return { ...task, startedAt, completedAt, durationMs }
    })
    const previousUpdate = Math.max(
      0,
      ...group.tasks.map((task, index) => stored[floatingTaskKey(group, task, index)]?.updatedAt ?? 0),
    )
    return { ...group, tasks, updatedAt: changed ? now : (group.updatedAt ?? previousUpdate) }
  })
  getStore().set("floatingWidget.taskTimings", next)
  const taskEvents = [...events, ...restoreFloatingTaskEvents()].slice(0, 24)
  getStore().set("floatingWidget.taskEvents", taskEvents)
  return { taskGroups: normalized, taskEvents }
}

function restoreFloatingPetSkin() {
  if (floatingAgentState.petSkin) return
  const stored = getStore().get("floatingWidget.petSkin")
  if (typeof stored !== "string" || !isFloatingPetSkin(stored)) return
  floatingAgentState = { ...floatingAgentState, petSkin: stored }
}

const PET_STATE_KEY = "floatingWidget.petState"
const PET_PROFILE_KEY = "floatingWidget.petProfile"
const PET_MAX = 100
const PET_DECAY_PER_HOUR = { satiety: 2, hydration: 3, mood: 1, energy: 1 }
const PET_ACTIONS: Record<
  FloatingPetAction,
  { key: keyof Omit<FloatingPetState, "coins" | "xp" | "lastUpdatedAt">; amount: number; message: string }
> = {
  feed: { key: "satiety", amount: 24, message: "吃得饱饱的，心情真好！" },
  drink: { key: "hydration", amount: 28, message: "喝到水啦，精神起来了！" },
  play: { key: "mood", amount: 20, message: "玩得很开心，获得了小奖励！" },
}

const PET_GAMES: FloatingPetGame[] = ["gomoku", "minesweeper", "sudoku", "tetris", "2048"]
const PET_DIFFICULTIES: FloatingPetDifficulty[] = ["easy", "normal", "hard"]

function defaultFloatingPetProfile(): FloatingPetProfile {
  return {
    name: "Nova",
    preset: "snow",
    skin: "snow",
    avatar: "nova",
    accessory: "none",
    gamesPlayed: 0,
    highScores: { gomoku: 0, minesweeper: 0, sudoku: 0, tetris: 0, "2048": 0 },
    gameSettings: { gomoku: "normal", minesweeper: "normal", sudoku: "normal", tetris: "normal", "2048": "normal" },
  }
}

function normalizeFloatingPetProfile(value: unknown): FloatingPetProfile {
  const base = defaultFloatingPetProfile()
  if (!value || typeof value !== "object" || Array.isArray(value)) return base
  const stored = value as Partial<FloatingPetProfile>
  const name = typeof stored.name === "string" ? stored.name.trim().slice(0, 24) : base.name
  const skin = typeof stored.skin === "string" && isFloatingPetSkin(stored.skin) ? stored.skin : base.skin
  const avatar: FloatingPetAvatar =
    stored.avatar === "nova" || stored.avatar === "fox" || stored.avatar === "cat" || stored.avatar === "robot"
      ? stored.avatar
      : base.avatar
  const accessory: FloatingPetAccessory =
    stored.accessory === "none" || stored.accessory === "crown" || stored.accessory === "glasses" || stored.accessory === "scarf"
      ? stored.accessory
      : base.accessory
  const preset: FloatingPetPreset =
    stored.preset === "snow" || stored.preset === "honey" || stored.preset === "ash" || stored.preset === "aurora" ||
    stored.preset === "violet" || stored.preset === "crimson" || stored.preset === "custom"
      ? stored.preset
      : skin.startsWith("#") ? "custom" : skin === "snow" || skin === "honey" || skin === "ash" || skin === "aurora" || skin === "violet" || skin === "crimson" ? skin : "snow"
  const scores = (stored.highScores ?? {}) as Partial<Record<FloatingPetGame, number>>
  const settings = (stored.gameSettings ?? {}) as Partial<Record<FloatingPetGame, FloatingPetDifficulty>>
  const gameSettings = Object.fromEntries(PET_GAMES.map((game) => [game, PET_DIFFICULTIES.includes(settings[game] as FloatingPetDifficulty) ? settings[game] : base.gameSettings[game]])) as FloatingPetProfile["gameSettings"]
  return {
    name: name || base.name, preset, skin, avatar, accessory,
    gamesPlayed: Math.max(0, Math.floor(typeof stored.gamesPlayed === "number" ? stored.gamesPlayed : 0)),
    highScores: Object.fromEntries(PET_GAMES.map((game) => [game, Math.max(0, Math.floor(typeof scores[game] === "number" ? scores[game] : 0))])) as Record<FloatingPetGame, number>,
    gameSettings,
  }
}

function restoreFloatingPetProfile() {
  const profile = normalizeFloatingPetProfile(floatingAgentState.petProfile ?? getStore().get(PET_PROFILE_KEY))
  floatingAgentState = { ...floatingAgentState, petProfile: profile, petSkin: profile.skin }
  getStore().set(PET_PROFILE_KEY, profile)
  return profile
}

function saveFloatingPetProfile(profile: FloatingPetProfile) {
  floatingAgentState = { ...floatingAgentState, petProfile: profile, petSkin: profile.skin }
  getStore().set(PET_PROFILE_KEY, profile)
  getStore().set("floatingWidget.petSkin", profile.skin)
  broadcastFloatingAgentState()
  return profile
}

function clampPet(value: number) {
  return Math.max(0, Math.min(PET_MAX, Math.round(value)))
}

function defaultFloatingPetState(): FloatingPetState {
  return { satiety: 76, hydration: 78, mood: 82, energy: 80, coins: 0, xp: 0, lastUpdatedAt: Date.now() }
}

function normalizeFloatingPetState(value: unknown): FloatingPetState {
  const base = defaultFloatingPetState()
  if (!value || typeof value !== "object" || Array.isArray(value)) return base
  const stored = value as Partial<FloatingPetState>
  return {
    satiety: clampPet(typeof stored.satiety === "number" ? stored.satiety : base.satiety),
    hydration: clampPet(typeof stored.hydration === "number" ? stored.hydration : base.hydration),
    mood: clampPet(typeof stored.mood === "number" ? stored.mood : base.mood),
    energy: clampPet(typeof stored.energy === "number" ? stored.energy : base.energy),
    coins: Math.max(0, Math.round(typeof stored.coins === "number" ? stored.coins : base.coins)),
    xp: Math.max(0, Math.round(typeof stored.xp === "number" ? stored.xp : base.xp)),
    lastUpdatedAt: typeof stored.lastUpdatedAt === "number" ? stored.lastUpdatedAt : base.lastUpdatedAt,
  }
}

function restoreFloatingPetState() {
  const pet = normalizeFloatingPetState(floatingAgentState.pet ?? getStore().get(PET_STATE_KEY))
  const elapsedHours = Math.max(0, (Date.now() - pet.lastUpdatedAt) / 3_600_000)
  const next: FloatingPetState = {
    ...pet,
    satiety: clampPet(pet.satiety - elapsedHours * PET_DECAY_PER_HOUR.satiety),
    hydration: clampPet(pet.hydration - elapsedHours * PET_DECAY_PER_HOUR.hydration),
    mood: clampPet(pet.mood - elapsedHours * PET_DECAY_PER_HOUR.mood),
    energy: clampPet(pet.energy - elapsedHours * PET_DECAY_PER_HOUR.energy),
    lastUpdatedAt: Date.now(),
  }
  floatingAgentState = { ...floatingAgentState, pet: next }
  getStore().set(PET_STATE_KEY, next)
  return next
}

function saveFloatingPetState(pet: FloatingPetState) {
  floatingAgentState = { ...floatingAgentState, pet }
  getStore().set(PET_STATE_KEY, pet)
  broadcastFloatingAgentState()
  return pet
}

function setFloatingPetReaction(reaction: FloatingPetReaction) {
  floatingPetReactionID += 1
  floatingAgentState = {
    ...floatingAgentState,
    petReaction: { name: reaction, id: floatingPetReactionID },
  }
  broadcastFloatingAgentState()
}

function performFloatingPetAction(action: FloatingPetAction): FloatingPetActionResult {
  const config = PET_ACTIONS[action]
  setFloatingPetReaction(action)
  const pet = restoreFloatingPetState()
  const reward = action === "play" ? 2 : 1
  const next = saveFloatingPetState({
    ...pet,
    [config.key]: clampPet(pet[config.key] + config.amount),
    mood: clampPet(pet.mood + (action === "play" ? 6 : 2)),
    coins: pet.coins + reward,
    xp: pet.xp + 3,
    lastUpdatedAt: Date.now(),
  })
  return { pet: next, message: config.message, reward }
}

function playFloatingPetRps(player: FloatingPetRpsChoice): FloatingPetRpsResult {
  const choices: FloatingPetRpsChoice[] = ["rock", "paper", "scissors"]
  const petChoice = choices[Math.floor(Math.random() * choices.length)] ?? "rock"
  const outcome =
    player === petChoice
      ? "draw"
      : (player === "rock" && petChoice === "scissors") ||
          (player === "paper" && petChoice === "rock") ||
          (player === "scissors" && petChoice === "paper")
        ? "win"
        : "lose"
  const pet = restoreFloatingPetState()
  const reward = outcome === "win" ? 5 : outcome === "draw" ? 2 : 1
  const message =
    outcome === "win"
      ? "你赢啦！宠物送你 5 枚星星币。"
      : outcome === "draw"
        ? "平局！你们默契十足。"
        : "这局宠物赢了，再来一局吧！"
  const next = saveFloatingPetState({
    ...pet,
    mood: clampPet(pet.mood + (outcome === "lose" ? 4 : 8)),
    energy: clampPet(pet.energy - 2),
    coins: pet.coins + reward,
    xp: pet.xp + 5,
    lastUpdatedAt: Date.now(),
  })
  setFloatingPetReaction(outcome === "win" ? "win" : "rps")
  return { pet: next, player, petChoice, outcome, message, reward }
}

function claimFloatingPetGameReward(game: FloatingPetGame, score: number): FloatingPetGameResult {
  setFloatingPetReaction("win")
  const normalized = Math.max(0, Math.min(9999, Math.floor(Number.isFinite(score) ? score : 0)))
  const pet = restoreFloatingPetState()
  const reward =
    game === "gomoku"
      ? Math.min(12, 3 + Math.floor(normalized / 2))
      : game === "minesweeper"
        ? Math.min(10, 1 + Math.floor(normalized / 6))
        : Math.min(12, 2 + Math.floor(normalized / 100))
  const gameLabels: Record<FloatingPetGame, string> = {
    gomoku: "五子棋",
    minesweeper: "扫雷",
    sudoku: "数独",
    tetris: "俄罗斯方块",
    "2048": "2048",
  }
  const message = `${gameLabels[game]}得分 ${normalized}，获得 ${reward} 枚星星币。`
  const next = saveFloatingPetState({
    ...pet,
    mood: clampPet(pet.mood + 6),
    energy: clampPet(pet.energy - 3),
    coins: pet.coins + reward,
    xp: pet.xp + reward * 2,
    lastUpdatedAt: Date.now(),
  })
  const profile = restoreFloatingPetProfile()
  saveFloatingPetProfile({
    ...profile,
    gamesPlayed: profile.gamesPlayed + 1,
    highScores: { ...profile.highScores, [game]: Math.max(profile.highScores[game], normalized) },
  })
  return { pet: next, game, score: normalized, message, reward }
}

export function setMainWindow(win: BrowserWindow | null) {
  mainWindowRef = win
}

export function setFloatingWindow(win: BrowserWindow | null) {
  floatingWindowRef = win
  floatingWidgetReady = false
  floatingWidgetVisible = false
  floatingWidgetRequested = false
  floatingMouseCapture = false
  floatingDragActive = false
  stopFloatingHitPoll()
  if (win) {
    // 新建窗体默认穿透，等待显示后再开始命中轮询
    win.setIgnoreMouseEvents(true, { forward: true })
    return
  }
  const panel = floatingPanelWindowRef
  if (panel && !panel.isDestroyed()) panel.close()
  floatingPanelWindowRef = null
  const skin = floatingSkinWindowRef
  if (skin && !skin.isDestroyed()) skin.close()
  floatingSkinWindowRef = null
}

function isMainInterfaceActive() {
  const main = mainWindowRef
  if (!main || main.isDestroyed()) return false
  // 主窗口可见且获得焦点：视为用户正在主界面操作
  return main.isVisible() && !main.isMinimized() && main.isFocused()
}

function stopFloatingHitPoll() {
  if (floatingHitPollTimer === undefined) return
  clearInterval(floatingHitPollTimer)
  floatingHitPollTimer = undefined
}

let minimalHitPollTimer: ReturnType<typeof setInterval> | undefined

function startMinimalHitPoll() {
  if (minimalHitPollTimer !== undefined) return
  minimalHitPollTimer = setInterval(() => {
    const floating = floatingWindowRef
    if (!floating || floating.isDestroyed()) return
    const point = screen.getCursorScreenPoint()
    const bounds = floating.getBounds()
    const over =
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    setFloatingMousePassthrough(!over)
    sendWindowEvent(floating, "floating-cursor-active", over)
  }, 50)
}

function stopMinimalHitPoll() {
  if (minimalHitPollTimer === undefined) return
  clearInterval(minimalHitPollTimer)
  minimalHitPollTimer = undefined
}

function presentFloatingMinimal() {
  const floating = floatingWindowRef
  if (!floating || floating.isDestroyed() || !floatingWidgetReady) return
  const panel = floatingPanelWindowRef
  if (panel && !panel.isDestroyed()) panel.close()
  floatingPanelWindowRef = null
  const skin = floatingSkinWindowRef
  if (skin && !skin.isDestroyed()) skin.close()
  floatingSkinWindowRef = null
  floatingWidgetVisible = false
  stopFloatingHitPoll()
  positionFloatingMinimal(floating)
  floating.showInactive()
  floating.setIgnoreMouseEvents(true, { forward: true })
  floatingMouseCapture = false
  floating.webContents.send("floating-mode-change", "minimal")
  floating.webContents.send("floating-visibility-change", false)
  startMinimalHitPoll()
}

function startFloatingHitPoll() {
  if (floatingHitPollTimer !== undefined) return
  // ~60fps 轮询光标：指针一进宠物热区即可点，并同步抓取光标
  floatingHitPollTimer = setInterval(() => {
    syncFloatingMouseCaptureFromCursor()
  }, 16)
}

function isCursorOverFloatingPet(
  point: { x: number; y: number },
  hit: { x: number; y: number; width: number; height: number },
) {
  return point.x >= hit.x && point.x <= hit.x + hit.width && point.y >= hit.y && point.y <= hit.y + hit.height
}

function setFloatingMousePassthrough(ignore: boolean) {
  const floating = floatingWindowRef
  if (!floating || floating.isDestroyed()) return
  const capture = !ignore
  if (floatingMouseCapture === capture) return
  floatingMouseCapture = capture
  floating.setIgnoreMouseEvents(ignore, { forward: true })
  // 通知渲染进程切换光标（grab / 默认）
  sendWindowEvent(floating, "floating-cursor-active", capture)
}

function syncFloatingMouseCaptureFromCursor() {
  const floating = floatingWindowRef
  if (!floating || floating.isDestroyed() || !floatingWidgetVisible) return
  if (floatingDragActive) {
    setFloatingMousePassthrough(false)
    return
  }
  // 面板/皮肤菜单打开时，宠物窗本身仍保持穿透，交互由独立窗体处理
  const panel = floatingPanelWindowRef
  const skin = floatingSkinWindowRef
  if ((panel && !panel.isDestroyed() && panel.isVisible()) || (skin && !skin.isDestroyed() && skin.isVisible())) {
    setFloatingMousePassthrough(true)
    return
  }
  const point = screen.getCursorScreenPoint()
  const hit = getFloatingPetHitBounds(floating)
  const over = isCursorOverFloatingPet(point, hit)
  setFloatingMousePassthrough(!over)
}

function presentFloatingWidget() {
  const floating = floatingWindowRef
  if (!floating || floating.isDestroyed() || !floatingWidgetReady || !floatingWidgetRequested || floatingWidgetVisible)
    return
  stopMinimalHitPoll()
  const bounds = floating.getBounds()
  if (bounds.width === FLOATING_MINIMAL_SIZE) {
    positionFloatingRestore(floating, resolveFloatingRestoreAnchor(bounds, FLOATING_COLLAPSED_SIZE))
  }
  floatingWidgetVisible = true
  floating.showInactive()
  floating.setIgnoreMouseEvents(true, { forward: true })
  floatingMouseCapture = false
  floating.webContents.send("floating-mode-change", "full")
  startFloatingHitPoll()
  floating.webContents.send("floating-visibility-change", true)
}

function setFloatingPanelWindow(win: BrowserWindow | null) {
  floatingPanelWindowRef = win
}

function presentFloatingPanel(tab: FloatingPanelTab) {
  const floating = floatingWindowRef
  if (!floating || floating.isDestroyed()) return

  const panel = floatingPanelWindowRef
  if (panel && !panel.isDestroyed()) {
    positionFloatingPanel(panel, floating)
    panel.show()
    sendWindowEvent(panel, "floating-panel-tab-change", tab)
    notifyFloatingExpanded(true)
    return
  }

  const next = createFloatingPanelWindow(floating, tab)
  setFloatingPanelWindow(next)
  next.once("ready-to-show", () => notifyFloatingExpanded(true))
  next.on("closed", () => {
    if (floatingPanelWindowRef === next) setFloatingPanelWindow(null)
    notifyFloatingExpanded(false)
  })
}

function notifyFloatingExpanded(expanded: boolean) {
  sendWindowEvent(floatingWindowRef, "floating-expanded-change", expanded)
}

function notifyFloatingSkinMenu(visible: boolean) {
  sendWindowEvent(floatingWindowRef, "floating-skin-menu-change", visible)
}

function beginFloatingWidgetDrag(sender: WebContents, pointerX: number, pointerY: number) {
  const win = BrowserWindow.fromWebContents(sender)
  if (!win || win.isDestroyed()) return
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return
  floatingDragActive = true
  setFloatingMousePassthrough(false)
  const bounds = getFloatingCollapsedBounds(win)
  floatingDragOrigins.set(sender, { pointerX, pointerY, x: bounds.x, y: bounds.y })
}

function moveFloatingWidget(sender: WebContents, pointerX: number, pointerY: number) {
  const win = BrowserWindow.fromWebContents(sender)
  if (!win || win.isDestroyed()) return
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return
  const origin = floatingDragOrigins.get(sender)
  if (!origin) return
  const display = screen.getDisplayNearestPoint({
    x: origin.x + FLOATING_COLLAPSED_SIZE / 2,
    y: origin.y + FLOATING_COLLAPSED_SIZE / 2,
  })
  const next = clampFloatingPetPosition(
    {
      x: origin.x + pointerX - origin.pointerX,
      y: origin.y + pointerY - origin.pointerY,
    },
    display.workArea,
  )
  setFloatingCollapsedPosition(win, { x: Math.round(next.x), y: Math.round(next.y) })
  const panel = floatingPanelWindowRef
  if (panel && !panel.isDestroyed()) positionFloatingPanel(panel, win)
  const skin = floatingSkinWindowRef
  if (skin && !skin.isDestroyed()) positionFloatingSkinMenu(skin, win)
}

type Deps = {
  killSidecar: () => Promise<void> | void
  awaitInitialization: (sendStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig> | WindowConfig
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void> | void
  getDisplayBackend: () => Promise<string | null>
  setDisplayBackend: (backend: string | null) => Promise<void> | void
  parseMarkdown: (markdown: string) => Promise<string> | string
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void> | void
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
}

export function registerIpcHandlers(deps: Deps) {
  ipcMain.handle("kill-sidecar", () => deps.killSidecar())
  ipcMain.handle("await-initialization", (event: IpcMainInvokeEvent) => {
    const send = (step: InitStep) => event.sender.send("init-step", step)
    return deps.awaitInitialization(send)
  })
  ipcMain.handle("get-window-config", () => deps.getWindowConfig())
  ipcMain.handle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks())
  ipcMain.handle("get-default-server-url", () => deps.getDefaultServerUrl())
  ipcMain.handle("set-default-server-url", (_event: IpcMainInvokeEvent, url: string | null) =>
    deps.setDefaultServerUrl(url),
  )
  ipcMain.handle("get-wsl-config", () => deps.getWslConfig())
  ipcMain.handle("set-wsl-config", (_event: IpcMainInvokeEvent, config: WslConfig) => deps.setWslConfig(config))
  ipcMain.handle("get-display-backend", () => deps.getDisplayBackend())
  ipcMain.handle("set-display-backend", (_event: IpcMainInvokeEvent, backend: string | null) =>
    deps.setDisplayBackend(backend),
  )
  ipcMain.handle("parse-markdown", (_event: IpcMainInvokeEvent, markdown: string) => deps.parseMarkdown(markdown))
  ipcMain.handle("check-app-exists", (_event: IpcMainInvokeEvent, appName: string) => deps.checkAppExists(appName))
  ipcMain.handle("wsl-path", (_event: IpcMainInvokeEvent, path: string, mode: "windows" | "linux" | null) =>
    deps.wslPath(path, mode),
  )
  ipcMain.handle("resolve-app-path", (_event: IpcMainInvokeEvent, appName: string) => deps.resolveAppPath(appName))
  ipcMain.on("loading-window-complete", () => deps.loadingWindowComplete())
  ipcMain.handle("run-updater", (_event: IpcMainInvokeEvent, alertOnFail: boolean) => deps.runUpdater(alertOnFail))
  ipcMain.handle("check-update", () => deps.checkUpdate())
  ipcMain.handle("install-update", () => deps.installUpdate())
  ipcMain.handle("set-background-color", (_event: IpcMainInvokeEvent, color: string) => deps.setBackgroundColor(color))
  ipcMain.handle("store-get", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    try {
      const store = getStore(name)
      const value = store.get(key)
      if (value === undefined || value === null) return null
      return typeof value === "string" ? value : JSON.stringify(value)
    } catch {
      return null
    }
  })
  ipcMain.handle("store-set", (_event: IpcMainInvokeEvent, name: string, key: string, value: string) => {
    try {
      getStore(name).set(key, value)
    } catch (error) {
      console.warn(`设置持久化失败，已保留本次运行状态: ${name}/${key}`, error)
    }
  })
  ipcMain.handle("store-delete", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    getStore(name).delete(key)
  })
  ipcMain.handle("store-clear", (_event: IpcMainInvokeEvent, name: string) => {
    getStore(name).clear()
  })
  ipcMain.handle("store-keys", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store)
  })
  ipcMain.handle("store-length", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store).length
  })

  ipcMain.handle("get-floating-agent-state", () => {
    restoreFloatingPetSkin()
    restoreFloatingPetProfile()
    restoreFloatingPetState()
    restoreFloatingAgentNotifications()
    return floatingAgentState
  })

  ipcMain.handle("get-floating-pet-management-state", () => {
    const profile = restoreFloatingPetProfile()
    const pet = restoreFloatingPetState()
    return { visible: getStore().get(PET_VISIBLE_KEY, true) as boolean, profile, pet }
  })

  ipcMain.handle(
    "update-floating-pet-profile",
    (_event: IpcMainInvokeEvent, input: Partial<Pick<FloatingPetProfile, "name" | "preset" | "skin" | "avatar" | "accessory" | "gameSettings">>) => {
      const current = restoreFloatingPetProfile()
      const skin = typeof input.skin === "string" && isFloatingPetSkin(input.skin) ? input.skin : current.skin
      const preset: FloatingPetPreset =
        input.preset === "snow" || input.preset === "honey" || input.preset === "ash" || input.preset === "aurora" ||
        input.preset === "violet" || input.preset === "crimson" || input.preset === "custom"
          ? input.preset
          : current.preset
      const avatar: FloatingPetAvatar = input.avatar === "nova" || input.avatar === "fox" || input.avatar === "cat" || input.avatar === "robot" ? input.avatar : current.avatar
      const accessory: FloatingPetAccessory = input.accessory === "none" || input.accessory === "crown" || input.accessory === "glasses" || input.accessory === "scarf" ? input.accessory : current.accessory
      const gameSettings = input.gameSettings
        ? (() => {
            const inputGameSettings = input.gameSettings
            return Object.fromEntries(
              PET_GAMES.map((game) => [
                game,
                PET_DIFFICULTIES.includes(inputGameSettings[game] as FloatingPetDifficulty)
                  ? inputGameSettings[game]
                  : current.gameSettings[game],
              ]),
            ) as FloatingPetProfile["gameSettings"]
          })()
        : current.gameSettings
      const name = typeof input.name === "string" ? input.name.trim().slice(0, 24) : current.name
      const profile = saveFloatingPetProfile({ ...current, name: name || current.name, preset, skin, avatar, accessory, gameSettings })
      const pet = restoreFloatingPetState()
      return { visible: getStore().get(PET_VISIBLE_KEY, true) as boolean, profile, pet }
    },
  )

  ipcMain.handle("reset-floating-pet-progress", () => {
    const profile = restoreFloatingPetProfile()
    const pet = defaultFloatingPetState()
    saveFloatingPetState(pet)
    const nextProfile = saveFloatingPetProfile({
      ...profile,
      gamesPlayed: 0,
      highScores: { gomoku: 0, minesweeper: 0, sudoku: 0, tetris: 0, "2048": 0 },
      gameSettings: { ...profile.gameSettings },
    })
    return { visible: getStore().get(PET_VISIBLE_KEY, true) as boolean, profile: nextProfile, pet }
  })

  ipcMain.on("floating-widget-ready", () => {
    floatingWidgetReady = true
    floatingWidgetRequested = getStore().get(PET_VISIBLE_KEY, true) as boolean
    if (resolveFloatingWidgetMode(floatingWidgetRequested) === "full") {
      presentFloatingWidget()
      return
    }
    presentFloatingMinimal()
  })

  ipcMain.handle("show-floating-widget", () => {
    floatingWidgetRequested = getStore().get(PET_VISIBLE_KEY, true) as boolean
    if (resolveFloatingWidgetMode(floatingWidgetRequested) === "minimal") {
      presentFloatingMinimal()
      return
    }
    presentFloatingWidget()
  })

  ipcMain.handle("set-floating-widget-visible", (_event: IpcMainInvokeEvent, visible: boolean) => {
    floatingWidgetRequested = visible
    const floating = floatingWindowRef
    if (floating && !floating.isDestroyed() && visible) {
      floatingWidgetRequested = true
      presentFloatingWidget()
    }
    if (floating && !floating.isDestroyed() && !visible) {
      presentFloatingMinimal()
    }
    try {
      getStore().set(PET_VISIBLE_KEY, visible)
    } catch (error) {
      console.warn("悬浮宠物开关持久化失败，当前运行状态仍已生效", error)
    }
  })

  ipcMain.handle("restore-floating-widget", () => {
    const floating = floatingWindowRef
    if (!floating || floating.isDestroyed()) return
    if (floatingWidgetRequested) {
      presentFloatingWidget()
      return
    }
    presentFloatingMinimal()
  })

  ipcMain.handle("get-floating-widget-visible", () => {
    return getStore().get(PET_VISIBLE_KEY, true) as boolean
  })

  ipcMain.handle("set-floating-widget-minimal", (_event: IpcMainInvokeEvent, minimal: boolean) => {
    const floating = floatingWindowRef
    if (!floating || floating.isDestroyed()) return
    if (minimal) {
      stopFloatingHitPoll()
      positionFloatingMinimal(floating)
      floating.webContents.send("floating-mode-change", "minimal")
    } else {
      positionFloatingRestore(floating)
      floating.webContents.send("floating-mode-change", "full")
      if (floatingWidgetVisible) startFloatingHitPoll()
    }
  })

  ipcMain.handle("set-floating-agent", (_event: IpcMainInvokeEvent, name: string) => {
    floatingAgentState = { ...floatingAgentState, current: name }
    broadcastFloatingAgentState(true)
  })

  ipcMain.handle("set-floating-pet-skin", (_event: IpcMainInvokeEvent, skin: string) => {
    if (!isFloatingPetSkin(skin)) return
    floatingAgentState = { ...floatingAgentState, petSkin: skin }
    getStore().set("floatingWidget.petSkin", skin)
    broadcastFloatingAgentState()
  })

  ipcMain.handle("set-floating-pet-reaction", (_event: IpcMainInvokeEvent, reaction: FloatingPetReaction) => {
    if (
      reaction !== "feed" &&
      reaction !== "drink" &&
      reaction !== "play" &&
      reaction !== "rps" &&
      reaction !== "think" &&
      reaction !== "jump" &&
      reaction !== "win"
    ) {
      throw new Error("Invalid pet reaction")
    }
    setFloatingPetReaction(reaction)
  })

  ipcMain.handle("floating-pet-action", (_event: IpcMainInvokeEvent, action: FloatingPetAction) => {
    if (action !== "feed" && action !== "drink" && action !== "play") throw new Error("Invalid pet action")
    return performFloatingPetAction(action)
  })

  ipcMain.handle("floating-pet-rps", (_event: IpcMainInvokeEvent, choice: FloatingPetRpsChoice) => {
    if (choice !== "rock" && choice !== "paper" && choice !== "scissors") throw new Error("Invalid RPS choice")
    return playFloatingPetRps(choice)
  })

  ipcMain.handle("floating-pet-game-reward", (_event: IpcMainInvokeEvent, game: FloatingPetGame, score: number) => {
    if (game !== "gomoku" && game !== "minesweeper" && game !== "sudoku" && game !== "tetris" && game !== "2048") {
      throw new Error("Invalid pet game")
    }
    return claimFloatingPetGameReward(game, score)
  })

  ipcMain.handle("mark-floating-notifications-read", (_event: IpcMainInvokeEvent, ids?: string[]) => {
    restoreFloatingAgentNotifications()
    const notifications = markFloatingNotificationsRead(floatingAgentState.notifications ?? [], ids)
    floatingAgentState = { ...floatingAgentState, notifications }
    getStore().set("floatingWidget.notifications", notifications)
    broadcastFloatingAgentState()
  })

  ipcMain.handle("clear-floating-notifications", () => {
    restoreFloatingAgentNotifications()
    const notifications = clearReadFloatingNotifications(floatingAgentState.notifications ?? [])
    floatingAgentState = { ...floatingAgentState, notifications }
    getStore().set("floatingWidget.notifications", notifications)
    broadcastFloatingAgentState()
  })

  ipcMain.handle("open-floating-notification", (_event: IpcMainInvokeEvent, id: string) => {
    restoreFloatingAgentNotifications()
    const notification = floatingAgentState.notifications?.find((item) => item.id === id)
    if (!notification) return
    const notifications = markFloatingNotificationsRead(floatingAgentState.notifications ?? [], [id])
    floatingAgentState = { ...floatingAgentState, notifications }
    getStore().set("floatingWidget.notifications", notifications)
    const main = mainWindowRef
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) main.restore()
      main.show()
      main.focus()
    }
    sendWindowEvent(main, "notification-click", notification.href)
    broadcastFloatingAgentState()
  })

  ipcMain.handle(
    "resolve-floating-notification",
    (_event: IpcMainInvokeEvent, input: { sessionID: string; requestID: string; status: "replied" | "dismissed" }) => {
      restoreFloatingAgentNotifications()
      const notifications = resolveFloatingNotification(floatingAgentState.notifications ?? [], input)
      floatingAgentState = { ...floatingAgentState, notifications }
      getStore().set("floatingWidget.notifications", notifications)
      broadcastFloatingAgentState()
    },
  )

  ipcMain.handle("toggle-floating-skin-menu", () => {
    const floating = floatingWindowRef
    if (!floating || floating.isDestroyed()) return
    const existing = floatingSkinWindowRef
    if (existing && !existing.isDestroyed()) {
      existing.close()
      return
    }
    const next = createFloatingSkinWindow(floating)
    floatingSkinWindowRef = next
    next.once("ready-to-show", () => notifyFloatingSkinMenu(true))
    next.on("closed", () => {
      if (floatingSkinWindowRef === next) floatingSkinWindowRef = null
      notifyFloatingSkinMenu(false)
    })
  })

  ipcMain.handle("update-floating-agent-state", (_event: IpcMainInvokeEvent, state: FloatingAgentState) => {
    restoreFloatingPetSkin()
    restoreFloatingPetState()
    restoreFloatingAgentNotifications()
    const petSkin = state.petSkin && isFloatingPetSkin(state.petSkin) ? state.petSkin : floatingAgentState.petSkin
    const pet = state.pet ? normalizeFloatingPetState(state.pet) : floatingAgentState.pet
    const monitoring = applyFloatingTaskTimings(state.taskGroups)
    const taskGroups = monitoring?.taskGroups
    const tasks = taskGroups?.flatMap((group) => group.tasks) ?? state.tasks
    const taskEvents = monitoring?.taskEvents ?? floatingAgentState.taskEvents
    floatingAgentState = {
      ...floatingAgentState,
      ...state,
      tasks,
      taskGroups,
      taskEvents,
      ...(petSkin ? { petSkin } : {}),
      ...(pet ? { pet } : {}),
    }
    if (petSkin) {
      getStore().set("floatingWidget.petSkin", petSkin)
    }
    if (pet) {
      getStore().set(PET_STATE_KEY, pet)
    }
    broadcastFloatingAgentState()
  })

  ipcMain.on("set-floating-mouse-passthrough", (_event: IpcMainEvent, ignore: boolean) => {
    // 拖拽中忽略渲染进程的穿透请求，防止半途丢鼠标
    if (floatingDragActive) return
    setFloatingMousePassthrough(ignore !== false)
  })

  ipcMain.on("begin-floating-widget-drag", (event: IpcMainEvent, pointerX: number, pointerY: number) => {
    beginFloatingWidgetDrag(event.sender, pointerX, pointerY)
  })

  ipcMain.on("move-floating-widget", (event: IpcMainEvent, pointerX: number, pointerY: number) => {
    moveFloatingWidget(event.sender, pointerX, pointerY)
  })

  ipcMain.handle("save-floating-widget-bounds", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    floatingDragActive = false
    floatingDragOrigins.delete(event.sender)
    syncFloatingMouseCaptureFromCursor()
    // 始终以收起后的图标位置为锚点保存，避免展开/收起后位置偏移
    const collapsedX = getFloatingCollapsedBounds(win).x
    const collapsedY = getFloatingCollapsedBounds(win).y
    getStore().set("floatingWidget.bounds", {
      x: collapsedX,
      y: collapsedY,
      width: FLOATING_COLLAPSED_SIZE,
      height: FLOATING_COLLAPSED_SIZE,
    })
  })

  ipcMain.handle("set-floating-expanded", (_event: IpcMainInvokeEvent, expanded: boolean, tab?: FloatingPanelTab) => {
    const floating = floatingWindowRef
    if (!floating || floating.isDestroyed()) return

    if (!expanded) {
      const panel = floatingPanelWindowRef
      if (panel && !panel.isDestroyed()) panel.close()
      setFloatingPanelWindow(null)
      return
    }

    presentFloatingPanel(tab === "notifications" || tab === "pet" ? tab : "monitor")
  })

  ipcMain.handle(
    "open-directory-picker",
    async (_event: IpcMainInvokeEvent, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? "Choose a folder",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "open-file-picker",
    async (
      _event: IpcMainInvokeEvent,
      opts?: { multiple?: boolean; title?: string; defaultPath?: string; accept?: string[]; extensions?: string[] },
    ) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? "Choose a file",
        defaultPath: opts?.defaultPath,
        filters: pickerFilters(opts?.extensions),
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  ipcMain.handle(
    "save-file-picker",
    async (_event: IpcMainInvokeEvent, opts?: { title?: string; defaultPath?: string; data?: Uint8Array }) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? "Save file",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled || !result.filePath) return null
      if (opts?.data) await writeFile(result.filePath, Buffer.from(opts.data))
      return result.filePath
    },
  )

  ipcMain.handle(
    "copy-file-to-clipboard",
    async (_event: IpcMainInvokeEvent, opts?: { url?: string; filename?: string }) => {
      if (!opts?.url) return false
      const tempPath = await downloadUrlToTempFile(opts.url, opts.filename ?? "video.mp4")
      if (!tempPath) return false
      return copyLocalFileToClipboard(tempPath)
    },
  )

  ipcMain.handle("write-text-to-clipboard", (_event: IpcMainInvokeEvent, opts?: { text?: string }) => {
    if (!opts?.text) return false
    clipboard.writeText(opts.text)
    return clipboard.readText() === opts.text
  })

  ipcMain.on("open-link", (_event: IpcMainEvent, url: string) => {
    void shell.openExternal(url)
  })

  ipcMain.handle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
    if (!app) return shell.openPath(path)
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })

  ipcMain.handle("create-directory", async (_event: IpcMainInvokeEvent, parentPath: string, dirName: string) => {
    const targetPath = path.join(parentPath, dirName)
    await mkdir(targetPath, { recursive: true })
    return targetPath
  })

  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  ipcMain.on(
    "show-notification",
    (
      _event: IpcMainEvent,
      title: string,
      body?: string,
      href?: string,
      showSystem = true,
      context?: { sessionID?: string; requestID?: string },
    ) => {
      restoreFloatingAgentNotifications()
      const at = Date.now()
      const notification: FloatingNotification = {
        id: `notification:${at}:${Math.random().toString(36).slice(2, 8)}`,
        title,
        ...(body ? { body } : {}),
        ...(href ? { href } : {}),
        ...(context?.sessionID ? { sessionID: context.sessionID } : {}),
        ...(context?.requestID ? { requestID: context.requestID } : {}),
        at,
        read: false,
      }
      const notifications = prependFloatingNotification(floatingAgentState.notifications ?? [], notification)
      floatingAgentState = { ...floatingAgentState, notifications }
      getStore().set("floatingWidget.notifications", notifications)

      if (floatingWidgetVisible && !isMainInterfaceActive()) presentFloatingPanel("notifications")

      if (showSystem && !floatingWidgetVisible && Notification.isSupported()) {
        const systemNotification = new Notification({ title, body, icon: appIconPath() })
        const release = () => activeNotifications.delete(systemNotification)
        activeNotifications.add(systemNotification)
        systemNotification.once("close", release)
        systemNotification.once("failed", release)
        systemNotification.on("click", () => {
          const main = mainWindowRef
          if (main && !main.isDestroyed()) {
            if (main.isMinimized()) main.restore()
            main.show()
            main.focus()
          }
          sendWindowEvent(main, "notification-click", href)
          release()
        })
        try {
          systemNotification.show()
        } catch (error) {
          release()
          console.error("系统通知显示失败", error)
        }
      }

      broadcastFloatingAgentState()
    },
  )

  ipcMain.handle("get-window-count", () => BrowserWindow.getAllWindows().length)

  ipcMain.handle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  ipcMain.handle("set-window-focus", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  ipcMain.handle("show-window", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  ipcMain.on("relaunch", () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle("get-zoom-factor", (event: IpcMainInvokeEvent) => event.sender.getZoomFactor())
  ipcMain.handle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: number) => {
    event.sender.setZoomFactor(factor)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  ipcMain.handle("set-titlebar", (event: IpcMainInvokeEvent, theme: TitlebarTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })

  // === Platform Management ===
  ipcMain.handle("platform:create-webview", async (_event, data: { webViewId: number; cookies: Electron.Cookie[] }) => {
    const wc = webContents.fromId(data.webViewId)
    if (!wc || wc.isDestroyed()) {
      console.error("[platform:create-webview] webContents not found or destroyed for id:", data.webViewId)
      return { success: false, error: "webview not found" }
    }
    console.log(
      `[platform:create-webview] Setting ${data.cookies.length} cookies, names:`,
      data.cookies.map((c) => c.name).join(", "),
    )
    let setCount = 0
    for (const c of data.cookies) {
      // webview 可能在 await 间隙被 renderer 销毁，销毁后访问 session 会抛 "Object has been destroyed"
      if (wc.isDestroyed()) return { success: true, setCount }
      try {
        const url = c.domain
          ? c.domain.startsWith(".")
            ? `https://www.${c.domain.slice(1)}`
            : `https://${c.domain}`
          : ""
        await wc.session.cookies.set({
          url,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
        })
        setCount++
      } catch (err) {
        console.error(`[platform:create-webview] Failed to set cookie "${c.name}":`, err)
      }
    }
    console.log(`[platform:create-webview] Successfully set ${setCount}/${data.cookies.length} cookies`)
    if (wc.isDestroyed()) return { success: true, setCount }

    // Verify by reading back
    try {
      const savedCookies = await wc.session.cookies.get({})
      console.log(`[platform:create-webview] Session now has ${savedCookies.length} cookies total`)
    } catch {}
    return { success: true, setCount }
  })

  ipcMain.handle("platform:destroy-webview", async (_event, webViewId: number) => {
    const wc = webContents.fromId(webViewId)
    if (wc && !wc.isDestroyed()) {
      wc.removeAllListeners()
    }
    return { success: true }
  })

  ipcMain.handle("platform:get-accounts", async () => {
    return getAccounts()
  })

  ipcMain.handle("platform:get-supported-platforms", async () => {
    return getSupportedPlatforms()
  })

  ipcMain.handle("platform:add-account", async (_event, platformType: string) => {
    console.log("[platform:add-account] starting login for:", platformType)
    const platform = getPlatform(platformType)
    const loginManager = new PlatformLoginManager()
    const result = await loginManager.startLogin(platform)

    console.log("[platform:add-account] login result:", result.success, "uid:", result.uid, "error:", result.error)
    if (!result.success) {
      return { success: false, error: result.error || "登录失败" }
    }

    const saved = addOrUpdateAccount(
      { platform: platformType, uid: result.uid || "" },
      {
        account: result.uid || "",
        nickname: result.nickname || "",
        avatar: result.avatar || "",
        cookies: result.loginCookie || "",
        status: "valid",
        fansCount: result.fansCount || 0,
        token: "",
        abnormalStatus: null,
        groupId: 1,
        lastStatsTime: null,
      },
    )
    console.log("[platform:add-account] account saved:", saved?.id)
    return { success: true, account: saved }
  })

  ipcMain.handle("platform:remove-account", async (_event, id: string) => {
    removeAccount(id)
    return { success: true }
  })

  ipcMain.handle("platform:check-login", async (_event, id: string) => {
    const account = getAccount(id)
    if (!account) return { valid: false }
    const platform = getPlatform(account.platform)
    const cookies: Electron.Cookie[] = JSON.parse(account.cookies)
    const valid = await platform.detectLogin(cookies)
    updateAccountStatus(id, valid ? "valid" : "expired")
    if (valid) {
      const accountInfo = await platform.getAccountInfo(cookies).catch(() => null)
      if (accountInfo) {
        updateAccountInfo(id, {
          nickname: accountInfo.nickname,
          avatar: accountInfo.avatar,
          fansCount: accountInfo.fansCount || 0,
        })
      }
    }
    return { valid }
  })

  ipcMain.handle("platform:batch-check-login", async (_event, ids: string[]) => {
    const results: { id: string; valid: boolean }[] = []
    const checkOne = async (id: string) => {
      const account = getAccount(id)
      if (!account) return { id, valid: false }
      try {
        const platform = getPlatform(account.platform)
        const cookies: Electron.Cookie[] = JSON.parse(account.cookies)
        const valid = await platform.detectLogin(cookies)
        updateAccountStatus(id, valid ? "valid" : "expired")
        if (valid) {
          const accountInfo = await platform.getAccountInfo(cookies).catch(() => null)
          if (accountInfo) {
            updateAccountInfo(id, {
              nickname: accountInfo.nickname,
              avatar: accountInfo.avatar,
              fansCount: accountInfo.fansCount || 0,
            })
          }
        }
        return { id, valid }
      } catch {
        updateAccountStatus(id, "login_failed")
        return { id, valid: false }
      }
    }
    const allResults = await Promise.all(ids.map(checkOne))
    return allResults
  })

  ipcMain.handle("platform:get-groups", async () => {
    return getAccountGroups()
  })

  ipcMain.handle("platform:add-group", async (_event, data: { name: string }) => {
    const groups = getAccountGroups()
    const maxId = groups.reduce((max, g) => Math.max(max, g.id), 0)
    const newGroup = {
      id: maxId + 1,
      name: data.name,
      rank: groups.length,
      proxyIp: "",
      proxyOpen: false,
    }
    saveAccountGroup(newGroup)
    return newGroup
  })

  ipcMain.handle("platform:edit-group", async (_event, data: { id: number; name: string }) => {
    editAccountGroup(data)
    return { success: true }
  })

  ipcMain.handle("platform:delete-group", async (_event, id: number) => {
    deleteAccountGroup(id)
    return { success: true }
  })

  ipcMain.handle("platform:move-account-group", async (_event, data: { accountId: string; groupId: number }) => {
    updateAccountInfo(data.accountId, { groupId: data.groupId })
    return { success: true }
  })

  ipcMain.handle("platform:publish", async (event, input: { accountId: string; publishInput: any }) => {
    const account = getAccount(input.accountId)
    if (!account) throw new Error("账号不存在")
    const platform = getPlatform(account.platform)
    const cookies: Electron.Cookie[] = JSON.parse(account.cookies)
    return platform.publish(input.publishInput, cookies)
  })
}

export function sendSqliteMigrationProgress(win: BrowserWindow, progress: SqliteMigrationProgress) {
  win.webContents.send("sqlite-migration-progress", progress)
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}
