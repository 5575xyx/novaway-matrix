import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast, toaster } from "@novaway/ui/toast"
import type { Platform, UpdateStatus } from "./platform"

/**
 * 全局更新状态。
 *
 * 为什么放在模块级 store 而不是某个页面的 signal：检查、下载、进度都由桌面端
 * **主进程**驱动，用户在这期间会切页面（设置 → 会话 → 数据库…）。状态挂在
 * Layout / 设置页的局部 store 里，切走就重置成"空闲"，看起来像检查被取消了。
 * 这里做一份应用级快照，任何页面（侧栏更新按钮、设置页的"立即检查"）都读同一份。
 *
 * 状态来源有两条，都写进同一份快照：
 *  1. `platform.onUpdateStatus` —— 主进程推送（检查中 / 有新版本 / 下载 percent / 已下载）；
 *  2. `checkForUpdate()` / `downloadUpdate()` 的返回值 —— web 端或推送还没到时的兜底。
 */

type Translate = (key: string, vars?: Record<string, string | number | boolean>) => string

export type UpdateSnapshot = {
  stage: UpdateStatus["stage"]
  version?: string
  /** 0-100，仅在 stage = "downloading" 时有意义。 */
  percent: number
  error?: string
  /** 正在检查（手动或定时轮询）。 */
  checking: boolean
  /**
   * 这一次是用户手动触发的吗。
   *
   * 自动检查（启动 / 定时轮询）保持"静默"：查到就由主进程自己下载，按钮等下载完成
   * 才出现。手动检查才把「检查中 → 有新版本 → 下载中」全程显示在侧栏。
   */
  manual: boolean
  /** 本次更新的说明（打包时写进 latest.yml 的 releaseNotes）。 */
  notes?: string
}

let currentPlatform: Platform | undefined
let translate: Translate = (key) => key
let subscribed = false
let lastToast = ""
/**
 * 本进程里是否真的见过「下载中」。
 *
 * 用来区分「上次运行留下的安装包」和「本进程刚下完」：前者只点亮按钮、
 * 不再弹「安装并重启」的 toast，否则每次开机都被提醒一次；后者才值得提醒。
 */
let sawDownloading = false
/** 用户已经点了「安装并重启」：这期间的下载/就绪状态不用再弹提示。 */
let installing = false

const created = createRoot(() => {
  const [state, setState] = createStore<UpdateSnapshot>({
    stage: "idle",
    percent: 0,
    checking: false,
    manual: false,
  })
  return { state, setState }
})

export const updateState = created.state
const setState = created.setState

function toastOnce(key: string, show: () => void) {
  if (lastToast === key) return
  lastToast = key
  show()
}

/**
 * 「有新版本」的 toast 延后 1.2s 再弹。
 *
 * 启动检查是「查到就自动开下」，`available` 之后几十毫秒就会进 `downloading`；
 * 如果立刻弹 toast，用户会看到一条写着「下载更新」的提示 —— 而他什么都没点。
 * 只有状态停在 `available`（手动检查、等用户决定）时才值得提示。
 */
let availableTimer: ReturnType<typeof setTimeout> | undefined
let availableToastId: number | undefined
function toastAvailableLater(version: string) {
  if (availableTimer) clearTimeout(availableTimer)
  availableTimer = setTimeout(() => {
    availableTimer = undefined
    if (updateState.stage !== "available") return
    toastOnce(`available:${version}`, () => {
      availableToastId = showToast({
        icon: "download",
        title: translate("toast.update.title"),
        description: translate("toast.update.description", { version }),
        actions: [
          { label: translate("update.action.download"), onClick: () => void downloadUpdate() },
          { label: translate("toast.update.action.notYet"), onClick: "dismiss" },
        ],
      })
    })
  }, 1200)
}

function clearAvailableTimer() {
  if (availableTimer) {
    clearTimeout(availableTimer)
    availableTimer = undefined
  }
  // 下载一旦开始/结束，那条「下载更新」的提示就该让位给进度和「安装并重启」。
  if (availableToastId !== undefined) {
    toaster?.dismiss?.(availableToastId)
    availableToastId = undefined
  }
}

function apply(status: UpdateStatus) {
  const manual = status.origin === "manual" ? true : status.origin === "auto" ? false : updateState.manual
  const notes = status.notes ?? updateState.notes
  const base = { manual, notes }
  switch (status.stage) {
    case "idle":
      clearAvailableTimer()
      setState({ ...base, stage: "idle", percent: 0, checking: false, error: undefined })
      return
    case "checking":
      clearAvailableTimer()
      setState({ ...base, stage: "checking", checking: true, percent: 0, error: undefined })
      return
    case "available":
      setState({ ...base, stage: "available", version: status.version, checking: false, percent: 0 })
      toastAvailableLater(status.version)
      return
    case "downloading":
      // 自动下载已经开始：之前那条「下载更新」的提示就不该再出现。
      clearAvailableTimer()
      sawDownloading = true
      setState({ ...base, stage: "downloading", version: status.version, percent: status.percent, checking: false })
      return
    case "downloaded": {
      clearAvailableTimer()
      setState({ ...base, stage: "downloaded", version: status.version, percent: 100, checking: false })
      // 没经过「下载中」就变成「已下载」，说明是上次运行留下的安装包：
      // 只点亮按钮（见 updateButtonVisible），不再提醒一遍。正在安装时也不用弹。
      if (!sawDownloading || installing) return
      toastOnce(`downloaded:${status.version}`, () =>
        showToast({
          persistent: true,
          icon: "download",
          title: translate("toast.update.title"),
          description: translate("toast.update.description", { version: status.version }),
          actions: [
            { label: translate("toast.update.action.installRestart"), onClick: () => void installUpdate() },
            { label: translate("toast.update.action.notYet"), onClick: "dismiss" },
          ],
        }),
      )
      return
    }
    case "up-to-date":
      clearAvailableTimer()
      setState({ ...base, stage: "up-to-date", checking: false, percent: 0 })
      return
    case "error":
      clearAvailableTimer()
      setState({ ...base, stage: "error", checking: false, error: status.message })
      return
  }
}

/** 每个应用实例调一次（Layout 启动时）。重复调用只更新 platform / 翻译函数。 */
export function configureUpdate(input: { platform: Platform; t: Translate }) {
  currentPlatform = input.platform
  translate = input.t
  if (subscribed) return
  subscribed = true
  currentPlatform.onUpdateStatus?.(apply)
  // 窗口重载 / 首次挂载：拉一次主进程当前状态，避免错过之前的推送。
  void currentPlatform.updateStatus?.().then(apply).catch(() => {})
}

/** 把「已下载」当成一条完整状态写进快照（老版 update-available 推送的兜底）。 */
export function markDownloaded(version?: string) {
  setState({ stage: "downloaded", version, percent: 100, checking: false, manual: false })
}

export function canCheckUpdate() {
  return !!currentPlatform?.checkUpdate
}

/** 检查更新。检查期间 `updateState.checking` 为 true，切页面也不会重置。 */
export async function checkForUpdate(options?: { manual?: boolean }) {
  const platform = currentPlatform
  if (!platform?.checkUpdate) return
  const manual = options?.manual ?? false
  setState({ stage: "checking", checking: true, percent: 0, error: undefined, manual })
  try {
    const result = await platform.checkUpdate({ manual })
    if (!result.updateAvailable) {
      apply({ stage: "up-to-date" })
      return
    }
    if (result.downloaded) {
      apply({ stage: "downloaded", version: result.version ?? "" })
      return
    }
    // 检查期间后台可能已经开下了（自动检查查到就下）。这时别再写回「有新版本」，
    // 否则进度条会闪回一个"待下载"的状态。
    if (updateState.stage === "downloading") return
    apply({ stage: "available", version: result.version ?? "" })
  } catch (error) {
    apply({ stage: "error", message: error instanceof Error ? error.message : String(error) })
  }
}

/** 下载安装包。进度由主进程通过 onUpdateStatus 持续推回。 */
export async function downloadUpdate() {
  const platform = currentPlatform
  if (!platform?.downloadUpdate) return
  setState({ stage: "downloading", percent: 0, checking: false })
  try {
    const result = await platform.downloadUpdate()
    if (result.downloaded && result.version) apply({ stage: "downloaded", version: result.version })
    else if (result.failed) apply({ stage: "error" })
    else if (!result.updateAvailable) apply({ stage: "idle" })
  } catch (error) {
    apply({ stage: "error", message: error instanceof Error ? error.message : String(error) })
  }
}

/** 安装并重启（会退出进程，正常情况下不会返回）。 */
export async function installUpdate() {
  // 安装前主进程可能要"认领"一下缓存里的安装包，会短暂推「下载中 → 已下载」；
  // 这期间不要弹完成提示，用户已经在装了。
  installing = true
  await currentPlatform?.updateAndRestart?.()
}
