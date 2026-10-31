import { contextBridge, ipcRenderer } from "electron"
import { toLocalFileUrl } from "../shared/protocol"
import type { ElectronAPI, InitStep, SqliteMigrationProgress } from "./types"

const api: ElectronAPI = {
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  awaitInitialization: (onStep) => {
    const handler = (_: unknown, step: InitStep) => onStep(step)
    ipcRenderer.on("init-step", handler)
    return ipcRenderer.invoke("await-initialization").finally(() => {
      ipcRenderer.removeListener("init-step", handler)
    })
  },
  getWindowConfig: () => ipcRenderer.invoke("get-window-config"),
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  getWslConfig: () => ipcRenderer.invoke("get-wsl-config"),
  setWslConfig: (config) => ipcRenderer.invoke("set-wsl-config", config),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  parseMarkdownCommand: (markdown) => ipcRenderer.invoke("parse-markdown", markdown),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  wslPath: (path, mode) => ipcRenderer.invoke("wsl-path", path, mode),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),
  marketplaceDownload: (url) => ipcRenderer.invoke("marketplace-download", url),
  marketplaceInstall: (input) => ipcRenderer.invoke("marketplace-install", input),
  marketplaceRemove: (dir) => ipcRenderer.invoke("marketplace-remove", dir),
  marketplaceGitInstall: (input) => ipcRenderer.invoke("marketplace-git-install", input),
  setKeepAwake: (enabled) => ipcRenderer.invoke("set-keep-awake", enabled),

  getWindowCount: () => ipcRenderer.invoke("get-window-count"),
  onSqliteMigrationProgress: (cb) => {
    const handler = (_: unknown, progress: SqliteMigrationProgress) => cb(progress)
    ipcRenderer.on("sqlite-migration-progress", handler)
    return () => ipcRenderer.removeListener("sqlite-migration-progress", handler)
  },
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onUpdateAvailable: (cb) => {
    const handler = (_: unknown, info: { version?: string }) => cb(info)
    ipcRenderer.on("update-available", handler)
    return () => ipcRenderer.removeListener("update-available", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },
  onNotificationClick: (cb) => {
    const handler = (_: unknown, href?: string) => cb(href)
    ipcRenderer.on("notification-click", handler)
    return () => ipcRenderer.removeListener("notification-click", handler)
  },

  createDirectory: (parentPath, dirName) => ipcRenderer.invoke("create-directory", parentPath, dirName),
  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  // 文件阅读器:读写项目目录外的本地文本文件(主进程直读,绕开服务端工作区边界)。
  readLocalFileText: (path) => ipcRenderer.invoke("read-local-file-text", path),
  readLocalFileBase64: (path) => ipcRenderer.invoke("read-local-file-base64", path),
  writeLocalFileText: (path, content) => ipcRenderer.invoke("write-local-file-text", path, content),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  copyFileToClipboard: (opts) => ipcRenderer.invoke("copy-file-to-clipboard", opts),
  writeTextToClipboard: (opts) => ipcRenderer.invoke("write-text-to-clipboard", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  showItemInFolder: (path) => ipcRenderer.invoke("show-item-in-folder", path),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body, href, showSystem) =>
    ipcRenderer.send("show-notification", title, body, href, showSystem),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  // 窗口控制（对齐 ZCode：Header 内联自绘，win32 不用原生 titleBarOverlay）
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onWindowMaximizedChange: (cb) => {
    const handler = (_: unknown, maximized: boolean) => cb(maximized)
    ipcRenderer.on("window-maximized-change", handler)
    return () => ipcRenderer.removeListener("window-maximized-change", handler)
  },
  loadingWindowComplete: () => ipcRenderer.send("loading-window-complete"),
  runUpdater: (alertOnFail) => ipcRenderer.invoke("run-updater", alertOnFail),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  toPreviewUrl: (url) => toLocalFileUrl(url),
  setPreviewInspectorOrigin: (origin) => ipcRenderer.invoke("set-preview-inspector-origin", origin),
  platform: {
    getAccounts: () => ipcRenderer.invoke("platform:get-accounts"),
    getSupportedPlatforms: () => ipcRenderer.invoke("platform:get-supported-platforms"),
    addAccount: (platformType: string) => ipcRenderer.invoke("platform:add-account", platformType),
    removeAccount: (id: string) => ipcRenderer.invoke("platform:remove-account", id),
    checkLogin: (id: string) => ipcRenderer.invoke("platform:check-login", id),
    batchCheckLogin: (ids: string[]) => ipcRenderer.invoke("platform:batch-check-login", ids),
    publish: (input: any) => ipcRenderer.invoke("platform:publish", input),
    createWebview: (webViewId: number, cookies: any[]) =>
      ipcRenderer.invoke("platform:create-webview", { webViewId, cookies }),
    destroyWebview: (webViewId: number) => ipcRenderer.invoke("platform:destroy-webview", webViewId),
    getGroups: () => ipcRenderer.invoke("platform:get-groups"),
    addGroup: (data: { name: string }) => ipcRenderer.invoke("platform:add-group", data),
    editGroup: (data: { id: number; name: string }) => ipcRenderer.invoke("platform:edit-group", data),
    deleteGroup: (id: number) => ipcRenderer.invoke("platform:delete-group", id),
    moveAccountGroup: (data: { accountId: string; groupId: number }) =>
      ipcRenderer.invoke("platform:move-account-group", data),
  },
}

contextBridge.exposeInMainWorld("api", api)
