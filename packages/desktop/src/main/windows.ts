import windowState from "electron-window-state"
import { app, BrowserWindow, net, nativeImage, nativeTheme, protocol, screen } from "electron"
import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { FloatingPanelTab, TitlebarTheme } from "../preload/types"
import { LOCAL_FILE_HOST, LOCAL_FILE_PROTOCOL, RENDERER_HOST, RENDERER_PROTOCOL } from "../shared/protocol"
import { getLogger } from "./logging"
import { INSPECTOR_PATH, INSPECTOR_SOURCE } from "./preview-inspector"
import { getStore } from "./store"

const root = dirname(fileURLToPath(import.meta.url))
const rendererRoot = join(root, "../renderer")
const clipboardWritePermission = "clipboard-sanitized-write"
const notificationPermission = "notifications"
const rendererPermissions = new Set([clipboardWritePermission, notificationPermission])

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_PROTOCOL,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
  {
    scheme: LOCAL_FILE_PROTOCOL,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
])

let backgroundColor = "#0b1020"
const titlebarThemes = new WeakMap<BrowserWindow, Partial<TitlebarTheme>>()
const titlebarOverlayWindows = new WeakSet<BrowserWindow>()
const titlebarHeight = 40

export function setBackgroundColor(color: string) {
  backgroundColor = color
}

export function getBackgroundColor(): string | undefined {
  return backgroundColor
}

function iconsDir() {
  if (app.isPackaged) return join(process.resourcesPath, "icons")

  const candidates = [
    process.env.DEV_RESOURCES_ROOT,
    join(root, "../../resources/icons"),
    join(process.cwd(), "resources/icons"),
    join(process.cwd(), "packages/desktop/resources/icons"),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    const dir = candidate.endsWith("icons") ? candidate : join(candidate, "icons")
    if (existsSync(dir)) {
      return dir
    }
  }

  return join(root, "../../resources/icons")
}

export function appIconPath() {
  const ext = process.platform === "win32" ? "ico" : "png"
  const iconPath = join(iconsDir(), `icon.${ext}`)
  return iconPath
}

export function loadAppIcon() {
  const iconPath = appIconPath()
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    console.warn(`应用图标加载失败: ${iconPath}`)
  }
  return icon
}

function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

function overlay(theme: Partial<TitlebarTheme> = {}, zoom = 1) {
  const mode = theme.mode ?? tone()
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: Math.max(titlebarHeight, Math.round(titlebarHeight * zoom)),
  }
}

export function setTitlebar(win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  titlebarThemes.set(win, theme)
  updateTitlebar(win)
}

export function updateTitlebar(win: BrowserWindow) {
  if (process.platform !== "win32") return
  if (!titlebarOverlayWindows.has(win)) return
  if (win.isDestroyed()) return
  win.setTitleBarOverlay(overlay(titlebarThemes.get(win), win.webContents.getZoomFactor()))
}

export function setDockIcon() {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(join(iconsDir(), "dock.png"))
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

export function createMainWindow() {
  const state = windowState({
    defaultWidth: 1280,
    defaultHeight: 800,
  })

  const mode = tone()
  const appIcon = loadAppIcon()
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    autoHideMenuBar: true,
    title: "NovaWay",
    icon: appIcon,
    backgroundColor,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {}),
    ...(process.platform === "win32"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const,
          titleBarOverlay: overlay({ mode }),
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  })

  if (process.platform === "win32") titlebarOverlayWindows.add(win)

  allowRendererPermissions(win)

  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders } = details
    upsertKeyValue(requestHeaders, "Access-Control-Allow-Origin", ["*"])
    callback({ requestHeaders })
  })

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders = {} } = details
    upsertKeyValue(responseHeaders, "Access-Control-Allow-Origin", ["*"])
    upsertKeyValue(responseHeaders, "Access-Control-Allow-Headers", ["*"])
    callback({ responseHeaders })
  })

  state.manage(win)
  loadWindow(win, "index.html")
  wireZoom(win)

  win.once("ready-to-show", () => {
    win.show()
  })

  return win
}

export function createLoadingWindow() {
  const mode = tone()
  const appIcon = loadAppIcon()
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    resizable: false,
    center: true,
    show: true,
    autoHideMenuBar: true,
    icon: appIcon,
    backgroundColor,
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const } : {}),
    ...(process.platform === "win32"
      ? {
          frame: false,
          titleBarStyle: "hidden" as const,
          titleBarOverlay: overlay({ mode }),
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  allowRendererPermissions(win)

  loadWindow(win, "loading.html")

  return win
}

export const FLOATING_COLLAPSED_SIZE = 144
export const FLOATING_MINIMAL_SIZE = 48
export const FLOATING_ACTIVITY_PADDING = 240
export const FLOATING_SPEECH_PADDING_TOP = 52
export const FLOATING_WINDOW_WIDTH = FLOATING_COLLAPSED_SIZE + FLOATING_ACTIVITY_PADDING * 2
export const FLOATING_WINDOW_HEIGHT = FLOATING_COLLAPSED_SIZE + FLOATING_SPEECH_PADDING_TOP
const FLOATING_EXPANDED_WIDTH = 520
const FLOATING_EXPANDED_HEIGHT = 660
const FLOATING_SKIN_MENU_WIDTH = 226
const FLOATING_SKIN_MENU_HEIGHT = 276
const FLOATING_PADDING = 16
const FLOATING_PANEL_GAP = 8
const floatingAnchors = new WeakMap<BrowserWindow, { x: number; y: number }>()

/** 宠物本体可贴到工作区边缘；外围气泡/活动留白允许伸出屏幕，不占用拖拽边界 */
export function clampFloatingPetPosition(
  position: { x: number; y: number },
  work = screen.getDisplayNearestPoint(position).workArea,
) {
  const size = FLOATING_COLLAPSED_SIZE
  const edge = FLOATING_PADDING
  const x = Math.max(work.x + edge, Math.min(position.x, work.x + work.width - size - edge))
  const y = Math.max(work.y + edge, Math.min(position.y, work.y + work.height - size - edge))
  return { x, y }
}

function clampFloatingAnchor(bounds: { x: number; y: number; width: number; height: number }) {
  const display = screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
  const next = clampFloatingPetPosition({ x: bounds.x, y: bounds.y }, display.workArea)
  return { ...bounds, x: next.x, y: next.y }
}

function saveFloatingBounds(bounds: { x: number; y: number; width: number; height: number }) {
  getStore().set("floatingWidget.bounds", bounds)
}

export function createFloatingWindow() {
  const appIcon = loadAppIcon()
  const primary = screen.getPrimaryDisplay().workAreaSize
  const saved = getStore().get("floatingWidget.bounds") as
    | { x: number; y: number; width: number; height: number }
    | undefined

  const size = FLOATING_COLLAPSED_SIZE
  const defaultBounds = {
    x: primary.width - size - FLOATING_PADDING,
    y: primary.height - size - FLOATING_PADDING,
    width: size,
    height: size,
  }
  const initial = clampFloatingAnchor(saved ? { ...saved, width: size, height: size } : defaultBounds)

  const win = new BrowserWindow({
    x: initial.x - FLOATING_ACTIVITY_PADDING,
    y: initial.y - FLOATING_SPEECH_PADDING_TOP,
    width: FLOATING_WINDOW_WIDTH,
    height: FLOATING_WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    autoHideMenuBar: true,
    icon: appIcon,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  floatingAnchors.set(win, { x: initial.x, y: initial.y })

  // 默认点击穿透：仅在命中宠物交互区时由渲染进程临时关闭穿透
  win.setIgnoreMouseEvents(true, { forward: true })

  allowRendererPermissions(win)
  loadWindow(win, "floating.html")

  return win
}

export function positionFloatingPanel(panel: BrowserWindow, mascot: BrowserWindow) {
  const mascotBounds = getFloatingAnchorBounds(mascot)
  const display = screen.getDisplayNearestPoint({
    x: mascotBounds.x + mascotBounds.width / 2,
    y: mascotBounds.y + mascotBounds.height / 2,
  })
  const work = display.workArea
  const leftSpace = mascotBounds.x - work.x
  const rightSpace = work.x + work.width - (mascotBounds.x + mascotBounds.width)
  const x =
    leftSpace >= FLOATING_EXPANDED_WIDTH + FLOATING_PANEL_GAP
      ? mascotBounds.x - FLOATING_EXPANDED_WIDTH - FLOATING_PANEL_GAP
      : rightSpace >= FLOATING_EXPANDED_WIDTH + FLOATING_PANEL_GAP
        ? mascotBounds.x + mascotBounds.width + FLOATING_PANEL_GAP
        : Math.max(
            work.x,
            Math.min(
              mascotBounds.x + mascotBounds.width - FLOATING_EXPANDED_WIDTH,
              work.x + work.width - FLOATING_EXPANDED_WIDTH,
            ),
          )
  const y = Math.max(
    work.y,
    Math.min(
      mascotBounds.y + mascotBounds.height - FLOATING_EXPANDED_HEIGHT,
      work.y + work.height - FLOATING_EXPANDED_HEIGHT,
    ),
  )
  panel.setBounds({ x, y, width: FLOATING_EXPANDED_WIDTH, height: FLOATING_EXPANDED_HEIGHT })
}

export function createFloatingPanelWindow(mascot: BrowserWindow, tab: FloatingPanelTab = "monitor") {
  const appIcon = loadAppIcon()
  const panel = new BrowserWindow({
    width: FLOATING_EXPANDED_WIDTH,
    height: FLOATING_EXPANDED_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    show: false,
    autoHideMenuBar: true,
    icon: appIcon,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  positionFloatingPanel(panel, mascot)
  allowRendererPermissions(panel)
  loadWindow(panel, `floating.html?panel=1&tab=${tab}`)
  panel.once("ready-to-show", () => {
    if (panel.isDestroyed() || mascot.isDestroyed()) return
    panel.show()
    mascot.showInactive()
  })
  panel.on("blur", () => {
    if (panel.isDestroyed() || !panel.isVisible()) return
    panel.close()
  })
  return panel
}

export function positionFloatingSkinMenu(menu: BrowserWindow, mascot: BrowserWindow) {
  const mascotBounds = getFloatingAnchorBounds(mascot)
  const display = screen.getDisplayNearestPoint({
    x: mascotBounds.x + mascotBounds.width / 2,
    y: mascotBounds.y + mascotBounds.height / 2,
  })
  const work = display.workArea
  const leftSpace = mascotBounds.x - work.x
  const rightSpace = work.x + work.width - (mascotBounds.x + mascotBounds.width)
  const x =
    leftSpace >= FLOATING_SKIN_MENU_WIDTH + FLOATING_PANEL_GAP
      ? mascotBounds.x - FLOATING_SKIN_MENU_WIDTH - FLOATING_PANEL_GAP
      : rightSpace >= FLOATING_SKIN_MENU_WIDTH + FLOATING_PANEL_GAP
        ? mascotBounds.x + mascotBounds.width + FLOATING_PANEL_GAP
        : Math.max(
            work.x,
            Math.min(
              mascotBounds.x + mascotBounds.width - FLOATING_SKIN_MENU_WIDTH,
              work.x + work.width - FLOATING_SKIN_MENU_WIDTH,
            ),
          )
  const y = Math.max(
    work.y,
    Math.min(
      mascotBounds.y + mascotBounds.height - FLOATING_SKIN_MENU_HEIGHT,
      work.y + work.height - FLOATING_SKIN_MENU_HEIGHT,
    ),
  )
  menu.setBounds({ x, y, width: FLOATING_SKIN_MENU_WIDTH, height: FLOATING_SKIN_MENU_HEIGHT })
}

export function createFloatingSkinWindow(mascot: BrowserWindow) {
  const menu = new BrowserWindow({
    width: FLOATING_SKIN_MENU_WIDTH,
    height: FLOATING_SKIN_MENU_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    show: false,
    autoHideMenuBar: true,
    icon: loadAppIcon(),
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  positionFloatingSkinMenu(menu, mascot)
  allowRendererPermissions(menu)
  loadWindow(menu, "floating.html?skin=1")
  menu.once("ready-to-show", () => {
    if (menu.isDestroyed() || mascot.isDestroyed()) return
    menu.show()
    mascot.showInactive()
  })
  menu.on("blur", () => {
    if (menu.isDestroyed() || !menu.isVisible()) return
    menu.close()
  })
  return menu
}

/** 与渲染层布局一致：宠物本体与右侧宠物屋按钮共用一个命中区域 */
export const FLOATING_HIT_WIDTH = 400
export const FLOATING_HIT_HEIGHT = 196
export const FLOATING_CONTENT_PAD = 0

/** 宠物可交互热区（屏幕坐标）。以宠物本体为中心，包含贴近身侧的“宠物屋”按钮。 */
export function getFloatingPetHitBounds(win: BrowserWindow) {
  const bounds = win.getBounds()
  const width = FLOATING_HIT_WIDTH
  const height = FLOATING_HIT_HEIGHT
  const x = Math.round(bounds.x + (bounds.width - width) / 2)
  const y = Math.round(bounds.y + bounds.height - FLOATING_CONTENT_PAD - height)
  return { x, y, width, height }
}

export function getFloatingCollapsedBounds(win: BrowserWindow) {
  const hit = getFloatingPetHitBounds(win)
  // 拖拽锚点取热区中心附近的 144 方块，保持与视觉宠物大致重合
  const x = Math.round(hit.x + (hit.width - FLOATING_COLLAPSED_SIZE) / 2)
  const y = Math.round(hit.y + (hit.height - FLOATING_COLLAPSED_SIZE) / 2)
  const anchor = floatingAnchors.get(win)
  if (anchor) return { ...anchor, width: FLOATING_COLLAPSED_SIZE, height: FLOATING_COLLAPSED_SIZE }

  floatingAnchors.set(win, { x, y })
  return { x, y, width: FLOATING_COLLAPSED_SIZE, height: FLOATING_COLLAPSED_SIZE }
}

function getFloatingAnchorBounds(win: BrowserWindow) {
  const bounds = win.getBounds()
  if (bounds.width === FLOATING_MINIMAL_SIZE && bounds.height === FLOATING_MINIMAL_SIZE) {
    return bounds
  }
  return getFloatingCollapsedBounds(win)
}

export function setFloatingCollapsedPosition(win: BrowserWindow, position: { x: number; y: number }) {
  floatingAnchors.set(win, position)
  win.setPosition(position.x - FLOATING_ACTIVITY_PADDING, position.y - FLOATING_SPEECH_PADDING_TOP)
}

export function resizeFloatingWindow(win: BrowserWindow, expanded: boolean) {
  if (win.isDestroyed()) return
  const collapsedX = getFloatingCollapsedBounds(win).x
  const collapsedY = getFloatingCollapsedBounds(win).y
  // 以图标（窗口右下角）为锚点展开/收起，保持图标在屏幕上的位置不变。
  // 展开时不做屏幕边界限制，避免靠近边缘时图标被强制偏移。
  const width = expanded ? FLOATING_EXPANDED_WIDTH : FLOATING_WINDOW_WIDTH
  const height = expanded ? FLOATING_EXPANDED_HEIGHT : FLOATING_WINDOW_HEIGHT
  const next = {
    x: expanded ? collapsedX + FLOATING_COLLAPSED_SIZE - width : collapsedX - FLOATING_ACTIVITY_PADDING,
    y: expanded ? collapsedY + FLOATING_COLLAPSED_SIZE - height : collapsedY - FLOATING_SPEECH_PADDING_TOP,
    width,
    height,
  }
  win.setBounds(next)
  if (!expanded) {
    saveFloatingBounds({
      x: collapsedX,
      y: collapsedY,
      width: FLOATING_COLLAPSED_SIZE,
      height: FLOATING_COLLAPSED_SIZE,
    })
  }
}

export function registerRendererProtocol() {
  if (protocol.isProtocolHandled(RENDERER_PROTOCOL)) return

  protocol.handle(RENDERER_PROTOCOL, (request) => {
    const url = new URL(request.url)
    if (url.host !== RENDERER_HOST) {
      return new Response("Not found", { status: 404 })
    }

    const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
    const rel = relative(rendererRoot, file)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return new Response("Not found", { status: 404 })
    }

    return net.fetch(pathToFileURL(file).toString())
  })
}

export function registerLocalFileProtocol() {
  if (protocol.isProtocolHandled(LOCAL_FILE_PROTOCOL)) return

  protocol.handle(LOCAL_FILE_PROTOCOL, async (request) => {
    const inspector = inspectorResponse(request.url)
    if (inspector) return inspector

    // 协议 handler 必须返回 Response：抛错会变成 ERR_UNEXPECTED，iframe 会反复加载
    const file = resolveLocalFileTarget(request.url)
    if (!file) {
      getLogger().warn("[oc-file] 本地文件地址无法解析", { request: request.url })
      return new Response("Not found", { status: 404 })
    }
    if (!existsSync(file)) {
      // 走 electron-log 而非 console：主进程的 console.* 不进 main.log，崩溃后拿不到终端就查不到
      getLogger().warn("[oc-file] 本地文件预览未找到", { request: request.url, file })
      return new Response("Not found", { status: 404 })
    }
    return withInspector(await net.fetch(pathToFileURL(file).toString()), file)
  })
}

/** 元素选取脚本的下发端点。返回 undefined 表示不是这个端点，继续按本地文件处理 */
function inspectorResponse(requestUrl: string): Response | undefined {
  try {
    if (new URL(requestUrl).pathname !== INSPECTOR_PATH) return undefined
  } catch {
    return undefined
  }
  return new Response(INSPECTOR_SOURCE, {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      // oc-file 对 dev server 页面是跨源的，开启 COEP 的页面没有这个头会拒绝加载
      "cross-origin-resource-policy": "cross-origin",
      "access-control-allow-origin": "*",
    },
  })
}

/** 渲染进程上报的预览地址源。只有这个源发出的文档请求才会被改写，其余 http 流量原样透传 */
let previewOrigin = ""
let previewHttpRegistered = false

export function setPreviewInspectorOrigin(origin: string) {
  previewOrigin = origin || ""
}

/** dev server 预览是跨源 iframe，本地协议塞不进去，只能在网络层改文档响应。
 *  只有渲染进程上报的那个源的文档会被改写，SSE 这类非 HTML 响应走透传分支，保持流式。
 *  handler 一旦抛错会让整个页面的 http 请求全断，所以任何异常都必须兜底回透传。 */
export function registerPreviewHttpProtocol() {
  if (previewHttpRegistered) return
  previewHttpRegistered = true

  for (const scheme of ["http", "https"]) {
    try {
      protocol.handle(scheme, handlePreviewScheme)
    } catch (error) {
      getLogger().warn("[preview] 无法接管该协议，对应预览不支持选取元素", { scheme, error })
    }
  }
}

async function handlePreviewScheme(request: Request): Promise<Response> {
  try {
    if (!previewOrigin || request.method !== "GET" || requestOrigin(request) !== previewOrigin) {
      return passThrough(request)
    }

    const response = await passThrough(request)
    if (!isHtmlResponse(response, request.url)) return response
    return rewriteHtml(response, true)
  } catch (error) {
    getLogger().warn("[preview] 预览文档改写失败，原样透传", { request: request.url, error })
    return passThrough(request)
  }
}

/** net.fetch 默认会再次触发 protocol handler，透传必须显式绕过，否则会无限递归 */
function passThrough(request: Request): Promise<Response> {
  return net.fetch(request, { bypassCustomProtocolHandlers: true })
}

function requestOrigin(request: Request): string {
  try {
    return new URL(request.url).origin
  } catch {
    return ""
  }
}

/** 改 HTML 文档：注入选取脚本。内容被改写后原来的长度与压缩头都失效，必须一并清掉。
 *  stripCsp 用于跨源预览 —— 注入脚本来自 oc-file，dev server 的 script-src 'self' 会拦掉它，
 *  文档既已改写，CSP 也必须一起去掉 */
async function rewriteHtml(response: Response, stripCsp: boolean): Promise<Response> {
  const body = Buffer.from(await response.arrayBuffer())
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  headers.delete("content-encoding")
  headers.set("cache-control", "no-store")
  if (stripCsp) {
    headers.delete("content-security-policy")
    headers.delete("content-security-policy-report-only")
  }
  return new Response(injectInspectorTag(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** 只在 HTML 文档上注入选取脚本，其它资源原样透传 */
async function withInspector(response: Response, file: string): Promise<Response> {
  if (!isHtmlResponse(response, file)) return response
  return rewriteHtml(response, false)
}

/** source 是本地文件路径或请求地址；带查询串时扩展名判断要放行分隔符 */
function isHtmlResponse(response: Response, source: string): boolean {
  if (/\.(?:x?html?)(?:[?#]|$)/i.test(source)) return true
  return (response.headers.get("content-type") ?? "").includes("text/html")
}

/** 把 <script src> 拼进文档。latin1 与字节一一对应，解码只为做大小写不敏感的
 * 标签查找，拼回去按字节，所以 GBK 这类非 UTF-8 编码的文档不会被改坏。
 * 返回 Uint8Array 而非 Buffer：Buffer 的底层 ArrayBuffer 可能被池化带偏移，不能直接当 BodyInit */
function injectInspectorTag(body: Buffer): Uint8Array<ArrayBuffer> {
  const tag = `<script src="${LOCAL_FILE_PROTOCOL}://${LOCAL_FILE_HOST}${INSPECTOR_PATH}"></script>`
  const text = body.toString("latin1")
  const splice = (offset: number): Uint8Array<ArrayBuffer> =>
    toBytes(`${text.slice(0, offset)}${tag}${text.slice(offset)}`)

  const closing = text.match(/<\/body\s*>/i)
  if (closing?.index !== undefined) return splice(closing.index)

  const opening = text.match(/<body[^>]*>/i)
  if (opening?.index !== undefined) return splice(opening.index + opening[0].length)

  return toBytes(`${tag}${text}`)
}

function toBytes(text: string): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.from(text, "latin1")
  // 必须落在新建的 ArrayBuffer 上：ArrayBufferLike（可能是池化视图）不满足 BodyInit 的类型
  const bytes = new Uint8Array(new ArrayBuffer(buffer.byteLength))
  bytes.set(buffer)
  return bytes
}

function resolveLocalFileTarget(requestUrl: string): string | undefined {
  try {
    const url = new URL(requestUrl)
    if (url.host !== LOCAL_FILE_HOST || !url.pathname) return undefined
    // URL 的 pathname 里中文等字符是百分号编码的，Windows 上 /C:/ 也不算绝对路径，
    // 直接用 resolve 会拿到字面量的 %E9%87%8D 路径。必须走 fileURLToPath 解码并识别盘符。
    return fileURLToPath(new URL(`file://${url.pathname}`))
  } catch {
    // 双斜杠、非盘符路径等畸形地址会抛 ERR_INVALID_FILE_URL_PATH，统一按未命中处理
    return undefined
  }
}

function loadWindow(win: BrowserWindow, html: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const url = devUrl ? new URL(html, devUrl).toString() : `${RENDERER_PROTOCOL}://${RENDERER_HOST}/${html}`

  const load = () => {
    void win.loadURL(url)
  }

  // 开发模式下 Vite dev server 可能还没就绪，加载失败时自动重试。
  // 必须只处理主帧：iframe（预览）失败若也触发重载，会连坐整个窗口并循环闪烁
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    if (errorCode === -3) return // ERR_ABORTED，通常是刷新或导航导致，不需要重试
    console.warn(`窗口加载失败: ${validatedURL} - ${errorDescription} (${errorCode})，500ms 后重试`)
    setTimeout(load, 500)
  })

  load()
}

function allowRendererPermissions(win: BrowserWindow) {
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      rendererPermissions.has(permission) &&
        isTrustedRendererUrl(details.requestingUrl) &&
        webContents.id === win.webContents.id,
    )
  })
  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (!rendererPermissions.has(permission)) return false
    if (webContents && webContents.id !== win.webContents.id) return false
    return isTrustedRendererUrl(details.requestingUrl) || isTrustedRendererUrl(requestingOrigin)
  })
}

function isTrustedRendererUrl(value?: string) {
  if (!value || !URL.canParse(value)) return false
  const url = new URL(value)
  if (url.protocol === `${RENDERER_PROTOCOL}:` && url.host === RENDERER_HOST) return true
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl || !URL.canParse(devUrl)) return false
  return url.origin === new URL(devUrl).origin
}

export function positionFloatingMinimal(win: BrowserWindow) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const work = display.workArea
  const size = FLOATING_MINIMAL_SIZE
  const margin = 16
  const x = work.x + work.width - size - margin
  const y = work.y + work.height - size - margin
  win.setBounds({ x, y, width: size, height: size })
  win.setAlwaysOnTop(true)
}

export function positionFloatingRestore(win: BrowserWindow, anchor?: { x: number; y: number }) {
  const size = FLOATING_COLLAPSED_SIZE
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const work = display.workArea
  const next = clampFloatingPetPosition(
    anchor ?? {
      x: work.x + work.width - size - FLOATING_PADDING,
      y: work.y + work.height - size - FLOATING_PADDING,
    },
    work,
  )
  floatingAnchors.set(win, next)
  win.setBounds({
    x: next.x - FLOATING_ACTIVITY_PADDING,
    y: next.y - FLOATING_SPEECH_PADDING_TOP,
    width: FLOATING_WINDOW_WIDTH,
    height: FLOATING_WINDOW_HEIGHT,
  })
}

function wireZoom(win: BrowserWindow) {
  win.webContents.setZoomFactor(1)
  win.webContents.on("zoom-changed", () => {
    if (win.isDestroyed()) return
    win.webContents.setZoomFactor(1)
    updateTitlebar(win)
  })
}

function upsertKeyValue(obj: Record<string, any>, keyToChange: string, value: any) {
  const keyToChangeLower = keyToChange.toLowerCase()
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === keyToChangeLower) {
      // Reassign old key
      obj[key] = value
      // Done
      return
    }
  }
  // Insert at end instead
  obj[keyToChange] = value
}
