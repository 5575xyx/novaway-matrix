/**
 * 极简 Chrome DevTools Protocol 客户端。
 *
 * 为什么不用 playwright-core：服务端跑在 Bun 上，而 playwright 的浏览器启动走
 * `--remote-debugging-pipe`（Bun 不支持额外 fd），`connectOverCDP` 用的 ws 实现
 * 在 Bun 下也握手超时 —— 结果是浏览器工具永远返回"不可用"。这里直接用 Bun 自带的
 * WebSocket 说 CDP，只实现我们需要的动作，保证开发态和打包态都能用本机 Chrome。
 */
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void }
type Listener = (params: any, sessionId?: string) => void

class Connection {
  private nextID = 0
  private pending = new Map<number, Pending>()
  private listeners = new Map<string, Set<Listener>>()
  private closed = false

  constructor(private socket: WebSocket) {
    socket.onmessage = (event) => {
      let message: any
      try {
        message = JSON.parse(typeof event.data === "string" ? event.data : "")
      } catch {
        return
      }
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message ?? "CDP 调用失败"))
        else pending.resolve(message.result)
        return
      }
      if (typeof message.method !== "string") return
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId)
    }
    socket.onclose = () => {
      this.closed = true
      for (const [, pending] of this.pending) pending.reject(new Error("浏览器连接已断开"))
      this.pending.clear()
    }
  }

  static open(url: string, timeoutMs = 20_000) {
    return new Promise<Connection>((resolve, reject) => {
      const socket = new WebSocket(url)
      const timer = setTimeout(() => reject(new Error("连接浏览器超时")), timeoutMs)
      socket.onopen = () => {
        clearTimeout(timer)
        resolve(new Connection(socket))
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error("无法连接浏览器调试端口"))
      }
    })
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error("浏览器连接已断开"))
    const id = ++this.nextID
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
    })
  }

  on(method: string, listener: Listener) {
    const set = this.listeners.get(method) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(method, set)
    return () => set.delete(listener)
  }

  close() {
    try {
      this.socket.close()
    } catch {
      /* 已经断开 */
    }
  }
}

/** 一条 page session：所有动作都通过 flatten 后的 sessionId 发给目标页。 */
export class CdpPage {
  private subs: Array<() => void> = []

  constructor(
    private connection: Connection,
    private sessionId: string,
  ) {}

  send<T = any>(method: string, params: Record<string, unknown> = {}) {
    return this.connection.send<T>(method, params, this.sessionId)
  }

  on(method: string, listener: Listener) {
    const raw = this.connection.on(method, (params, sessionId) => {
      // 页面级事件带的是 flatten 后的 sessionId，必须按 session 过滤，
      // 否则同一次连接里别的标签页的事件会串进来。
      if (sessionId !== this.sessionId) return
      listener(params)
    })
    this.subs.push(raw)
    return raw
  }

  async enable() {
    await this.send("Page.enable")
    await this.send("Runtime.enable")
    await this.send("Network.enable")
    await this.send("DOM.enable")
  }

  async navigate(url: string, timeoutMs = 30_000) {
    const loaded = new Promise<void>((resolve) => {
      const off = this.on("Page.loadEventFired", () => {
        off()
        resolve()
      })
      setTimeout(() => {
        off()
        resolve()
      }, timeoutMs)
    })
    const result = await this.send<{ errorText?: string }>("Page.navigate", { url })
    if (result?.errorText) throw new Error(result.errorText)
    await loaded
  }

  async evaluate<T = any>(expression: string) {
    const result = await this.send<{
      result: { value?: T }
      exceptionDetails?: { text?: string; exception?: { description?: string } }
    }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (result?.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "页面脚本执行失败",
      )
    }
    return result?.result?.value as T
  }

  async title() {
    return (await this.evaluate<string>("document.title")) ?? ""
  }

  async currentUrl() {
    return (await this.evaluate<string>("location.href")) ?? ""
  }

  async screenshot(fullPage: boolean) {
    if (!fullPage) {
      const shot = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png" })
      return Buffer.from(shot.data, "base64")
    }
    const metrics = await this.send<{ cssContentSize: { width: number; height: number } }>("Page.getLayoutMetrics")
    const shot = await this.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: Math.ceil(metrics.cssContentSize.width),
        height: Math.ceil(metrics.cssContentSize.height),
        scale: 1,
      },
    })
    return Buffer.from(shot.data, "base64")
  }

  /** 整页 HTML → PDF（Chromium 自带的打印管线，不需要额外的 PDF 引擎）。 */
  async printToPdf(options: { landscape?: boolean; printBackground?: boolean; scale?: number } = {}) {
    const result = await this.send<{ data: string }>("Page.printToPDF", {
      landscape: options.landscape === true,
      printBackground: options.printBackground !== false,
      scale: options.scale ?? 1,
      preferCSSPageSize: true,
    })
    return Buffer.from(result.data, "base64")
  }

  /**
   * viewport 用 CSS 像素声明，截图按 `deviceScaleFactor` 倍采样。
   *
   * 默认 2 倍：1 倍截图在 HiDPI 屏幕上被放大显示（预览弹窗、消息卡片都会），
   * 用户看到的就是"点开一片糊"。2 倍后图片的物理像素 ≥ 显示像素，缩放只剩缩小。
   */
  async setViewport(width: number, height: number, deviceScaleFactor = 2) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile: false,
    })
  }

  async accessibility() {
    const tree = await this.send<{
      nodes: Array<{ role?: { value?: string }; name?: { value?: string }; ignored?: boolean }>
    }>("Accessibility.getFullAXTree")
    return (tree?.nodes ?? [])
      .filter((node) => !node.ignored && node.role?.value)
      .map((node) => (node.role?.value ?? "") + (node.name?.value ? ' "' + node.name.value + '"' : ""))
      .join(String.fromCharCode(10))
  }

  async clickRef(ref: string) {
    const element = elementExpression(ref)
    const ok = await this.evaluate<boolean>(
      "(() => { const el = " +
        element +
        "; if (!el) return false;" +
        " el.scrollIntoView({ block: 'center', inline: 'center' }); el.click(); return true })()",
    )
    if (!ok) throw new Error("页面上找不到元素 " + ref)
  }

  async fillRef(ref: string, value: string) {
    const element = elementExpression(ref)
    const ok = await this.evaluate<boolean>(
      "(() => { const el = " +
        element +
        "; if (!el) return false;" +
        " const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;" +
        " const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;" +
        " el.focus();" +
        " if (setter) setter.call(el, " +
        JSON.stringify(value) +
        "); else el.value = " +
        JSON.stringify(value) +
        ";" +
        " el.dispatchEvent(new Event('input', { bubbles: true }));" +
        " el.dispatchEvent(new Event('change', { bubbles: true })); return true })()",
    )
    if (!ok) throw new Error("页面上找不到元素 " + ref)
  }

  async press(key: string, ref?: string) {
    if (ref) {
      const ok = await this.evaluate<boolean>(
        "(() => { const el = " + elementExpression(ref) + "; if (!el) return false; el.focus(); return true })()",
      )
      if (!ok) throw new Error("页面上找不到元素 " + ref)
    }
    const special: Record<string, { key: string; code: string; windowsVirtualKeyCode: number }> = {
      Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
      Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
      Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
      Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
      Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
    }
    const parts = key
      .split("+")
      .map((item) => item.trim())
      .filter(Boolean)
    const head = parts[parts.length - 1] ?? ""
    const modifiers = parts.slice(0, -1).map((item) => item.toLowerCase())
    const modifierMask =
      (modifiers.includes("alt") ? 1 : 0) |
      (modifiers.includes("control") || modifiers.includes("ctrl") ? 2 : 0) |
      (modifiers.includes("meta") ? 4 : 0) |
      (modifiers.includes("shift") ? 8 : 0)
    const info = special[head] ?? {
      key: head,
      code: "Key" + head.toUpperCase(),
      windowsVirtualKeyCode: head.toUpperCase().charCodeAt(0),
    }
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: modifierMask, ...info })
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: modifierMask, ...info })
  }

  dispose() {
    for (const off of this.subs) off()
    this.subs = []
  }
}

/** `document.querySelector` 表达式：selector 里的引号要正确转义，否则会拼出裸变量名。 */
function elementExpression(ref: string) {
  const selector = "[data-nv-ref=" + JSON.stringify(ref) + "]"
  return "document.querySelector(" + JSON.stringify(selector) + ")"
}

export type CdpSession = {
  page: CdpPage
  /** 同浏览器的另一个标签页（PDF 打印等一次性任务用），用完必须 dispose。 */
  newPage: (viewport?: { width: number; height: number }) => Promise<{ page: CdpPage; dispose: () => Promise<void> }>
  close: () => Promise<void>
}

/** 读取 Chrome 的 DevTools 端点：`--remote-debugging-port=0` 会把 ws 地址打在 stderr。 */
function endpointFromStderr(child: ChildProcess, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("浏览器启动超时")), timeoutMs)
    const onData = (chunk: Buffer) => {
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(chunk.toString())
      if (!match) return
      clearTimeout(timer)
      child.stderr?.off("data", onData)
      resolve(match[1])
    }
    child.stderr?.on("data", onData)
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error("浏览器进程提前退出（code " + code + "）"))
    })
  })
}

/** 本机可用的 Chrome/Edge 可执行文件。 */
export function findChrome() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH
  const candidates: string[] = []
  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:/Program Files"
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)"
    const localAppData = process.env["LOCALAPPDATA"] ?? ""
    candidates.push(
      path.join(programFiles, "Google/Chrome/Application/chrome.exe"),
      path.join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
      path.join(localAppData, "Google/Chrome/Application/chrome.exe"),
      path.join(programFiles, "Microsoft/Edge/Application/msedge.exe"),
      path.join(programFilesX86, "Microsoft/Edge/Application/msedge.exe"),
    )
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    )
  } else {
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
      for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        if (dir) candidates.push(path.join(dir, name))
      }
    }
  }
  return candidates.find((candidate) => fs.existsSync(candidate))
}

export type ConnectOptions = {
  /** 已运行浏览器的调试地址（http 或 ws） */
  endpoint?: string
}

/**
 * 拿一条可用的 page。
 *
 * 优先连外部浏览器（BROWSER_CDP_URL），否则自己拉起一个隔离的 headless Chrome。
 * 自己拉起的浏览器随会话一起关闭；连外部的不关（那是用户的浏览器）。
 */
export async function connect(options: ConnectOptions = {}): Promise<CdpSession> {
  let child: ChildProcess | undefined
  let endpoint = options.endpoint

  if (!endpoint) {
    if (process.env.BROWSER_ALLOW_LAUNCH === "0") {
      throw new Error("已用 BROWSER_ALLOW_LAUNCH=0 禁止启动浏览器；请改为设置 BROWSER_CDP_URL 指向已有浏览器")
    }
    const binary = findChrome()
    if (!binary) {
      throw new Error("没有找到可用的 Chrome/Edge：请安装 Chrome，或用 BROWSER_CDP_URL 指向已有浏览器的调试端口")
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "novaway-browser-"))
    child = spawn(
      binary,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-extensions",
        "--hide-scrollbars",
        "--mute-audio",
        "--window-size=1440,900",
        "--remote-debugging-port=0",
        "--user-data-dir=" + profile,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    )
    endpoint = await endpointFromStderr(child, 25_000)
  } else if (!endpoint.startsWith("ws://") && !endpoint.startsWith("wss://")) {
    const version = await fetch(new URL("/json/version", endpoint)).then((res) => res.json())
    endpoint = version?.webSocketDebuggerUrl
    if (!endpoint) throw new Error("调试端口没有返回 webSocketDebuggerUrl")
  }

  const connection = await Connection.open(endpoint)
  /** 在同一个浏览器里开一个新标签页：PDF / 打印这类一次性任务不能占用验证用的页面。 */
  const openPage = async (viewport = { width: 1440, height: 900 }) => {
    const { targetId } = await connection.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })
    const attached = await connection.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    })
    const page = new CdpPage(connection, attached.sessionId)
    await page.enable()
    await page.setViewport(viewport.width, viewport.height)
    return {
      page,
      dispose: async () => {
        page.dispose()
        try {
          await connection.send("Target.closeTarget", { targetId })
        } catch {
          /* 目标已关闭 */
        }
      },
    }
  }

  const main = await openPage()
  const page = main.page
  const newPage = openPage

  const close = async () => {
    await main.dispose()
    connection.close()
    child?.kill()
  }
  return { page, newPage, close }
}
