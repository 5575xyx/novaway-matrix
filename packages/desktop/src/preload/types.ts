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

  getWindowCount: () => Promise<number>
  onSqliteMigrationProgress: (cb: (progress: SqliteMigrationProgress) => void) => () => void
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

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
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void>
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  platform: PlatformAPI
}
