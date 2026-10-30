export type InitStep = { phase: "server_waiting" } | { phase: "sqlite_waiting" } | { phase: "done" }

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type SqliteMigrationProgress = { type: "InProgress"; value: number } | { type: "Done" }

export type WslConfig = { enabled: boolean }

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
}

export type WindowConfig = {
  updaterEnabled: boolean
}

export interface PlatformAccount {
  id: string
  platform: string
  uid: string
  account: string
  nickname: string
  avatar: string
  cookies: string
  token: string
  loginTime: number
  status: "valid" | "expired" | "login_failed"
  fansCount: number
  readCount: number
  likeCount: number
  collectCount: number
  forwardCount: number
  commentCount: number
  workCount: number
  income: number
  abnormalStatus: Record<string, any> | null
  groupId: number
  lastStatsTime: number | null
}

export interface PlatformAccountGroup {
  id: number
  name: string
  rank: number
  proxyIp: string
  proxyOpen: boolean
}

export interface PlatformPublishInput {
  type: "video" | "image_text" | "article"
  title: string
  description: string
  filePaths?: string[]
  tags?: string[]
  scheduleTime?: number
}

export interface PlatformPublishResult {
  success: boolean
  platformPostId?: string
  error?: string
  url?: string
}

export interface ElectronCookie {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
}

export interface PlatformAPI {
  getAccounts: () => Promise<PlatformAccount[]>
  getSupportedPlatforms: () => Promise<{ id: string; name: string }[]>
  addAccount: (platformType: string) => Promise<{ success: boolean; account?: PlatformAccount; error?: string }>
  removeAccount: (id: string) => Promise<{ success: boolean }>
  checkLogin: (id: string) => Promise<{ valid: boolean }>
  batchCheckLogin: (ids: string[]) => Promise<{ id: string; valid: boolean }[]>
  publish: (input: { accountId: string; publishInput: PlatformPublishInput }) => Promise<PlatformPublishResult>
  createWebview: (webViewId: number, cookies: ElectronCookie[]) => Promise<{ success: boolean; error?: string }>
  destroyWebview: (webViewId: number) => Promise<{ success: boolean }>
  getGroups: () => Promise<PlatformAccountGroup[]>
  addGroup: (data: { name: string }) => Promise<PlatformAccountGroup>
  editGroup: (data: { id: number; name: string }) => Promise<{ success: boolean }>
  deleteGroup: (id: number) => Promise<{ success: boolean }>
  moveAccountGroup: (data: { accountId: string; groupId: number }) => Promise<{ success: boolean }>
}

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: (onStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig>
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  parseMarkdownCommand: (markdown: string) => Promise<string>
  checkAppExists: (appName: string) => Promise<boolean>
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>

  /** 下载插件市场 zip（主进程无 CORS 限制），返回 base64。 */
  marketplaceDownload: (url: string) => Promise<string>
  /** 把渲染层解压后的文件写入配置目录，返回安装目录绝对路径。 */
  marketplaceInstall: (input: { dir: string; files: Array<{ path: string; data: string }> }) => Promise<string>
  /** 删除已安装的插件目录。 */
  marketplaceRemove: (dir: string) => Promise<void>

  /** 从 git 仓库安装插件（Claude 市场用），返回可用目录。 */
  marketplaceGitInstall: (input: { name: string; url: string; ref?: string; subdir?: string }) => Promise<{
    dir: string
    skillsPath?: string
    mcpServers?: Record<string, unknown>
    commands: number
    agents: number
  }>
  /** 保持系统唤醒（电源阻断）；返回当前是否生效。 */
  setKeepAwake: (enabled: boolean) => Promise<boolean>
  keepAwakeEnabled?: boolean

  getWindowCount: () => Promise<number>
  onSqliteMigrationProgress: (cb: (progress: SqliteMigrationProgress) => void) => () => void
  onMenuCommand: (cb: (id: string) => void) => () => void
  onUpdateAvailable: (cb: (info: { version?: string }) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void
  onNotificationClick: (cb: (href?: string) => void) => () => void

  createDirectory: (parentPath: string, dirName: string) => Promise<string>
  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    accept?: string[]
    extensions?: string[]
  }) => Promise<string | string[] | null>
  /** 读项目目录外的本地文本文件(utf-8);文件不存在/过大/非文件返回 null。 */
  readLocalFileText: (path: string) => Promise<string | null>
  /** 读项目目录外的本地二进制文件为 base64(Office/PDF/图片预览);失败返回 null。 */
  readLocalFileBase64: (path: string) => Promise<string | null>
  /** 写回本地文本文件(utf-8);成功返回 true。 */
  writeLocalFileText: (path: string, content: string) => Promise<boolean>
  saveFilePicker: (opts?: { title?: string; defaultPath?: string; data?: Uint8Array }) => Promise<string | null>
  copyFileToClipboard: (opts?: { url?: string; filename?: string }) => Promise<boolean>
  writeTextToClipboard: (opts?: { text?: string }) => Promise<boolean>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  showItemInFolder: (path: string) => Promise<boolean>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string, href?: string, showSystem?: boolean) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
  onWindowMaximizedChange: (cb: (maximized: boolean) => void) => () => void
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void>
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  // file:// 地址转成本地文件预览协议，iframe 才能嵌入本机 HTML
  toPreviewUrl: (url: string) => string
  // 上报预览地址的源：主进程只对它的 http 文档注入元素选取脚本
  setPreviewInspectorOrigin: (origin: string) => Promise<void>
  platform: PlatformAPI
}
