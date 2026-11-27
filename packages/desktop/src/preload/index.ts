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
  consumeInitialOpenFiles: () => ipcRenderer.invoke("consume-initial-open-files"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  getWslConfig: () => ipcRenderer.invoke("get-wsl-config"),
  setWslConfig: (config) => ipcRenderer.invoke("set-wsl-config", config),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  getNativeSpeechBackends: () => ipcRenderer.invoke("native-speech:backends"),
  getNativeSpeechModels: () => ipcRenderer.invoke("native-speech:models"),
  downloadNativeSpeechModel: (id) => ipcRenderer.invoke("native-speech:download", id),
  onNativeSpeechDownloadProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: { id: string; progress: number }) => callback(value)
    ipcRenderer.on("native-speech:download-progress", listener)
    return () => ipcRenderer.removeListener("native-speech:download-progress", listener)
  },
  transcribeNativeSpeech: (id, pcm, language) => ipcRenderer.invoke("native-speech:transcribe", id, pcm, language),
  startNativeSpeechStream: (id, language) => ipcRenderer.invoke("native-speech:stream-start", id, language),
  feedNativeSpeechStream: (id, pcm) => ipcRenderer.invoke("native-speech:stream-feed", id, pcm),
  stopNativeSpeechStream: (id) => ipcRenderer.invoke("native-speech:stream-stop", id),
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

  getAppAppearance: () => ipcRenderer.invoke("app-appearance:get"),
  setAppName: (name) => ipcRenderer.invoke("app-appearance:set-name", name),
  setAppIcon: (id) => ipcRenderer.invoke("app-appearance:set-icon", id),
  importAppIcon: () => ipcRenderer.invoke("app-appearance:import-icon"),
  importAppIconPair: () => ipcRenderer.invoke("app-appearance:import-icon-pair"),
  setAppAppearanceMode: (mode) => ipcRenderer.invoke("app-appearance:set-mode", mode),
  deleteAppIcon: (id) => ipcRenderer.invoke("app-appearance:delete-icon", id),
  getAppIconData: (id, mode) => ipcRenderer.invoke("app-appearance:icon-data", id, mode),
  generateAppIconFromImage: (source, label, frame, mode, targetId, themed) =>
    ipcRenderer.invoke("app-appearance:generate-image-icon", { url: source.url, base64: source.base64 }, label, frame, mode, targetId, themed),
  openAppIconDir: () => ipcRenderer.invoke("app-appearance:open-icon-dir"),
  onAppAppearanceChange: (cb) => {
    const handler = (_: unknown, state: import("./types").AppAppearanceState) => cb(state)
    ipcRenderer.on("app-appearance-change", handler)
    return () => ipcRenderer.removeListener("app-appearance-change", handler)
  },

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
  onUpdateStatus: (cb) => {
    const handler = (_: unknown, status: import("./types").UpdateStatus) => cb(status)
    ipcRenderer.on("update-status", handler)
    return () => ipcRenderer.removeListener("update-status", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },
  onOpenFiles: (cb) => {
    const handler = (_: unknown, paths: string[]) => cb(paths)
    ipcRenderer.on("open-files", handler)
    return () => ipcRenderer.removeListener("open-files", handler)
  },
  onNotificationClick: (cb) => {
    const handler = (_: unknown, href?: string) => cb(href)
    ipcRenderer.on("notification-click", handler)
    return () => ipcRenderer.removeListener("notification-click", handler)
  },

  createDirectory: (parentPath, dirName) => ipcRenderer.invoke("create-directory", parentPath, dirName),
  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  getResourceReport: () => ipcRenderer.invoke("resource:get-report"),
  setResourceLocation: (id, path) => ipcRenderer.invoke("resource:set-location", id, path),
  getResourceCleanupConfig: () => ipcRenderer.invoke("resource:get-cleanup-config"),
  setResourceCleanupConfig: (config) => ipcRenderer.invoke("resource:set-cleanup-config", config),
  cleanResources: (olderThanDays) => ipcRenderer.invoke("resource:clean", olderThanDays),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  // 文件阅读器:读写项目目录外的本地文本文件(主进程直读,绕开服务端工作区边界)。
  readLocalFileText: (path) => ipcRenderer.invoke("read-local-file-text", path),
  readLocalFileBase64: (path) => ipcRenderer.invoke("read-local-file-base64", path),
  printToPdf: (payload) => ipcRenderer.invoke("print-to-pdf", payload),
  writeLocalFileText: (path, content) => ipcRenderer.invoke("write-local-file-text", path, content),
  writeLocalFileBase64: (path, data, expectedBaselineSha256) =>
    ipcRenderer.invoke("write-local-file-base64", path, data, expectedBaselineSha256),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  copyFileToClipboard: (opts) => ipcRenderer.invoke("copy-file-to-clipboard", opts),
  writeTextToClipboard: (opts) => ipcRenderer.invoke("write-text-to-clipboard", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  showItemInFolder: (path) => ipcRenderer.invoke("show-item-in-folder", path),
  getInstalledEditors: () => ipcRenderer.invoke("get-installed-editors"),
  getOfficeApps: () => ipcRenderer.invoke("get-office-apps"),
  getFileIcon: (path) => ipcRenderer.invoke("get-file-icon", path),
  openInEditor: (editorId, path, kind) => ipcRenderer.invoke("open-in-editor", editorId, path, kind),
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
  // 窗口控制（Header 内联自绘，win32 不用原生 titleBarOverlay）
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
  checkUpdate: (options) => ipcRenderer.invoke("check-update", options),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  updateStatus: () => ipcRenderer.invoke("update:status"),
  setAutoUpdate: (enabled) => ipcRenderer.invoke("update:auto-enabled", enabled),
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
    refreshProfiles: (ids?: string[]) => ipcRenderer.invoke("platform:refresh-profiles", ids),
    publish: (input: any) => ipcRenderer.invoke("platform:publish", input),
    publishBatch: (input) => ipcRenderer.invoke("platform:publish-batch", input),
    publishPrecheck: (input) => ipcRenderer.invoke("platform:publish-precheck", input),
    cancelPublish: () => ipcRenderer.invoke("platform:cancel-publish"),
    getPublishBatches: () => ipcRenderer.invoke("platform:get-publish-batches"),
    onPublishProgress: (cb) => {
      const handler = (_: unknown, event: import("./types").PublishProgressEvent) => cb(event)
      ipcRenderer.on("platform:publish-progress", handler)
      return () => ipcRenderer.removeListener("platform:publish-progress", handler)
    },
    onPublishFinished: (cb) => {
      const handler = (_: unknown, batch: import("./types").PublishBatch | { error: string }) => cb(batch)
      ipcRenderer.on("platform:publish-finished", handler)
      return () => ipcRenderer.removeListener("platform:publish-finished", handler)
    },
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
