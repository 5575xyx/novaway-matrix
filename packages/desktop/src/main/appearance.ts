import { app, BrowserWindow, dialog, nativeImage, net, shell } from "electron"
import type { IpcMainInvokeEvent, NativeImage } from "electron"
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { APP_NAMES, CHANNEL } from "./constants"
import { getStore } from "./store"
import type { AppAppearanceIcon, AppAppearanceState } from "../preload/types"

const NAME_KEY = "appAppearance.name"
const ICON_KEY = "appAppearance.icon"
const DEFAULT_ICON = "default"
const MAX_NAME_LENGTH = 40
const MAX_ICON_BYTES = 10 * 1024 * 1024
const ICON_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".ico"])
const root = dirname(fileURLToPath(import.meta.url))

const listeners = new Set<(state: AppAppearanceState) => void>()
let appearanceMode: "light" | "dark" = "light"
const require = createRequire(import.meta.url)
const { createCanvas, loadImage } = require("@napi-rs/canvas") as typeof import("@napi-rs/canvas")

export function defaultAppName() {
  return APP_NAMES[CHANNEL] ?? "NovaWay"
}

function builtInIconsDir() {
  if (app.isPackaged) return join(process.resourcesPath, "icons")

  const candidates = [
    process.env.DEV_RESOURCES_ROOT,
    join(root, "../../resources/icons"),
    join(process.cwd(), "resources/icons"),
    join(process.cwd(), "packages/desktop/resources/icons"),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    const dir = candidate.endsWith("icons") ? candidate : join(candidate, "icons")
    if (existsSync(dir)) return dir
  }

  return join(root, "../../resources/icons")
}

export function defaultIconPath() {
  const ext = process.platform === "win32" ? "ico" : "png"
  return join(builtInIconsDir(), `icon.${ext}`)
}

/** 用户自定义图标目录；桌面端 AI 技能也往这里落盘。 */
export function desktopIconDir() {
  const dir = join(app.getPath("userData"), "appearance", "icons")
  mkdirSync(dir, { recursive: true })
  return dir
}

function iconFilePath(id: string) {
  if (id === DEFAULT_ICON) return defaultIconPath()
  if (!id || basename(id) !== id) return undefined
  if (!ICON_EXTENSIONS.has(extname(id).toLowerCase())) return undefined
  const file = join(desktopIconDir(), id)
  return existsSync(file) ? file : undefined
}

function storedName() {
  const value = getStore().get(NAME_KEY)
  return typeof value === "string" ? value.trim() : ""
}

export function appDisplayName() {
  return storedName() || defaultAppName()
}

function selectedIconId() {
  const value = getStore().get(ICON_KEY)
  if (typeof value !== "string" || !value || value === DEFAULT_ICON) return DEFAULT_ICON
  const id = value.replace(/\.(light|dark)(?=\.[^.]+$)/i, "")
  return listIcons().some((icon) => icon.id === id) ? id : DEFAULT_ICON
}

function activeIconFile(id: string, mode = appearanceMode) {
  if (id === DEFAULT_ICON) return defaultIconPath()
  const item = listIcons().find((icon) => icon.id === id)
  if (!item) return defaultIconPath()
  const variant = mode === "dark" ? item.darkId : item.lightId
  return iconFilePath(variant ?? "") ?? iconFilePath(id) ?? iconFilePath(item.lightId ?? "") ?? iconFilePath(item.darkId ?? "") ?? defaultIconPath()
}

export function currentIconId() {
  return selectedIconId()
}

export function currentAppIcon() {
  const file = activeIconFile(selectedIconId())
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) console.warn(`应用图标加载失败: ${file}`)
  return image
}

/** 当前图标文件路径（系统通知等需要路径而非 NativeImage 的地方用）。 */
export function currentAppIconPath() {
  return activeIconFile(selectedIconId())
}

function listIcons(): AppAppearanceIcon[] {
  const names = readdirSync(desktopIconDir()).filter((name) => ICON_EXTENSIONS.has(extname(name).toLowerCase()))
  const records = new Map<string, AppAppearanceIcon>()
  for (const name of names) {
    const file = join(desktopIconDir(), name)
    try {
      const info = statSync(file)
      if (!info.isFile()) continue
      const ext = extname(name)
      const stem = name.slice(0, -ext.length)
      const variant = /\.(light|dark)$/i.exec(stem)?.[1]?.toLowerCase()
      const id = variant ? `${stem.slice(0, -(variant.length + 1))}${ext}` : name
      const record = records.get(id) ?? {
        id,
        label: id.slice(0, -extname(id).length),
        createdAt: info.mtimeMs,
      }
      records.set(id, {
        ...record,
        createdAt: Math.max(record.createdAt, info.mtimeMs),
        ...(variant === "light" ? { lightId: name } : {}),
        ...(variant === "dark" ? { darkId: name } : {}),
      })
    } catch {
      continue
    }
  }
  return [
    { id: DEFAULT_ICON, label: "default", createdAt: 0, builtIn: true },
    ...[...records.values()].sort((a, b) => b.createdAt - a.createdAt),
  ]
}

export function getAppearanceState(): AppAppearanceState {
  return {
    name: appDisplayName(),
    defaultName: defaultAppName(),
    icon: currentIconId(),
    iconData: `data:image/png;base64,${currentAppIcon().toPNG().toString("base64")}`,
    icons: listIcons(),
    mode: appearanceMode,
    iconDir: desktopIconDir(),
  }
}

function broadcast(state: AppAppearanceState) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send("app-appearance-change", state)
  }
}

export function applyAppearance() {
  const state = getAppearanceState()
  const icon = currentAppIcon()

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.setTitle(state.name)
    if (process.platform !== "darwin" && !icon.isEmpty()) win.setIcon(icon)
  }

  if (process.platform === "darwin" && !icon.isEmpty()) app.dock?.setIcon(icon)

  for (const listener of listeners) listener(state)
  broadcast(state)
  return state
}

export function onAppearanceChange(listener: (state: AppAppearanceState) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setAppAppearanceMode(mode: "light" | "dark") {
  if (appearanceMode === mode) return getAppearanceState()
  appearanceMode = mode
  return applyAppearance()
}

export function setAppName(input: string | null) {
  const name = typeof input === "string" ? input.trim().slice(0, MAX_NAME_LENGTH) : ""
  if (name) getStore().set(NAME_KEY, name)
  else getStore().delete(NAME_KEY)
  app.setName(name || defaultAppName())
  return applyAppearance()
}

export function setAppIcon(id: string) {
  if (!listIcons().some((icon) => icon.id === id)) throw new Error(`icon not found: ${id}`)
  if (id === DEFAULT_ICON) getStore().delete(ICON_KEY)
  else getStore().set(ICON_KEY, id)
  return applyAppearance()
}

function encodeIcon(image: NativeImage) {
  const size = image.getSize()
  const scale = Math.min(1, 512 / Math.max(size.width, size.height))
  if (scale >= 1) return image.toPNG()
  return image
    .resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: "best",
    })
    .toPNG()
}

function saveIcon(image: NativeImage, label?: string) {
  const id = `icon-${Date.now()}.png`
  writeFileSync(join(desktopIconDir(), id), encodeIcon(image))
  return {
    id,
    label: label?.trim() || id.slice(0, id.length - extname(id).length),
    createdAt: Date.now(),
  } satisfies AppAppearanceIcon
}

const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024

async function framedIcon(buffer: Buffer, frame: "square" | "circle") {
  const image = await loadImage(buffer)
  const size = Math.min(image.width, image.height)
  const canvas = createCanvas(size, size)
  const context = canvas.getContext("2d")
  if (frame === "circle") {
    context.beginPath()
    context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    context.clip()
  }
  context.drawImage(image, (size - image.width) / 2, (size - image.height) / 2)
  return Buffer.from(await canvas.encode("png"))
}

async function fetchImageBuffer(url: string | undefined) {
  if (!url || !/^https?:\/\//i.test(url)) throw new Error("图片地址无效")
  const response = await net.fetch(url)
  if (!response.ok) throw new Error(`下载生成的图片失败：HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** 图片生成模型产出的图标：base64 或 URL 二选一，栅格化后保存并立即应用。 */
export async function saveGeneratedImageIcon(
  source: { url?: string; base64?: string },
  label?: string,
  frame: "square" | "circle" = "square",
  mode: "light" | "dark" = appearanceMode,
  targetId?: string,
  themed = false,
) {
  const sourceBuffer = source.base64
    ? Buffer.from(source.base64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ""), "base64")
    : await fetchImageBuffer(source.url)
  if (sourceBuffer.byteLength === 0 || sourceBuffer.byteLength > MAX_GENERATED_IMAGE_BYTES) throw new Error("生成的图片数据无效")
  const buffer = await framedIcon(sourceBuffer, frame)
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) throw new Error("生成的图片无法解码，请重试")
  if (targetId && !themed) {
    const id = targetId.replace(/\.(light|dark)(?=\.[^.]+$)/i, "")
    const path = iconFilePath(id)
    if (!path) throw new Error("要编辑的图标已不存在")
    writeFileSync(path, encodeIcon(image))
    getStore().set(ICON_KEY, id)
    return applyAppearance()
  }
  if (targetId || themed) {
    const id = targetId?.replace(/\.(light|dark)(?=\.[^.]+$)/i, "") ?? `icon-${Date.now()}.png`
    const ext = extname(id)
    const stem = id.slice(0, -ext.length)
    const file = `${stem}.${mode}${ext}`
    if (targetId && !iconFilePath(id) && !listIcons().some((icon) => icon.id === id)) {
      throw new Error("要补充主题版本的图标已不存在")
    }
    writeFileSync(join(desktopIconDir(), file), encodeIcon(image))
    getStore().set(ICON_KEY, id)
    return applyAppearance()
  }
  const icon = saveIcon(image, label)
  getStore().set(ICON_KEY, icon.id)
  setAppAppearanceMode(mode)
  return applyAppearance()
}

export async function importAppIconPair(event: IpcMainInvokeEvent) {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: "依次选择浅色和深色应用图标",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "ico"] }],
      })
    : await dialog.showOpenDialog({
        title: "依次选择浅色和深色应用图标",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "ico"] }],
      })
  if (result.canceled) return null
  if (result.filePaths.length !== 2) throw new Error("请按顺序选择两张图片：浅色版、深色版")
  const images = result.filePaths.map((file) => {
    const info = statSync(file)
    if (!info.isFile() || info.size > MAX_ICON_BYTES) throw new Error("图标文件过大")
    const image = nativeImage.createFromPath(file)
    if (image.isEmpty()) throw new Error(`unsupported image: ${file}`)
    return image
  })
  const stem = `icon-${Date.now()}`
  const lightId = `${stem}.light.png`
  const darkId = `${stem}.dark.png`
  writeFileSync(join(desktopIconDir(), lightId), encodeIcon(images[0]!))
  writeFileSync(join(desktopIconDir(), darkId), encodeIcon(images[1]!))
  getStore().set(ICON_KEY, `${stem}.png`)
  return applyAppearance()
}

export async function importAppIcon(event: IpcMainInvokeEvent) {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.OpenDialogOptions = {
    title: "选择应用图标",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "ico"] }],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null

  const file = result.filePaths[0]
  const info = statSync(file)
  if (!info.isFile() || info.size > MAX_ICON_BYTES) throw new Error("icon file too large")

  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) throw new Error(`unsupported image: ${file}`)

  const icon = saveIcon(image, basename(file, extname(file)))
  getStore().set(ICON_KEY, icon.id)
  applyAppearance()
  return getAppearanceState()
}

export function deleteAppIcon(id: string) {
  if (id === DEFAULT_ICON) throw new Error("default icon cannot be removed")
  const baseId = id.replace(/\.(light|dark)(?=\.[^.]+$)/i, "")
  const item = listIcons().find((icon) => icon.id === baseId)
  const files = [item?.lightId, item?.darkId, baseId].filter((file): file is string => !!file)
  for (const file of new Set(files)) {
    const path = iconFilePath(file)
    if (path) unlinkSync(path)
  }
  if (selectedIconId() === baseId) getStore().delete(ICON_KEY)
  return applyAppearance()
}

export function getAppIconData(id: string, mode = appearanceMode) {
  const baseId = id.replace(/\.(light|dark)(?=\.[^.]+$)/i, "")
  const file = activeIconFile(baseId, mode)
  if (!file) return null
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return null
  return `data:image/png;base64,${image.toPNG().toString("base64")}`
}

export async function openAppIconDir() {
  await shell.openPath(desktopIconDir())
}
