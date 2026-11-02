import { app, dialog } from "electron"
import pkg from "electron-updater"
import { spawn } from "node:child_process"
import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { UPDATER_ENABLED } from "./constants"
import { initLogging } from "./logging"
import { getStore } from "./store"
import { isPendingUpdateUsable, shouldAutoDownload, shouldReplaceDownloaded } from "./update-policy"
import { pruneUpdateCache, readUpdaterCacheDirName, systemCacheRoot, updaterCacheDir } from "./update-cache"
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
/**
 * 已经下好的安装包路径，以及 electron-updater 在本进程里是否"认领"了它。
 *
 * 认领 = electron-updater 的 DownloadedUpdateHelper 指向这个文件，`quitAndInstall`
 * 才能直接把它交给安装器。重启后第一次点安装要先走一次"检查 + 下载"，
 * 它会用 update-info.json 里的 sha512 校验本地文件，命中就直接返回、不真的重下。
 */
let downloadedInstaller: string | undefined
let installerReady = false
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
    .map((item) => {
      if (!item || typeof item !== "object" || !("note" in item)) return ""
      const note: unknown = Reflect.get(item, "note")
      return typeof note === "string" ? note : ""
    })
    .filter((text) => text.trim().length > 0)
  return parts.length > 0 ? parts.join("\n\n") : undefined
}

/**
 * 「上次下好、还没装」的安装包记录。
 *
 * 只放在主进程 store 里（userData），不依赖 electron-updater 的私有字段：
 * 进程重启后要靠它把更新按钮重新点亮，也要靠它判断缓存里那份包还能不能用。
 */
interface PendingUpdate {
  version: string
  /** 安装包绝对路径。 */
  installer: string
  /** 版本说明：重启后点「安装」还能看到这次更新改了什么。 */
  notes?: string
}

const PENDING_UPDATE_KEY = "pendingUpdate"

function readPendingUpdate(): PendingUpdate | undefined {
  const value: unknown = getStore().get(PENDING_UPDATE_KEY)
  if (!value || typeof value !== "object") return undefined
  const version: unknown = Reflect.get(value, "version")
  const installer: unknown = Reflect.get(value, "installer")
  const versionText = typeof version === "string" ? version.trim() : ""
  const installerText = typeof installer === "string" ? installer.trim() : ""
  if (!versionText || !installerText) return undefined
  const notes: unknown = Reflect.get(value, "notes")
  return {
    version: versionText,
    installer: installerText,
    notes: typeof notes === "string" && notes.trim() ? notes : undefined,
  }
}

function writePendingUpdate(record: PendingUpdate | undefined) {
  if (!record) getStore().delete(PENDING_UPDATE_KEY)
  else getStore().set(PENDING_UPDATE_KEY, record)
}

function removeFile(path: string | undefined) {
  if (!path) return
  try {
    unlinkSync(path)
  } catch {
    /* 已经不在了 / 被占用：下次启动再清 */
  }
}

/** electron-updater 的更新缓存目录（安装包在它的 pending/ 子目录里）。 */
function updateCacheDir(): string {
  const configFile = join(process.resourcesPath, "app-update.yml")
  return updaterCacheDir({
    baseCachePath: systemCacheRoot(),
    dirName: readUpdaterCacheDirName(configFile),
    appName: app.getName(),
  })
}

/** 清理更新缓存：只留下 `keep` 这一份安装包，其余（含已装版本的包）全部删掉。 */
function pruneUpdateFiles(keep?: string) {
  const cacheDir = updateCacheDir()
  const result = pruneUpdateCache(cacheDir, keep)
  if (result.removed.length > 0) {
    logger.log("pruned update cache", {
      cacheDir,
      removed: result.removed.length,
      freedMB: Math.round(result.freedBytes / (1024 * 1024)),
    })
  }
}

/**
 * 丢掉"已经下好但作废"的那份更新（线上又发了更新的版本）。
 * 连同安装包一起删掉，避免磁盘上堆着几个版本的安装器。
 */
function discardDownloaded(reason: string) {
  const record = readPendingUpdate()
  logger.log("discard downloaded update", { version: downloadedVersion, reason })
  downloadedVersion = undefined
  downloadedInstaller = undefined
  installerReady = false
  writePendingUpdate(undefined)
  removeFile(record?.installer)
  pruneUpdateFiles()
}

/**
 * 启动时恢复"上次下好、还没装"的更新。
 *
 * 用户很可能下载完就放着不装，隔天再开应用——这时更新按钮必须还在，
 * 点一下就能装，而不是要重新检查一遍。
 * 反过来，如果记录里的版本已经装上了（当前版本 >= 记录版本），
 * 那份安装包就是垃圾，顺手删掉。
 */
function restorePendingUpdate() {
  const record = readPendingUpdate()
  const currentVersion = app.getVersion()
  if (!record) {
    // 没有待安装记录：缓存里剩下的都是已装版本的包，清掉。
    pruneUpdateFiles()
    return
  }
  if (!isPendingUpdateUsable(record, currentVersion) || !existsSync(record.installer)) {
    logger.log("pending update is stale, cleaning", {
      pending: record.version,
      current: currentVersion,
      exists: existsSync(record.installer),
    })
    writePendingUpdate(undefined)
    pruneUpdateFiles()
    return
  }
  logger.log("restored pending update", { version: record.version })
  downloadedVersion = record.version
  downloadedInstaller = record.installer
  releaseNotes = record.notes
  // 当前进程还没让 electron-updater 认领这个文件，安装前要先补一次（命中缓存，不重下）。
  installerReady = false
  emit({ stage: "downloaded", version: record.version })
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
    // 已经下好的包不该因为一次网络错误就"消失"：状态退回「已下载」，
    // 按钮继续亮着，用户点安装仍然可用（离线也能装）。
    if (downloadedVersion) {
      emit({ stage: "downloaded", version: downloadedVersion })
      return
    }
    emit({ stage: "error", message: error instanceof Error ? error.message : String(error) })
  })

  // 安装包落地：记下来（重启后还能点亮按钮），并清理更早版本残留的安装包。
  autoUpdater.on("update-downloaded", (info) => {
    const installer = typeof info?.downloadedFile === "string" ? info.downloadedFile : downloadedInstaller
    const version = typeof info?.version === "string" ? info.version : downloadedVersion
    if (!version || !installer) return
    installerReady = true
    downloadedVersion = version
    downloadedInstaller = installer
    writePendingUpdate({ version, installer, notes: releaseNotes })
    pruneUpdateFiles(installer)
  })

  // 上次运行下好但没装的安装包：恢复成「已下载」，重启后按钮照样亮着。
  restorePendingUpdate()
}

/**
 * 只检查，不下载。返回后 `available` 状态已经推给渲染进程，
 * 由用户决定要不要下（手动检查更新走这条路）。
 */
export async function checkUpdate(options?: { manual?: boolean }): Promise<UpdateCheckResult> {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  origin = options?.manual ? "manual" : "auto"
  // 下载途中不要再查：electron-updater 会重新发一次 update-available，
  // 状态就从「下载中」被拨回「有新版本」，进度条闪一下再回来。
  if (downloading) {
    logger.log("update check skipped: download in progress")
    return { updateAvailable: true, version: availableVersion ?? downloadedVersion }
  }
  // 连点两次"检查更新"只发一次请求。
  if (checking) return checking
  // 已经有待安装的包时，后台检查不把状态拨回「检查中」——否则那颗「更新 vX」
  // 按钮每 10 分钟闪一下。用户手动点检查时仍然给反馈。
  if (!downloadedVersion || options?.manual) emit({ stage: "checking" })
  checking = (async (): Promise<UpdateCheckResult> => {
    try {
      // 即使本地已经下好一份，也要问一次服务器：线上可能又发了新版本，
      // 这时要用最新的那份顶掉旧的（用户可能一直没装）。
      const result = await autoUpdater.checkForUpdates()
      const version = result?.updateInfo?.version
      if (result?.isUpdateAvailable === false || !version) {
        availableVersion = undefined
        // 已经下好的那份还要用（回滚、或线上版本与本地相同），它的说明也得留着。
        if (!downloadedVersion) releaseNotes = undefined
        if (downloadedVersion) {
          emit({ stage: "downloaded", version: downloadedVersion })
          return { updateAvailable: true, version: downloadedVersion, downloaded: true }
        }
        emit({ stage: "up-to-date" })
        return { updateAvailable: false }
      }
      availableVersion = version
      releaseNotes = normalizeNotes(result?.updateInfo?.releaseNotes)
      if (downloadedVersion && !shouldReplaceDownloaded(downloadedVersion, version)) {
        // 本地那份不比线上旧（同版本，或线上回滚了）：保留它，状态停在「已下载」。
        logger.log("keep downloaded update", { downloaded: downloadedVersion, latest: version })
        emit({ stage: "downloaded", version: downloadedVersion })
        return { updateAvailable: true, version: downloadedVersion, downloaded: true }
      }
      if (downloadedVersion) discardDownloaded(`superseded by ${version}`)
      emit({ stage: "available", version })
      return { updateAvailable: true, version }
    } catch (error) {
      logger.error("update check failed", error)
      // 离线时已经下好的包仍然可用，不能因为检查失败就把按钮收起来。
      if (downloadedVersion) {
        emit({ stage: "downloaded", version: downloadedVersion })
        return { updateAvailable: true, version: downloadedVersion, downloaded: true }
      }
      emit({ stage: "error", message: error instanceof Error ? error.message : String(error) })
      return { updateAvailable: false, failed: true }
    } finally {
      checking = undefined
    }
  })()
  return checking
}

/**
 * 自动检查（启动 / 定时轮询）：**查到就自己下载**。
 *
 * 定时轮询以前只检查不下载，只有启动那次会下 —— 用户要是几周不重启，
 * 安装包永远备不好，更新按钮也一直不出现，只能碰运气看到一条 toast。
 * 现在两条自动路径一致：检查结果立刻返回，下载在后台继续，
 * 进度照旧走 onUpdateStatus 推给渲染层，下完按钮才出现。
 *
 * 手动检查（设置页 / 菜单）不走这里：那条路径要停在 `available`，
 * 等用户自己点「下载」。
 */
export async function checkUpdateAuto(): Promise<UpdateCheckResult> {
  const result = await checkUpdate({ manual: false })
  if (shouldAutoDownload(result, !!downloadedVersion)) void downloadUpdate()
  return result
}

/** 下载安装包（幂等：已经在下的复用同一个 Promise）。 */
export async function downloadUpdate(): Promise<UpdateCheckResult> {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  // 本进程已经认领过这个文件，直接返回。
  if (installerReady && downloadedVersion) {
    return { updateAvailable: true, version: downloadedVersion, downloaded: true }
  }
  if (downloading) return downloading
  if (!availableVersion) {
    const checked = await checkUpdate()
    if (!checked.updateAvailable) return checked
  }
  const version = availableVersion ?? downloadedVersion
  if (!version) return { updateAvailable: false }
  if (!availableVersion) {
    // 检查失败（比如离线）但从上次运行留下了安装包：electron-updater 没有
    // updateInfo，认领不了缓存文件。返回 failed 让调用方直接用本地安装包覆盖安装。
    logger.log("no update info available, fall back to cached installer", { version })
    emit({ stage: "downloaded", version })
    return { updateAvailable: true, version, failed: true }
  }
  emit({ stage: "downloading", version, percent: 0, transferred: 0, total: 0 })
  downloading = (async (): Promise<UpdateCheckResult> => {
    try {
      // 重启后恢复的那份包没被 electron-updater 认领，这里照样调 downloadUpdate：
      // 它会先用 update-info.json 的 sha512 校验本地文件，命中就直接返回，
      // 不会真的再下一遍。
      await autoUpdater.downloadUpdate()
      downloadedVersion = version
      installerReady = true
      emit({ stage: "downloaded", version })
      logger.log("update download completed", { version })
      return { updateAvailable: true, version, downloaded: true }
    } catch (error) {
      logger.error("update download failed", error)
      // 已经下好的那份仍然完整躺在磁盘上：状态保持在「已下载」，
      // 不能让一次下载失败把用户的安装包"弄丢"。
      if (downloadedVersion) emit({ stage: "downloaded", version: downloadedVersion })
      else emit({ stage: "error", message: error instanceof Error ? error.message : String(error) })
      return { updateAvailable: true, version, failed: true }
    } finally {
      downloading = undefined
    }
  })()
  return downloading
}

export async function installUpdate(killSidecar: () => Promise<void>) {
  if (!installerReady) {
    // 没有（或本进程还没认领）安装包：先补一次。有缓存的包时这一步只做校验，不联网下载。
    const result = await downloadUpdate()
    if (!result.downloaded) {
      // 认领失败（典型场景：离线，拿不到 latest.yml）。安装包还在本地，
      // 直接用它覆盖安装 —— 用户点了「安装」就该装上，不该因为断网卡住。
      // 只对 Windows 的 NSIS 安装包这么做：其它平台的安装器和参数不一样，
      // 交给 electron-updater 自己处理更稳妥。
      if (
        process.platform === "win32" &&
        downloadedInstaller &&
        downloadedVersion &&
        existsSync(downloadedInstaller)
      ) {
        logger.log("installing from cached installer", { version: downloadedVersion })
        await killSidecar()
        launchInstaller(downloadedInstaller)
        return
      }
      logger.log("install update skipped", { reason: result.failed ? "download failed" : "no update available" })
      return
    }
  }
  logger.log("installing downloaded update", { version: downloadedVersion, installer: downloadedInstaller })
  await killSidecar()
  // isForceRunAfter=true → 给安装器加 --force-run,装完直接拉起新版本。
  // 配合安装器里的 HIDE_RUN_AFTER_FINISH(见 electron-builder.config.ts),
  // 用户不会再看到"运行 NovaWay"复选框,也不需要再确认一次。
  // 安装包本体会在下一次启动时由 restorePendingUpdate 清掉（记录里的版本
  // 已经不高于当前版本，就是"装完了"）。
  autoUpdater.quitAndInstall(false, true)
}

/**
 * 直接启动本地安装包（绕过 electron-updater 的最后兜底）。
 *
 * 参数和 NsisUpdater.doInstall 一致：`--updated` 让安装器走"覆盖升级"分支，
 * `--force-run` 装完直接拉起新版本（安装器里配了 HIDE_RUN_AFTER_FINISH）。
 */
function launchInstaller(installer: string) {
  try {
    const child = spawn(installer, ["--updated", "--force-run"], { detached: true, stdio: "ignore" })
    child.unref()
    // 安装器已经在跑，本进程让位。
    app.quit()
  } catch (error) {
    logger.error("failed to launch installer", error)
  }
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
  if (result.downloaded) {
    // 上次运行已经下好、只是还没装：不必再校验/认领一遍（那要算一次 sha512）。
    // 用户点「安装」时 installUpdate 才去认领缓存文件。
    logger.log("update already downloaded, skip download", { version: result.version })
    return
  }
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
