import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor } from "solid-js"
import { ServerConnection } from "./server"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenFilePickerOptions = { title?: string; multiple?: boolean; accept?: string[]; extensions?: string[] }
type SaveFilePickerOptions = { title?: string; defaultPath?: string; data?: Uint8Array }
type UpdateInfo = { updateAvailable: boolean; version?: string }
export type NotificationMetadata = { sessionID?: string; requestID?: string }

export type Platform = {
  platform: "web" | "desktop"

  os?: "macos" | "windows" | "linux"

  version?: string

  openLink(url: string): void

  openPath?(path: string, app?: string): Promise<void>

  restart(): Promise<void>

  back(): void

  forward(): void

  notify(title: string, description?: string, href?: string, metadata?: NotificationMetadata): Promise<void>

  createDirectory?(parentPath: string, dirName: string): Promise<string>

  openDirectoryPickerDialog?(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>

  openFilePickerDialog?(opts?: OpenFilePickerOptions): Promise<PickerPaths>

  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  writeTextToClipboard?(text: string): Promise<boolean>

  storage?: (name?: string) => SyncStorage | AsyncStorage

  checkUpdate?(): Promise<UpdateInfo>

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
}

export type DisplayBackend = "auto" | "wayland"

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
