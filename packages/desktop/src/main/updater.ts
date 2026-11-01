import { app, dialog } from "electron"
import pkg from "electron-updater"
import { UPDATER_ENABLED } from "./constants"
import { initLogging } from "./logging"
import { getStore } from "./store"
import type { UpdateStatus } from "../preload/types"

const logger = initLogging()
const { autoUpdater } = pkg

/**
 * 更新状态机。主进程是唯一事实来源：检查、下载、下载进度都在这里推进，
 * 渲染进程只负责照着重画（所以切页面、重载窗口都不会丢进度）。
 *
 * 关键点：`available` 在**检查完成时**就发出，不等下载 —— 旧实现要等安装包
 * 下完才通知渲染进程，用户点"检查更新"后几十秒没有任何反馈。
 */
export type { UpdateStatus }

export type UpdateCheckResult = {
  updateAvailable: boolean
  version?: string
  /** 安装包已经在本机（重启即可安装）。 */
  downloaded?: boolean
  failed?: boolean
}

let downloadedVersion: string | undefined
let availableVersion: string | undefined
/** 本次检查是用户点出来的，还是启动/定时轮询触发的。决定渲染进程要不要显示中间态。 */
let origin: "auto" | "manual" = "auto"
/** 版本说明（来自 latest.yml 的 releaseNotes，打包时由 release-notes.md 写入）。 */
let releaseNotes: string | undefined
let status: UpdateStatus = { stage: "idle" }
let publish: (status: UpdateStatus) => void = () => {}
let checking: Promise<UpdateCheckResult> | undefined
let downloading: Promise<UpdateCheckResult> | undefined

/** 渲染进程重载/新开窗口时主动拉一次，避免错过之前的推送。 */
export function getUpdateStatus(): UpdateStatus {
  return status
}

/**
 * 「启动时检查更新」开关（设置 → 通用 → 更新）。
 *
 * 以前这个开关只关掉渲染进程的轮询，主进程启动检查照跑不误 —— 用户关了等于没关。
 * 现在持久化到主进程的 electron-store，启动检查先看它。
 */
const AUTO_UPDATE_KEY = "autoUpdate"

export function autoUpdateEnabled(): boolean {
  const value = getStore().get(AUTO_UPDATE_KEY)
  return value === undefined ? true : Boolean(value)
}

export function setAutoUpdateEnabled(enabled: boolean) {
  getStore().set(AUTO_UPDATE_KEY, enabled)
}

export function setUpdateStatusPublisher(next: (status: UpdateStatus) => void) {
  publish = next
  // 窗口刚建好就把当前状态补发一次（例如启动早期的检查结果）。
  publish(status)
}

function emit(next: UpdateStatus) {
  status = { ...next, origin, notes: releaseNotes } as UpdateStatus
  logger.log("update status", status)
  publish(status)
}

/** electron-updater 的 releaseNotes 可能是字符串，也可能是 [{version, note}] 数组。 */
function normalizeNotes(input: unknown): string | undefined {
  if (typeof input === "string") return input.trim() || undefined
  if (!Array.isArray(input)) return undefined
  const parts = input
    .map((item) => (item && typeof item === "object" && "note" in item ? String((item as { note: unknown }).note) : ""))
    .filter((text) => text.trim().length > 0)
  return parts.length > 0 ? parts.join("\n\n") : undefined
}

export function setupAutoUpdater() {
  if (!UPDATER_ENABLED) return
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
  })

  // 下载进度实时推给渲染进程：侧栏那颗更新按钮会画成进度条。
  autoUpdater.on("download-progress", (progress) => {
    const version = availableVersion ?? downloadedVersion
    if (!version) return
    emit({
      stage: "downloading",
      version,
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      transferred: progress.transferred,
      total: progress.total,
    })
  })
  autoUpdater.on("error", (error) => {
    logger.error("auto updater error", error)
    emit({ stage: "error", message: error instanceof Error ? error.message : String(error) })
  })
}

/**
 * 只检查，不下载。返回后 `available` 状态已经推给渲染进程，
 * 由用户决定要不要下（手动检查更新走这条路）。
 */
export async function checkUpdate(options?: { manual?: boolean }): Promise<UpdateCheckResult> {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  origin = options?.manual ? "manual" : "auto"
  if (downloadedVersion) {
    logger.log("update already downloaded", { version: downloadedVersion })
    emit({ stage: "downloaded", version: downloadedVersion })
    return { updateAvailable: true, version: downloadedVersion, downloaded: true }
  }
  // 连点两次"检查更新"只发一次请求。
  if (checking) return checking
  emit({ stage: "checking" })
  checking = (async (): Promise<UpdateCheckResult> => {
    try {
      const result = await autoUpdater.checkForUpdates()
      const version = result?.updateInfo?.version
      if (result?.isUpdateAvailable === false || !version) {
        availableVersion = undefined
        releaseNotes = undefined
        emit({ stage: "up-to-date" })
        return { updateAvailable: false }
      }
      availableVersion = version
      releaseNotes = normalizeNotes(result?.updateInfo?.releaseNotes)
      emit({ stage: "available", version })
      return { updateAvailable: true, version }
    } catch (error) {
      logger.error("update check failed", error)
      emit({ stage: "error", message: error instanceof Error ? error.message : String(error) })
      return { updateAvailable: false, failed: true }
    } finally {
      checking = undefined
    }
  })()
  return checking
}

/** 下载安装包（幂等：已经在下的复用同一个 Promise）。 */
export async function downloadUpdate(): Promise<UpdateCheckResult> {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  if (downloadedVersion) return { updateAvailable: true, version: downloadedVersion, downloaded: true }
  if (downloading) return downloading
  if (!availableVersion) {
    const checked = await checkUpdate()
    if (!checked.updateAvailable) return checked
  }
  const version = availableVersion
  if (!version) return { updateAvailable: false }
  emit({ stage: "downloading", version, percent: 0, transferred: 0, total: 0 })
  downloading = (async (): Promise<UpdateCheckResult> => {
    try {
      await autoUpdater.downloadUpdate()
      downloadedVersion = version
      emit({ stage: "downloaded", version })
      logger.log("update download completed", { version })
      return { updateAvailable: true, version, downloaded: true }
    } catch (error) {
      logger.error("update download failed", error)
      emit({ stage: "error", message: error instanceof Error ? error.message : String(error) })
      return { updateAvailable: true, version, failed: true }
    } finally {
      downloading = undefined
    }
  })()
  return downloading
}

export async function installUpdate(killSidecar: () => Promise<void>) {
  if (!downloadedVersion) {
    // 没有下载过就先下载：以前这里直接 quitAndInstall，安装包不存在会静默失败。
    const result = await downloadUpdate()
    if (!result.downloaded) {
      logger.log("install update skipped", { reason: result.failed ? "download failed" : "no update available" })
      return
    }
  }
  logger.log("installing downloaded update", { version: downloadedVersion })
  await killSidecar()
  // isForceRunAfter=true → 给安装器加 --force-run,装完直接拉起新版本。
  // 配合安装器里的 HIDE_RUN_AFTER_FINISH(见 electron-builder.config.ts),
  // 用户不会再看到"运行 NovaWay"复选框,也不需要再确认一次。
  autoUpdater.quitAndInstall(false, true)
}

/**
 * 通知渲染进程"更新已下载"。返回 true 表示已交给应用内的现代 toast 提示,
 * 主进程就不要再弹那个老式原生对话框了(见 checkForUpdates)。
 */
export type UpdateNotifier = (info: { version?: string }) => boolean

export async function checkForUpdates(
  alertOnFail: boolean,
  killSidecar: () => Promise<void>,
  notify?: UpdateNotifier,
  options?: { download?: boolean; manual?: boolean },
) {
  if (!UPDATER_ENABLED) return
  logger.log("checkForUpdates invoked", { alertOnFail, download: options?.download })
  const manual = options?.manual ?? options?.download === false
  const result = await checkUpdate({ manual })
  if (!result.updateAvailable) {
    if (result.failed) {
      if (!alertOnFail) return
      await dialog.showMessageBox({ type: "error", message: "Update check failed.", title: "Update Error" })
      return
    }
    if (!alertOnFail) return
    await dialog.showMessageBox({ type: "info", message: "You're up to date.", title: "No Updates" })
    return
  }

  // 启动时的后台检查继续自己下载（用户没点任何东西，不该再要他点第二次）；
  // 手动检查只停在 `available`，等用户点下载 —— 进度会实时出现在更新按钮上。
  if (options?.download === false) return
  const downloaded = await downloadUpdate()
  if (!downloaded.downloaded) return

  if (notify?.({ version: downloaded.version })) {
    logger.log("update ready delegated to renderer", { version: downloaded.version ?? null })
    return
  }

  const response = await dialog.showMessageBox({
    type: "info",
    message: `Update ${downloaded.version ?? ""} downloaded. Restart now?`,
    title: "Update Ready",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) await installUpdate(killSidecar)
}
