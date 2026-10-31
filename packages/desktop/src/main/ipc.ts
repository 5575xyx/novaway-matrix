import { execFile } from "node:child_process"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import {
  BrowserWindow,
  Notification,
  app,
  powerSaveBlocker,
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
import { appIconPath, setPreviewInspectorOrigin, setTitlebar, updateTitlebar } from "./windows"
import { getLogger } from "./logging"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
}

let mainWindowRef: BrowserWindow | null = null
const activeNotifications = new Set<Notification>()

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

export function setMainWindow(win: BrowserWindow | null) {
  mainWindowRef = win
}

/** 最大化/还原状态变化时通知渲染层切换图标。 */
export function notifyWindowMaximized(win: BrowserWindow) {
  sendWindowEvent(win, "window-maximized-change", win.isMaximized())
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
  minimizeWindow: () => void
  toggleMaximizeWindow: () => void
  closeWindow: () => void
  isWindowMaximized: () => boolean
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
  // 窗口控制：ZCode 在 Header 里内联自绘最小化/最大化/关闭，不用 Windows 原生 titleBarOverlay。
  // 最大化状态要让渲染层知道，才能切换图标（最大化↔还原）。
  ipcMain.handle("window:minimize", () => deps.minimizeWindow())
  ipcMain.handle("window:toggle-maximize", () => deps.toggleMaximizeWindow())
  ipcMain.handle("window:close", () => deps.closeWindow())
  ipcMain.handle("window:is-maximized", () => deps.isWindowMaximized())
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

  // 插件市场。
  //
  // 下载仍在主进程（渲染层受 CORS 限制）。解压/克隆/校验/记录都交给内核
  // （`packages/novaway/src/extension/marketplace.ts`），这样 Web 与 TUI 构建
  // 用同一套实现，桌面端只是转发一层。目录固定在配置目录下的 marketplace/，
  // 与内核 ExtensionLoader 的扫描根一致。
  const marketplaceRoot = () =>
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "novaway", "marketplace")

  /**
   * 调用内核 HTTP API。
   *
   * 主进程与 sidecar 在同一台机器上，直接用 `awaitInitialization` 拿到的
   * 地址和 basic auth 即可。这里不做重试：安装类请求已经在内核里做过校验，
   * 失败直接把原因抛给渲染层。
   */
  const serverFetch = async (input: {
    method: "GET" | "POST" | "DELETE"
    pathname: string
    body?: unknown
  }): Promise<unknown> => {
    const server = await deps.awaitInitialization(() => {})
    const url = new URL(input.pathname, server.url)
    const headers: Record<string, string> = {}
    if (input.body !== undefined) headers["content-type"] = "application/json"
    if (server.username && server.password) {
      headers.authorization = `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`
    }
    const response = await fetch(url, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
    const text = await response.text()
    if (!response.ok) {
      // 内核用 JSON 报错时，把 message 提出来，别把整段 JSON 丢给用户。
      let message = text
      try {
        const parsed = JSON.parse(text) as { message?: unknown; data?: { message?: unknown } }
        const candidate = parsed.message ?? parsed.data?.message
        if (typeof candidate === "string" && candidate.trim()) message = candidate
      } catch {
        // 非 JSON：保留原文
      }
      throw new Error(message || `${response.status} ${response.statusText}`)
    }
    return text ? (JSON.parse(text) as unknown) : undefined
  }
  // 与内核 `extension/marketplace.ts` 保持同一上限，避免渲染层绕过限制。
  const MAX_MARKETPLACE_BYTES = 64 * 1024 * 1024
  ipcMain.handle("marketplace-download", async (_event: IpcMainInvokeEvent, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error("unsupported marketplace url")
    const response = await fetch(url, { redirect: "follow" })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const length = Number(response.headers.get("content-length") ?? 0)
    if (length > MAX_MARKETPLACE_BYTES) throw new Error(`download too large: ${length} bytes`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_MARKETPLACE_BYTES) throw new Error(`download too large: ${buffer.byteLength} bytes`)
    return buffer.toString("base64")
  })
  // zip 包由渲染层解压（那里有 JSZip），这里只负责落盘。
  // 落盘时同时写一份 `.novaway-install.json`，内核的 list()/uninstall() 才认得出
  // 这些包，扩展页也能把它们列为「已安装」。
  ipcMain.handle(
    "marketplace-install",
    async (_event: IpcMainInvokeEvent, input: { dir: string; files: Array<{ path: string; data: string }> }) => {
      const name = input.dir.replace(/[^A-Za-z0-9._@-]/g, "_")
      const root = path.join(marketplaceRoot(), name)
      await rm(root, { recursive: true, force: true })
      await mkdir(root, { recursive: true })
      for (const file of input.files) {
        const target = path.resolve(root, file.path)
        if (target !== root && !target.startsWith(root + path.sep)) continue
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, Buffer.from(file.data, "base64"))
      }
      await writeFile(
        path.join(root, ".novaway-install.json"),
        JSON.stringify(
          {
            name: input.dir.split("@")[0] ?? name,
            kind: "zip",
            ...(input.dir.includes("@") ? { version: input.dir.split("@")[1] } : {}),
            source: "desktop",
            installedAt: Date.now(),
          },
          null,
          2,
        ),
      )
      return root
    },
  )
  // 保持唤醒：自动化任务可能在后台跑很久，系统休眠会直接掐断。
  let keepAwakeId: number | undefined
  ipcMain.handle("set-keep-awake", (_event: IpcMainInvokeEvent, enabled: boolean) => {
    if (enabled) {
      if (keepAwakeId === undefined || !powerSaveBlocker.isStarted(keepAwakeId)) {
        keepAwakeId = powerSaveBlocker.start("prevent-app-suspension")
      }
      return true
    }
    if (keepAwakeId !== undefined) {
      powerSaveBlocker.stop(keepAwakeId)
      keepAwakeId = undefined
    }
    return false
  })
  // Claude 插件市场用的是 git 仓库（整仓或子目录），没有 zip 包。
  // 克隆、校验、记录都由内核完成；这里把结果翻译成渲染层需要的形状：
  //   - skills/    → skillsPath，调用方写进 config.skills.paths
  //   - .mcp.json  → mcpServers，调用方合并进 config.mcp
  // commands/agents 不再复制到全局配置目录：内核 ExtensionLoader 会直接从
  // marketplace 目录加载它们，复制反而会产生两份互相覆盖的副本。
  ipcMain.handle(
    "marketplace-git-install",
    async (_event: IpcMainInvokeEvent, input: { name: string; url: string; ref?: string; subdir?: string }) => {
      const installed = (await serverFetch({
        method: "POST",
        pathname: "/extension/marketplace/install",
        body: {
          kind: "git",
          name: input.name,
          url: input.url,
          ref: input.ref,
          subdir: input.subdir,
        },
      })) as { root: string }

      const dir = installed.root
      const skills = path.join(dir, "skills")
      const hasSkills = await stat(skills)
        .then((info) => info.isDirectory())
        .catch(() => false)

      let mcpServers: Record<string, unknown> | undefined
      const raw = await readFile(path.join(dir, ".mcp.json"), "utf8").catch(() => undefined)
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> }
          if (parsed && typeof parsed === "object" && parsed.mcpServers) mcpServers = parsed.mcpServers
        } catch {
          // 坏掉的 .mcp.json 不应该让整个安装失败
        }
      }

      return {
        dir,
        skillsPath: hasSkills ? skills : undefined,
        mcpServers,
        // 内核直接加载这两个目录，因此不再复制；保留字段是为了兼容旧渲染层。
        commands: 0,
        agents: 0,
      }
    },
  )
  // 卸载走内核：它负责路径校验、Windows 句柄重试，以及刷新扩展注册表。
  ipcMain.handle("marketplace-remove", async (_event: IpcMainInvokeEvent, dir: string) => {
    const base = path.resolve(marketplaceRoot())
    const target = path.resolve(dir)
    if (target === base || !target.startsWith(base + path.sep)) throw new Error("invalid marketplace dir")
    const name = path.basename(target)
    await serverFetch({
      method: "DELETE",
      pathname: `/extension/marketplace/${encodeURIComponent(name)}`,
    })
    // 旧版安装会把 commands/agents 复制到全局配置目录，卸载时一并清掉，
    // 否则列表里会残留指向已删插件的条目。
    const shortName = name.split("@")[0] ?? name
    const configRoot = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "novaway")
    await rm(path.join(configRoot, "command", shortName), { recursive: true, force: true }).catch(() => {})
    await rm(path.join(configRoot, "agents", shortName), { recursive: true, force: true }).catch(() => {})
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

  // 右侧面板「文件阅读器」用:预览/编辑当前项目目录之外的本地文件。
  // 服务端文件接口有工作区边界,跨项目文件走主进程直读;只做单文件 UTF-8 文本读写。
  ipcMain.handle("read-local-file-text", async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const info = await stat(filePath)
      // 超大文件不当文本读,渲染层会直接放弃(20MB 与服务端文本读的上限对齐)。
      if (!info.isFile() || info.size > 20 * 1024 * 1024) return null
      return await readFile(filePath, "utf8")
    } catch {
      return null
    }
  })

  // 项目外 Office/PDF/图片的二进制预览:base64 直读,上限 50MB(渲染端的
  // docx/pptx/xlsx 解析器对超大文件本来就力不从心)。
  ipcMain.handle("read-local-file-base64", async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const info = await stat(filePath)
      if (!info.isFile() || info.size > 50 * 1024 * 1024) return null
      return await readFile(filePath, "base64")
    } catch {
      return null
    }
  })

  ipcMain.handle("write-local-file-text", async (_event: IpcMainInvokeEvent, filePath: string, content: string) => {
    try {
      await writeFile(filePath, content, "utf8")
      return true
    } catch {
      return false
    }
  })

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

  ipcMain.handle("show-item-in-folder", (_event: IpcMainInvokeEvent, path: string) => {
    shell.showItemInFolder(path)
    return true
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
    (_event: IpcMainEvent, title: string, body?: string, href?: string, showSystem = true) => {
      if (showSystem && Notification.isSupported()) {
        // 空白 toast 排查日志:记录每一次系统通知的入参,便于对照 Windows 通知库里的 payload
        getLogger().info("[notification] show", { title, bodyLength: body?.length ?? 0, showSystem })
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
  // 渲染进程把当前预览地址的源报上来，主进程只对这个源的 http 文档做注入改写
  ipcMain.handle("set-preview-inspector-origin", (_event, origin: string) => {
    setPreviewInspectorOrigin(typeof origin === "string" ? origin : "")
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

// 更新已下载:推给渲染进程,由应用内 toast(而非主进程原生对话框)提示用户。
export function sendUpdateAvailable(win: BrowserWindow, info: { version?: string }) {
  win.webContents.send("update-available", info)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}
