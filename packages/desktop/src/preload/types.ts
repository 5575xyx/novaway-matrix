export type InitStep = { phase: "server_waiting" } | { phase: "sqlite_waiting" } | { phase: "done" }

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type SqliteMigrationProgress = { type: "InProgress"; value: number } | { type: "Done" }

export type WslConfig = { enabled: boolean }

export type InstalledEditor = { id: string; name: string; icon?: string }

/** 能打开 Office 文档的本机应用（Word/Excel/PPT/WPS）；icon 是真实应用图标的 dataURL。 */
export type OfficeApp = { id: string; name: string; extensions: string[]; icon?: string }

/**
 * 自动更新的状态机（主进程是唯一事实来源）。
 *
 * `available` 在检查完成时立刻发出，不等下载 —— 否则用户点「检查更新」后
 * 要等安装包下完才有任何反馈。
 *
 * `origin` 区分「谁触发的」：启动/定时检查（auto）只在下完后才让更新按钮出现，
 * 用户手动点「检查更新」（manual）则从「检查中」开始就显示在侧栏。
 * `notes` 是本次更新的说明，来自打包时写入 latest.yml 的 releaseNotes
 * （见 packages/desktop/release-notes.md）。
 */
export type UpdateStatus = (
  | { stage: "idle" }
  | { stage: "checking" }
  | { stage: "available"; version: string }
  | { stage: "downloading"; version: string; percent: number; transferred: number; total: number }
  | { stage: "downloaded"; version: string }
  | { stage: "up-to-date" }
  | { stage: "error"; message?: string }
) & { origin?: "auto" | "manual"; notes?: string }

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
}

export type WindowConfig = {
  updaterEnabled: boolean
}

/** Desktop-managed NovaWay directories shown in Data Management. */
export type ResourceLocationId = "data" | "config" | "cache" | "temp" | "logs"
export type ResourceLocation = {
  id: ResourceLocationId
  label: string
  path: string
  defaultPath: string
  size: number
  fileCount: number
  lastModified: number | null
  exists: boolean
}
export type ResourceReport = {
  generatedAt: number
  totalSize: number
  locations: ResourceLocation[]
}
export type ResourceCleanupConfig = {
  enabled: boolean
  interval: "daily" | "weekly"
  olderThanDays: number
  lastRunAt: number | null
}
export type ResourceCleanupResult = {
  deletedFiles: number
  deletedBytes: number
}

/** 一个可选的应用图标（内置默认 + 用户导入/生成的资源）。 */
export type AppAppearanceIcon = {
  id: string
  label: string
  createdAt: number
  builtIn?: boolean
  lightId?: string
  darkId?: string
}

/** 图片生成模型产出的图标来源：远程 URL 或 base64（可带 data: 前缀），二选一。 */
export type AppAppearanceImageSource = {
  url?: string
  base64?: string
}

/** 应用外观当前状态：名称、当前图标、可选图标列表、图标目录。 */
export type AppAppearanceState = {
  name: string
  defaultName: string
  icon: string
  iconData?: string
  icons: AppAppearanceIcon[]
  iconDir: string
  mode?: "light" | "dark"
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

export type PublishKind = "video" | "image_text" | "article"

export type PublishStatus = "pending" | "running" | "success" | "failed" | "unsupported" | "cancelled"

export interface PublishBatchInput {
  kind: PublishKind
  title: string
  description: string
  filePaths: string[]
  tags?: string[]
  scheduleTime?: number
}

export interface PublishAccountResult {
  accountId: string
  platform: string
  nickname: string
  status: PublishStatus
  progress: number
  message: string
  url?: string
  error?: string
  warnings?: string[]
  updatedAt: number
}

export interface PublishBatch {
  id: string
  input: PublishBatchInput
  results: PublishAccountResult[]
  startedAt: number
  finishedAt?: number
}

export interface PublishPrecheckIssue {
  rule: string
  level: "error" | "warning" | "hint"
  message: string
  evidence?: string
  fix?: string
}

export interface PublishPrecheckResult {
  ok: boolean
  issues: PublishPrecheckIssue[]
}

export interface PublishProgressEvent {
  batchId: string
  result: PublishAccountResult
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
  checkLogin: (id: string) => Promise<{ valid: boolean; nickname?: string; avatar?: string }>
  batchCheckLogin: (ids: string[]) => Promise<{ id: string; valid: boolean; nickname?: string; avatar?: string }[]>
  /** 只补昵称/头像，不改登录状态。不传 ids 表示全部账号。 */
  refreshProfiles: (ids?: string[]) => Promise<{ accounts: PlatformAccount[] }>
  publish: (input: { accountId: string; publishInput: PlatformPublishInput }) => Promise<PlatformPublishResult>
  /** 一站式发布：多账号（可跨平台）一次提交，进度走 onPublishProgress。 */
  publishBatch: (input: { accountIds: string[]; input: PublishBatchInput }) => Promise<{ ok: boolean; error?: string }>
  /** 发布前预检：长度、素材形态、极限词/引流词，先给人看一遍再发。 */
  publishPrecheck: (input: { platforms: string[]; input: PublishBatchInput }) => Promise<PublishPrecheckResult>
  cancelPublish: () => Promise<{ ok: boolean }>
  getPublishBatches: () => Promise<PublishBatch[]>
  onPublishProgress: (cb: (event: PublishProgressEvent) => void) => () => void
  onPublishFinished: (cb: (batch: PublishBatch | { error: string }) => void) => () => void
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
  /** 启动时系统递进来的文档路径（Finder 双击 / 「打开方式」）；取走即清空。 */
  consumeInitialOpenFiles: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  getNativeSpeechBackends: () => Promise<
    Array<{
      name: string
      description: string
      kind: string
      deviceType: string
      deviceId: string | null
      memoryTotal: number
      memoryFree: number
      index: number | null
    }>
  >
  getNativeSpeechModels: () => Promise<
    Array<{
      id: string
      label: string
      family: string
      languages: readonly string[]
      sizeBytes: number
      fileName: string
      downloadUrl: string
      path: string
      downloaded: boolean
      bytes: number
    }>
  >
  downloadNativeSpeechModel: (id: string) => Promise<string>
  onNativeSpeechDownloadProgress: (callback: (event: { id: string; progress: number }) => void) => () => void
  transcribeNativeSpeech: (
    id: string,
    pcm: Float32Array,
    language: string,
  ) => Promise<{ text: string; device: { name: string; kind: string; deviceType: string } }>
  startNativeSpeechStream: (
    id: string,
    language: string,
  ) => Promise<{ streaming: boolean; device: { name: string; kind: string; deviceType: string } }>
  feedNativeSpeechStream: (
    id: string,
    pcm: Float32Array,
  ) => Promise<{ full: string; committed: string; tentative: string }>
  stopNativeSpeechStream: (
    id: string,
  ) => Promise<{ text: string; committed: string; tentative: string }>
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

  /** 应用外观（图标 / 名称）自定义。 */
  getAppAppearance: () => Promise<AppAppearanceState>
  setAppAppearanceMode: (mode: "light" | "dark") => Promise<AppAppearanceState>
  setAppName: (name: string | null) => Promise<AppAppearanceState>
  setAppIcon: (id: string) => Promise<AppAppearanceState>
  importAppIcon: () => Promise<AppAppearanceState | null>
  importAppIconPair: () => Promise<AppAppearanceState | null>
  deleteAppIcon: (id: string) => Promise<AppAppearanceState>
  getAppIconData: (id: string, mode?: "light" | "dark") => Promise<string | null>
  generateAppIconFromImage: (
    source: AppAppearanceImageSource,
    label?: string,
    frame?: "square" | "circle",
    mode?: "light" | "dark",
    targetId?: string,
    themed?: boolean,
  ) => Promise<AppAppearanceState>
  openAppIconDir: () => Promise<void>
  onAppAppearanceChange: (cb: (state: AppAppearanceState) => void) => () => void

  getWindowCount: () => Promise<number>
  onSqliteMigrationProgress: (cb: (progress: SqliteMigrationProgress) => void) => () => void
  onMenuCommand: (cb: (id: string) => void) => () => void
  onUpdateAvailable: (cb: (info: { version?: string }) => void) => () => void
  /** 更新状态流：检查中 → 有新版本 → 下载中(percent) → 已下载。主进程是唯一事实来源。 */
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void
  /** 运行中从系统打开的文档（再次双击 / 拖到图标上）。 */
  onOpenFiles: (cb: (paths: string[]) => void) => () => void
  onNotificationClick: (cb: (href?: string) => void) => () => void

  createDirectory: (parentPath: string, dirName: string) => Promise<string>
  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  /** Inspect and safely clean NovaWay-owned runtime resources. */
  getResourceReport: () => Promise<ResourceReport>
  setResourceLocation: (id: ResourceLocationId, path: string) => Promise<ResourceReport>
  getResourceCleanupConfig: () => Promise<ResourceCleanupConfig>
  setResourceCleanupConfig: (config: Omit<ResourceCleanupConfig, "lastRunAt">) => Promise<ResourceCleanupConfig>
  cleanResources: (olderThanDays: number) => Promise<ResourceCleanupResult>
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
  /** 把一份自包含 HTML 打印成 PDF 并写到 filePath；仅桌面端。 */
  printToPdf: (payload: { html: string; filePath: string; landscape?: boolean }) => Promise<boolean>
  /** 写回本地文本文件(utf-8);成功返回 true。 */
  writeLocalFileText: (path: string, content: string) => Promise<boolean>
  writeLocalFileBase64: (path: string, data: string, expectedBaselineSha256?: string) => Promise<boolean>
  saveFilePicker: (opts?: { title?: string; defaultPath?: string; data?: Uint8Array }) => Promise<string | null>
  copyFileToClipboard: (opts?: { url?: string; filename?: string }) => Promise<boolean>
  writeTextToClipboard: (opts?: { text?: string }) => Promise<boolean>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  showItemInFolder: (path: string) => Promise<boolean>
  getInstalledEditors: () => Promise<InstalledEditor[]>
  getOfficeApps: () => Promise<OfficeApp[]>
  getFileIcon: (path: string) => Promise<string | null>
  openInEditor: (editorId: string, path: string, kind: "file" | "directory") => Promise<boolean>
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
  checkUpdate: (options?: { manual?: boolean }) => Promise<{
    updateAvailable: boolean
    version?: string
    downloaded?: boolean
    failed?: boolean
  }>
  /** 下载安装包（手动检查更新里用户点「下载」时调用）。进度通过 onUpdateStatus 推回。 */
  downloadUpdate: () => Promise<{
    updateAvailable: boolean
    version?: string
    downloaded?: boolean
    failed?: boolean
  }>
  /** 拉一次当前更新状态（窗口重载 / 切页面后同步用）。 */
  updateStatus: () => Promise<UpdateStatus>
  /** 「启动时检查更新」开关，持久化到主进程。 */
  setAutoUpdate: (enabled: boolean) => Promise<void> | void
  installUpdate: () => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  // file:// 地址转成本地文件预览协议，iframe 才能嵌入本机 HTML
  toPreviewUrl: (url: string) => string
  // 上报预览地址的源：主进程只对它的 http 文档注入元素选取脚本
  setPreviewInspectorOrigin: (origin: string) => Promise<void>
  platform: PlatformAPI
}
