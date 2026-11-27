import { createSimpleContext } from "@novaway/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor } from "solid-js"
import { ServerConnection } from "./server"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenFilePickerOptions = { title?: string; multiple?: boolean; accept?: string[]; extensions?: string[] }
type SaveFilePickerOptions = { title?: string; defaultPath?: string; data?: Uint8Array }
type UpdateInfo = { updateAvailable: boolean; version?: string; downloaded?: boolean; failed?: boolean }
export type NotificationMetadata = { sessionID?: string; requestID?: string }
export type InstalledEditor = { id: string; name: string; icon?: string }
/** 能打开 Office 文档的本机应用（Word/Excel/PPT/WPS）；icon 是真实应用图标的 dataURL。 */
export type OfficeApp = { id: string; name: string; extensions: string[]; icon?: string }
export type UpdateReadyEvent = { version?: string }

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

/** 桌面应用外观（图标 / 名称）当前状态。 */
export type AppAppearanceState = {
  name: string
  defaultName: string
  icon: string
  iconData?: string
  icons: AppAppearanceIcon[]
  iconDir: string
  mode?: "light" | "dark"
}

/**
 * 自动更新的状态机（桌面端主进程推过来）。
 * `available` 在检查完成时立刻出现，下载进度随后单独推。
 */
export type UpdateStatus = (
  | { stage: "idle" }
  | { stage: "checking" }
  | { stage: "available"; version: string }
  | { stage: "downloading"; version: string; percent: number; transferred: number; total: number }
  | { stage: "downloaded"; version: string }
  | { stage: "up-to-date" }
  | { stage: "error"; message?: string }
) & {
  /** 谁触发的：auto = 启动/定时检查，manual = 用户点「检查更新」。 */
  origin?: "auto" | "manual"
  /** 本次更新的说明（打包时写进 latest.yml 的 releaseNotes）。 */
  notes?: string
}

export type Platform = {
  platform: "web" | "desktop"

  os?: "macos" | "windows" | "linux"

  version?: string

  openLink(url: string): void

  openPath?(path: string, app?: string): Promise<void>

  /** 在系统文件管理器中显示该文件/文件夹(选中);仅桌面端实现。 */
  showItemInFolder?(path: string): Promise<boolean>

  /** 解析桌面端应用的真实可执行文件路径，用于系统图标和启动兜底。 */
  resolveAppPath?(appName: string): Promise<string | null>

  getInstalledEditors?(): Promise<InstalledEditor[]>
  /** 本机已安装、能打开 Office 文档的应用（按 extensions 匹配文件类型）。 */
  getOfficeApps?(): Promise<OfficeApp[]>

  /** 取任意本地文件的系统关联图标（dataURL）；失败/不可用返回 null。 */
  getFileIcon?(path: string): Promise<string | null>

  openInEditor?(
    editorId: string,
    path: string,
    kind: "file" | "directory",
    connection: ServerConnection.Any,
  ): Promise<boolean>

  restart(): Promise<void>

  back(): void

  forward(): void

  notify(title: string, description?: string, href?: string, metadata?: NotificationMetadata): Promise<void>

  createDirectory?(parentPath: string, dirName: string): Promise<string>

  openDirectoryPickerDialog?(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>

  openFilePickerDialog?(opts?: OpenFilePickerOptions): Promise<PickerPaths>

  /** 读项目目录外的本地文本文件(桌面端主进程直读);不可用/失败返回 null。 */
  readLocalFileText?(path: string): Promise<string | null>

  /** 读项目目录外的本地二进制文件为 base64(Office/PDF/图片预览);失败返回 null。 */
  readLocalFileBase64?(path: string): Promise<string | null>

  /** 把本机 file:// 地址转换成桌面预览协议地址。 */
  toPreviewUrl?(url: string): string

  /** 写回本地文本文件(桌面端);成功返回 true。 */
  writeLocalFileText?(path: string, content: string): Promise<boolean>

  /** 写回本地二进制文件(桌面端,base64 载荷):PDF 拆分等一次产出多个文件时用。 */
  writeLocalFileBase64?(path: string, data: string, expectedBaselineSha256?: string): Promise<boolean>

  /** 把自包含 HTML 打印成 PDF 写到 filePath(桌面端);成功返回 true。 */
  printToPdf?(input: { html: string; filePath: string; landscape?: boolean }): Promise<boolean>

  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  writeTextToClipboard?(text: string): Promise<boolean>

  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** manual=true 表示用户点的「检查更新」，false/省略是后台轮询。 */
  checkUpdate?(options?: { manual?: boolean }): Promise<UpdateInfo>

  /** 下载安装包（手动检查更新后用户点「下载」）。进度走 onUpdateStatus。 */
  downloadUpdate?(): Promise<UpdateInfo>

  /** 更新状态流：检查中 / 有新版本 / 下载中 percent / 已下载。 */
  onUpdateStatus?(cb: (status: UpdateStatus) => void): () => void

  /** 拉一次当前状态，窗口重载或切页面后对齐用。 */
  updateStatus?(): Promise<UpdateStatus>

  /** 「启动时检查更新」写回主进程（否则关掉开关，启动检查照跑）。 */
  setAutoUpdate?(enabled: boolean): void | Promise<void>

  /** 桌面端后台下载完更新时由主进程主动推送,应用内据此弹现代 toast(替代原生对话框)。 */
  onUpdateReady?(cb: (event: UpdateReadyEvent) => void): () => void

  updateAndRestart?(): Promise<void>

  fetch?: typeof fetch

  getDefaultServer?(): Promise<ServerConnection.Key | null>

  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  getWslEnabled?(): Promise<boolean>

  setWslEnabled?(config: boolean): Promise<void> | void

  getDisplayBackend?(): Promise<DisplayBackend | null> | DisplayBackend | null

  setDisplayBackend?(backend: DisplayBackend): Promise<void>

  parseMarkdown?(markdown: string): Promise<string>

  webviewZoom?: Accessor<number>

  checkAppExists?(appName: string): Promise<boolean>

  readClipboardImage?(): Promise<File | null>

  /** 桌面应用外观（图标 / 名称）自定义；仅桌面端实现。 */
  getAppAppearance?(): Promise<AppAppearanceState>
  setAppName?(name: string | null): Promise<AppAppearanceState>
  setAppIcon?(id: string): Promise<AppAppearanceState>
  importAppIcon?(): Promise<AppAppearanceState | null>
  importAppIconPair?(): Promise<AppAppearanceState | null>
  deleteAppIcon?(id: string): Promise<AppAppearanceState>
  getAppIconData?(id: string, mode?: "light" | "dark"): Promise<string | null>
  generateAppIconFromImage?(
    source: AppAppearanceImageSource,
    label?: string,
    frame?: "square" | "circle",
    mode?: "light" | "dark",
    targetId?: string,
    themed?: boolean,
  ): Promise<AppAppearanceState>
  setAppAppearanceMode?(mode: "light" | "dark"): Promise<AppAppearanceState>
  openAppIconDir?(): Promise<void>
  onAppAppearanceChange?(cb: (state: AppAppearanceState) => void): () => void
}

export type DisplayBackend = "auto" | "wayland"

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
