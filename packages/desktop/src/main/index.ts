import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, BrowserWindow, Menu, Tray } from "electron"

import contextMenu from "electron-context-menu"

import type { InitStep, ServerReadyData, SqliteMigrationProgress, WslConfig } from "../preload/types"
import { checkAppExists, resolveAppPath, wslPath } from "./apps"
import { CHANNEL, FLOATING_WIDGET_ENABLED, UPDATER_ENABLED } from "./constants"
import {
  registerIpcHandlers,
  sendDeepLinks,
  sendMenuCommand,
  sendSqliteMigrationProgress,
  sendUpdateAvailable,
  setFloatingWindow,
  setMainWindow,
} from "./ipc"
import { initLogging } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import {
  getDefaultServerUrl,
  getWslConfig,
  preferAppEnv,
  setDefaultServerUrl,
  setWslConfig,
  spawnLocalServer,
  type SidecarListener,
} from "./server"
import {
  createFloatingWindow,
  createLoadingWindow,
  createMainWindow,
  loadAppIcon,
  registerLocalFileProtocol,
  registerPreviewHttpProtocol,
  registerRendererProtocol,
  setBackgroundColor,
  setDockIcon,
} from "./windows"
import { checkUpdate, checkForUpdates, installUpdate, setupAutoUpdater } from "./updater"
import { Deferred, Effect, Fiber } from "effect"

const APP_NAMES: Record<string, string> = {
  dev: "NovaWay Dev",
  beta: "NovaWay Beta",
  prod: "NovaWay",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.novaway.desktop.dev",
  beta: "ai.novaway.desktop.beta",
  prod: "ai.novaway.desktop",
}
const TEST_ONBOARDING = process.env.NovaWay_TEST_ONBOARDING === "1"

let logger: ReturnType<typeof initLogging>
let mainWindow: BrowserWindow | null = null
let floatingWindow: BrowserWindow | null = null
let tray: Tray | null = null
let server: SidecarListener | null = null
// sidecar 意外退出（Windows 上常见 0xC0000005 访问违例）时自动重启，
// 否则渲染进程会一直对着一个已经没人监听的端口轮询，控制台刷满
// net::ERR_CONNECTION_REFUSED，而且界面永远恢复不了。
let stoppingSidecar = false
let sidecarRestarts = 0
const MAX_SIDECAR_RESTARTS = 6
const SIDECAR_RESTART_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]
let isQuitting = false

const initEmitter = new EventEmitter()
let initStep: InitStep = { phase: "server_waiting" }

const pendingDeepLinks: string[] = []

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function setInitStep(step: InitStep) {
  initStep = step
  logger.log("init step", { step })
  initEmitter.emit("step", step)
}

// 由主流程在拿到 hostname/port/password 后注入：用同一个端口与密码重启 sidecar。
let relaunchSidecar: (() => Promise<void>) | undefined
let restartResetTimer: NodeJS.Timeout | undefined

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function restartSidecar(code: number) {
  if (!relaunchSidecar || stoppingSidecar || isQuitting) return
  if (sidecarRestarts >= MAX_SIDECAR_RESTARTS) {
    logger.error("sidecar crashed repeatedly, giving up", { code, attempts: sidecarRestarts })
    return
  }
  const delay = SIDECAR_RESTART_DELAYS[Math.min(sidecarRestarts, SIDECAR_RESTART_DELAYS.length - 1)]
  sidecarRestarts++
  logger.warn("restarting sidecar", { code, attempt: sidecarRestarts, delay })
  await sleep(delay)
  if (stoppingSidecar || isQuitting) return
  try {
    await relaunchSidecar()
    logger.info("sidecar restarted", { attempt: sidecarRestarts })
    // 稳定运行 60 秒后清零计数，避免偶发崩溃把配额耗光。
    if (restartResetTimer) clearTimeout(restartResetTimer)
    restartResetTimer = setTimeout(() => {
      if (server) sidecarRestarts = 0
    }, 60_000)
  } catch (error) {
    logger.error("sidecar restart failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    void restartSidecar(code)
  }
}

async function killSidecar() {
  stoppingSidecar = true
  if (!server) return
  const current = server
  server = null
  await current.stop()
}

function showMainWindow() {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function hideMainWindow() {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.hide()
}

/**
 * 把"更新已下载"交给渲染进程,用应用内的现代 toast 提示(替代老式原生对话框)。
 * 返回 true 表示已成功投递:webContents 存在且还没有开始销毁。
 *
 * 注意这里刻意不检查监听器是否已注册 —— 渲染进程的 preload 在页面加载时就会注册
 * `onUpdateAvailable`,而 IPC 消息在 webContents 上会排队直到页面处理。启动时的后台
 * 检查(不 alertOnFail)会等到主窗口创建后才跑,所以正常都能投递成功;万一渲染进程
 * 已经销毁(退出中)才回退到原生对话框。
 */
function notifyRendererUpdateReady(info: { version?: string }) {
  const win = mainWindow
  if (!win || win.isDestroyed()) return false
  const wc = win.webContents
  if (wc.isDestroyed()) return false
  sendUpdateAvailable(win, info)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return true
}

function quitApp() {
  isQuitting = true
  app.quit()
}

function createTray() {
  if (tray) return tray
  tray = new Tray(loadAppIcon())
  tray.setToolTip(APP_NAMES[CHANNEL])
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示 NovaWay",
        click: () => showMainWindow(),
      },
      {
        label: "隐藏主窗口",
        click: () => hideMainWindow(),
      },
      { type: "separator" },
      {
        label: "退出 NovaWay",
        click: () => quitApp(),
      },
    ]),
  )
  tray.on("click", () => showMainWindow())
  tray.on("double-click", () => showMainWindow())
  return tray
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.NovaWay_DISABLE_EMBEDDED_WEB_UI = "true"

  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.novaway.desktop.dev"
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `NovaWay-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.NovaWay_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(APP_NAMES[CHANNEL])
  app.setAppUserModelId(appId)
  app.setPath(
    "userData",
    onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId),
  )
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  logger = initLogging()

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("NovaWay://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    showMainWindow()
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    isQuitting = true
    void killSidecar()
  })

  app.on("will-quit", () => {
    void killSidecar()
  })

  app.on("window-all-closed", () => {})

  app.on("activate", () => {
    showMainWindow()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void killSidecar().finally(() => app.exit(0))
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData>()
  const loadingComplete = Deferred.makeUnsafe<void>()

  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    awaitInitialization: Effect.fnUntraced(
      function* (sendStep) {
        sendStep(initStep)
        const listener = (step: InitStep) => sendStep(step)
        initEmitter.on("step", listener)
        try {
          logger.log("awaiting server ready")
          const res = yield* Deferred.await(serverReady)
          logger.log("server ready", { url: res.url })
          return res
        } finally {
          initEmitter.off("step", listener)
        }
      },
      (e) => Effect.runPromise(e),
    ),
    getWindowConfig: () => ({ updaterEnabled: UPDATER_ENABLED }),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    getWslConfig: () => Promise.resolve(getWslConfig()),
    setWslConfig: (config: WslConfig) => setWslConfig(config),
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    parseMarkdown: async (markdown) => parseMarkdown(markdown),
    checkAppExists: (appName) => checkAppExists(appName),
    wslPath: async (path, mode) => wslPath(path, mode),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    loadingWindowComplete: () => Deferred.doneUnsafe(loadingComplete, Effect.void),
    runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail, killSidecar, notifyRendererUpdateReady),
    checkUpdate: async () => checkUpdate(),
    installUpdate: async () => installUpdate(killSidecar),
    setBackgroundColor: (color) => setBackgroundColor(color),
    // 窗口控制交给渲染层（Header 内联自绘，对齐 ZCode）；win32 不再使用原生 titleBarOverlay。
    minimizeWindow: () => mainWindow?.minimize(),
    toggleMaximizeWindow: () => {
      if (!mainWindow) return
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
    },
    closeWindow: () => mainWindow?.close(),
    isWindowMaximized: () => mainWindow?.isMaximized() ?? false,
  })

  yield* Effect.promise(() => app.whenReady())

  app.setAsDefaultProtocolClient("NovaWay")
  registerRendererProtocol()
  registerLocalFileProtocol()
  registerPreviewHttpProtocol()
  setDockIcon()
  createTray()
  setupAutoUpdater()

  const needsMigration = ((): boolean => {
    if (process.env.NovaWay_DB === ":memory:") return false

    const xdg = process.env.XDG_DATA_HOME
    const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share")
    return !existsSync(join(base, "novaway", "novaway.db"))
  })()
  let overlay: BrowserWindow | null = null

  const port = yield* Effect.gen(function* () {
    const fromEnv = process.env.NovaWay_PORT
    if (fromEnv) {
      const parsed = Number.parseInt(fromEnv, 10)
      if (!Number.isNaN(parsed)) return parsed
    }

    const res = yield* Deferred.make<number, unknown>()
    const server = createServer()
    server.on("error", (e) => Deferred.failSync(res, () => e))
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        Deferred.failSync(res, () => new Error("Failed to get port"))
        return
      }
      const port = address.port
      server.close(() => Effect.runSync(Deferred.succeed(res, port)))
    })

    return yield* Deferred.await(res)
  })
  const hostname = "127.0.0.1"
  const url = `http://${hostname}:${port}`
  const password = randomUUID()

  const loadingTask = yield* Effect.gen(function* () {
    logger.log("sidecar connection started", { url })

    initEmitter.on("sqlite", (progress: SqliteMigrationProgress) => {
      setInitStep({ phase: "sqlite_waiting" })
      if (overlay) sendSqliteMigrationProgress(overlay, progress)
      if (mainWindow) sendSqliteMigrationProgress(mainWindow, progress)
    })

    ensureLoopbackNoProxy()
    useEnvProxy()

    // 数据库由 sidecar 内置的驱动直接访问（见 src/database），不再需要随包的 dbx MCP server。
    // 旧的 dbx 连接库路径仍传给 sidecar：首次启动时会导入到数据库页面，避免用户重配。
    process.env.NOVAWAY_DBX_LEGACY_DB = join(app.getPath("userData"), "dbx", "dbx.db")
    // 开发环境使用系统 Node.js；打包环境使用应用内置的独立 Node.js。
    // 目前只有随包的 Playwright MCP 与插件 CLI 会用它当解释器。
    const bundledNode =
      process.platform === "win32"
        ? join(process.resourcesPath, "node", "node.exe")
        : join(process.resourcesPath, "node", "bin", "node")
    process.env.NOVAWAY_NODE_PATH = app.isPackaged ? bundledNode : "node"
    // 浏览器 MCP 随安装包分发，打包环境使用内置 Node 和系统 Chrome/Edge，
    // 避免依赖用户机器上的 npx、Node.js 或联网拉取。
    const playwrightMcpDir = app.isPackaged
      ? join(process.resourcesPath, "playwright-mcp")
      : join(app.getAppPath(), "resources", "playwright-mcp")
    const playwrightMcpCli = join(playwrightMcpDir, "node_modules", "@playwright", "mcp", "cli.js")
    if (existsSync(playwrightMcpCli)) {
      process.env.PLAYWRIGHT_MCP_SERVER_PATH = playwrightMcpCli
      process.env.PLAYWRIGHT_MCP_NODE_PATH = app.isPackaged ? bundledNode : "node"
      process.env.PLAYWRIGHT_MCP_BROWSER =
        process.env.PLAYWRIGHT_MCP_BROWSER ?? (process.platform === "win32" ? "msedge" : "chrome")
    }
    // 默认全局插件 PowersNexus 从 Gitee 安装；其 CLI 需要 Node（复用内置 Node）
    process.env.POWERSNEXUS_NODE_PATH = process.env.POWERSNEXUS_NODE_PATH ?? process.env.NOVAWAY_NODE_PATH

    logger.log("spawning sidecar", { url })

    const launch = () =>
      spawnLocalServer(hostname, port, password, {
        needsMigration,
        userDataPath: app.getPath("userData"),
        onSqliteProgress: (progress) => initEmitter.emit("sqlite", progress),
        onStdout: (message) => logger.log("sidecar stdout", { message }),
        onStderr: (message) => {
          // Windows ConPTY 的 console-list agent 在 AttachConsole 失败时会把整个栈打到
          // stderr;node-pty 对它有 5 秒超时兜底(回退成 shell pid),不影响终端功能,
          // 每次关终端刷一条纯属噪音,这里过滤掉。
          if (/conpty_console_list_agent|AttachConsole failed/u.test(message)) return
          logger.warn("sidecar stderr", { message })
        },
        onExit: (code) => {
          // 0xC0000005 = ACCESS_VIOLATION：通常是原生模块 ABI 不匹配
          // （better-sqlite3 / node-pty / keytar 用 Node 而不是 Electron 的 ABI 编译）。
          logger.warn("sidecar exited", {
            code,
            reason:
              code === 3221225477
                ? "ACCESS_VIOLATION (likely native module ABI mismatch)"
                : code === 3221225725
                  ? "STACK_BUFFER_OVERRUN"
                  : "unknown",
          })
          // 主动停止（退出 / 更新 / 重启）不处理；意外退出则按退避时间重启，
          // 端口与密码保持不变，渲染进程里已经拿到的 URL 仍然有效。
          if (stoppingSidecar || isQuitting) return
          void restartSidecar(code)
        },
      })

    const { listener, health } = yield* Effect.promise(launch)
    server = listener
    // 崩溃后由 restartSidecar 复用同一端口 + 密码重启，渲染进程里已拿到的 URL 继续有效。
    relaunchSidecar = async () => {
      const next = await launch()
      server = next.listener
      void next.health.wait.catch(() => undefined)
    }
    yield* Deferred.succeed(serverReady, {
      url,
      username: "NovaWay",
      password,
    })

    yield* Effect.promise(() => health.wait).pipe(
      Effect.timeout("30 seconds"),
      Effect.catch((e) =>
        Effect.sync(() => {
          logger.error("sidecar health check failed", e.toString())
        }),
      ),
    )

    logger.log("loading task finished")
  }).pipe(Effect.forkChild)

  if (needsMigration) {
    const show = yield* loadingTask.pipe(
      Fiber.await,
      Effect.timeout("1 second"),
      Effect.as(false),
      Effect.catch(() => Effect.succeed(true)),
    )
    if (show) {
      overlay = createLoadingWindow()
      yield* Effect.sleep("1 second")
    }
  }

  yield* Effect.timeout("120 seconds")(Fiber.await(loadingTask)).pipe(
    Effect.catch(() => {
      logger.error("Initialization timeout after 120 seconds")
      return Effect.void
    }),
  )
  setInitStep({ phase: "done" })

  if (overlay) yield* Deferred.await(loadingComplete)

  mainWindow = createMainWindow()
  setMainWindow(mainWindow)
  if (mainWindow) {
    createMenu({
      trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
      checkForUpdates: () => {
        void checkForUpdates(true, killSidecar, notifyRendererUpdateReady)
      },
      reload: () => mainWindow?.reload(),
      relaunch: () => {
        void killSidecar().finally(() => {
          app.relaunch()
          app.exit(0)
        })
      },
    })

    mainWindow.on("closed", () => {
      if (floatingWindow && !floatingWindow.isDestroyed()) {
        floatingWindow.close()
      }
      mainWindow = null
      setMainWindow(null)
    })

    mainWindow.on("close", (event) => {
      if (isQuitting) return
      event.preventDefault()
      hideMainWindow()
    })
  }

  // 悬浮窗暂时下线(FLOATING_WIDGET_ENABLED=false):不创建,主窗口关闭后也不需要带走它。
  if (FLOATING_WIDGET_ENABLED) {
    floatingWindow = createFloatingWindow()
    setFloatingWindow(floatingWindow)
    floatingWindow.on("closed", () => {
      floatingWindow = null
      setFloatingWindow(null)
    })
  }

  overlay?.close()

  // 不阻塞首屏加载;检查会在后台下载,下载完成后推给渲染进程弹应用内 toast,
  // 用户点"安装并重启"才真正安装(装完由安装器 --force-run 直接拉起新版本)。
  void checkForUpdates(false, killSidecar, notifyRendererUpdateReady)
})

Effect.runFork(main)
