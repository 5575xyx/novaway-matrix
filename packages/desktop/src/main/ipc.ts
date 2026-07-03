import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, session, shell, webContents } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"

import type {
  InitStep,
  ServerReadyData,
  SqliteMigrationProgress,
  TitlebarTheme,
  WindowConfig,
  WslConfig,
} from "../preload/types"
import { getStore } from "./store"
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
import { appIconPath, setTitlebar, updateTitlebar } from "./windows"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
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
    getStore(name).set(key, value)
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
    async (_event: IpcMainInvokeEvent, opts?: { title?: string; defaultPath?: string }) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? "Save file",
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePath ?? null
    },
  )

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

  ipcMain.handle(
    "create-directory",
    async (_event: IpcMainInvokeEvent, parentPath: string, dirName: string) => {
      const targetPath = path.join(parentPath, dirName)
      await mkdir(targetPath, { recursive: true })
      return targetPath
    },
  )

  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  ipcMain.on("show-notification", (_event: IpcMainEvent, title: string, body?: string) => {
    new Notification({ title, body, icon: appIconPath() }).show()
  })

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
    if (!wc) {
      console.error("[platform:create-webview] webContents not found for id:", data.webViewId)
      return { success: false, error: "webview not found" }
    }
    console.log(`[platform:create-webview] Setting ${data.cookies.length} cookies, names:`, data.cookies.map((c) => c.name).join(", "))
    let setCount = 0
    for (const c of data.cookies) {
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
