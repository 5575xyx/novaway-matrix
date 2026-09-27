import { app, dialog } from "electron"
import pkg from "electron-updater"
import { UPDATER_ENABLED } from "./constants"
import { initLogging } from "./logging"

const logger = initLogging()
const { autoUpdater } = pkg
let downloadedVersion: string | undefined

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
}

export async function checkUpdate() {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  if (downloadedVersion) {
    logger.log("using downloaded update", { version: downloadedVersion })
    return { updateAvailable: true, version: downloadedVersion }
  }
  logger.log("checking for updates", {
    currentVersion: app.getVersion(),
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
  })
  try {
    const result = await autoUpdater.checkForUpdates()
    const updateInfo = result?.updateInfo
    logger.log("update metadata fetched", {
      releaseVersion: updateInfo?.version ?? null,
      releaseDate: updateInfo?.releaseDate ?? null,
      releaseName: updateInfo?.releaseName ?? null,
      files: updateInfo?.files?.map((file) => file.url) ?? [],
    })
    const version = result?.updateInfo?.version
    if (result?.isUpdateAvailable === false || !version) {
      logger.log("no update available", {
        reason: "provider returned no newer version",
      })
      return { updateAvailable: false }
    }
    logger.log("update available", { version })
    await autoUpdater.downloadUpdate()
    downloadedVersion = version
    logger.log("update download completed", { version })
    return { updateAvailable: true, version }
  } catch (error) {
    logger.error("update check failed", error)
    return { updateAvailable: false, failed: true }
  }
}

export async function installUpdate(killSidecar: () => Promise<void>) {
  if (downloadedVersion) {
    logger.log("installing downloaded update", {
      version: downloadedVersion,
    })
    await killSidecar()
    // isForceRunAfter=true → 给安装器加 --force-run,装完直接拉起新版本。
    // 配合安装器里的 HIDE_RUN_AFTER_FINISH(见 electron-builder.config.ts),
    // 用户不会再看到"运行 NovaWay"复选框,也不需要再确认一次。
    autoUpdater.quitAndInstall(false, true)
    return
  }

  const result = await checkUpdate()
  if (!result.updateAvailable) {
    logger.log("install update skipped", {
      reason: result.failed ? "update check failed" : "no update available",
    })
    return
  }
  logger.log("installing downloaded update", {
    version: result.version ?? null,
  })
  await killSidecar()
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
) {
  if (!UPDATER_ENABLED) return
  logger.log("checkForUpdates invoked", { alertOnFail })
  const result = await checkUpdate()
  if (!result.updateAvailable) {
    if (result.failed) {
      logger.log("no update decision", { reason: "update check failed" })
      if (!alertOnFail) return
      await dialog.showMessageBox({
        type: "error",
        message: "Update check failed.",
        title: "Update Error",
      })
      return
    }

    logger.log("no update decision", { reason: "already up to date" })
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: "You're up to date.",
      title: "No Updates",
    })
    return
  }

  // 更新已下载:优先让应用内渲染进程用现代 toast 提示(带"安装并重启/稍后"),
  // 与设置页里手动检查更新时的提示样式保持一致。只有主窗口不存在/已销毁
  // (例如启动早期或没有界面)时才退回原生对话框。
  if (notify?.({ version: result.version })) {
    logger.log("update ready delegated to renderer", { version: result.version ?? null })
    return
  }

  const response = await dialog.showMessageBox({
    type: "info",
    message: `Update ${result.version ?? ""} downloaded. Restart now?`,
    title: "Update Ready",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  logger.log("update prompt response", {
    version: result.version ?? null,
    restartNow: response.response === 0,
  })
  if (response.response === 0) {
    await installUpdate(killSidecar)
  }
}
