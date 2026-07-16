import { contextBridge, ipcRenderer } from "electron"
import type { ElectronAPI, FloatingAgentState, InitStep, SqliteMigrationProgress } from "./types"

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

  getFloatingAgentState: () => ipcRenderer.invoke("get-floating-agent-state"),
  setFloatingAgent: (name) => ipcRenderer.invoke("set-floating-agent", name),
  setFloatingPetSkin: (skin) => ipcRenderer.invoke("set-floating-pet-skin", skin),
  markFloatingNotificationsRead: (ids) => ipcRenderer.invoke("mark-floating-notifications-read", ids),
  clearFloatingNotifications: () => ipcRenderer.invoke("clear-floating-notifications"),
  openFloatingNotification: (id) => ipcRenderer.invoke("open-floating-notification", id),
  resolveFloatingNotification: (input) => ipcRenderer.invoke("resolve-floating-notification", input),
  onFloatingAgentChange: (cb) => {
    const handler = (_: unknown, state: FloatingAgentState) => cb(state)
    ipcRenderer.on("floating-agent-change", handler)
    return () => ipcRenderer.removeListener("floating-agent-change", handler)
  },
  onFloatingExpandedChange: (cb) => {
    const handler = (_: unknown, expanded: boolean) => cb(expanded)
    ipcRenderer.on("floating-expanded-change", handler)
    return () => ipcRenderer.removeListener("floating-expanded-change", handler)
  },
  onFloatingPanelTabChange: (cb) => {
    const handler = (_: unknown, tab: "monitor" | "notifications") => cb(tab)
    ipcRenderer.on("floating-panel-tab-change", handler)
    return () => ipcRenderer.removeListener("floating-panel-tab-change", handler)
  },
  onFloatingSkinMenuChange: (cb) => {
    const handler = (_: unknown, visible: boolean) => cb(visible)
    ipcRenderer.on("floating-skin-menu-change", handler)
    return () => ipcRenderer.removeListener("floating-skin-menu-change", handler)
  },
  floatingWidgetReady: () => ipcRenderer.send("floating-widget-ready"),
  showFloatingWidget: () => ipcRenderer.invoke("show-floating-widget"),
  onFloatingVisibilityChange: (cb) => {
    const handler = (_: unknown, visible: boolean) => cb(visible)
    ipcRenderer.on("floating-visibility-change", handler)
    return () => ipcRenderer.removeListener("floating-visibility-change", handler)
  },
  updateFloatingAgentState: (state) => ipcRenderer.invoke("update-floating-agent-state", state),
  beginFloatingWidgetDrag: (pointerX, pointerY) => ipcRenderer.send("begin-floating-widget-drag", pointerX, pointerY),
  moveFloatingWidget: (pointerX, pointerY) => ipcRenderer.send("move-floating-widget", pointerX, pointerY),
  saveFloatingWidgetBounds: () => ipcRenderer.invoke("save-floating-widget-bounds"),
  setFloatingExpanded: (expanded) => ipcRenderer.invoke("set-floating-expanded", expanded),
  toggleFloatingSkinMenu: () => ipcRenderer.invoke("toggle-floating-skin-menu"),

  createDirectory: (parentPath, dirName) => ipcRenderer.invoke("create-directory", parentPath, dirName),
  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  copyFileToClipboard: (opts) => ipcRenderer.invoke("copy-file-to-clipboard", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body, href, showSystem, context) =>
    ipcRenderer.send("show-notification", title, body, href, showSystem, context),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  loadingWindowComplete: () => ipcRenderer.send("loading-window-complete"),
  runUpdater: (alertOnFail) => ipcRenderer.invoke("run-updater", alertOnFail),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
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
