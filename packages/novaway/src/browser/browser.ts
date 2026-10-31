import path from "node:path"
import { randomUUID } from "node:crypto"
import { InstanceState } from "@/effect/instance-state"
import { NodeFileSystem } from "@effect/platform-node"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { connect, type CdpSession } from "./cdp"
import { redactSecrets, redactUrl } from "./redact"

export type SnapshotRef = {
  ref: string
  role: string
  name: string
  tag: string
}

type State = {
  session?: CdpSession
  console: string[]
  network: Array<{ method: string; url: string; status?: number }>
}

export class BrowserError extends Schema.TaggedErrorClass<BrowserError>()("BrowserError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export interface Interface {
  readonly navigate: (url: string) => Effect.Effect<{ url: string; title: string }, BrowserError>
  readonly setViewport: (width: number, height: number) => Effect.Effect<void, BrowserError>
  readonly snapshot: () => Effect.Effect<
    {
      url: string
      title: string
      text: string
      bodyText: string
      refs: SnapshotRef[]
      overflow: boolean
      focusVisible: boolean
    },
    BrowserError
  >
  readonly click: (ref: string) => Effect.Effect<void, BrowserError>
  readonly fill: (ref: string, value: string) => Effect.Effect<void, BrowserError>
  readonly press: (key: string, ref?: string) => Effect.Effect<void, BrowserError>
  readonly screenshot: (fullPage: boolean) => Effect.Effect<{ path: string; dataURL: string }, BrowserError>
  readonly printToPdf: (input: {
    target: string
    html?: string
    landscape?: boolean
    printBackground?: boolean
  }) => Effect.Effect<Uint8Array, BrowserError>
  readonly console: () => Effect.Effect<string[], BrowserError>
  readonly network: () => Effect.Effect<Array<{ method: string; url: string; status?: number }>, BrowserError>
  readonly accessibility: () => Effect.Effect<string, BrowserError>
  readonly status: () => Effect.Effect<{ active: boolean }, BrowserError>
  readonly close: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Browser") {}

function browserError(code: string, message: string) {
  return new BrowserError({ code, message: redactSecrets(message) })
}

/**
 * 生成页面快照。
 *
 * 元素用 `data-nv-ref` 标在 DOM 上而不是留句柄：一次导航/刷新后旧句柄就失效了，
 * 而属性会随页面一起消失，天然不会指错元素。
 */
const SNAPSHOT_SCRIPT = `(() => {
  document.querySelectorAll("[data-nv-ref]").forEach((el) => el.removeAttribute("data-nv-ref"))
  const nodes = document.querySelectorAll('a[href],button,input,textarea,select,summary,[role],[tabindex]:not([tabindex="-1"]),[contenteditable="true"]')
  const refs = []
  let index = 0
  for (const el of nodes) {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    if (rect.width <= 0 || rect.height <= 0) continue
    if (style.visibility === "hidden" || style.display === "none") continue
    const ref = "e" + ++index
    el.setAttribute("data-nv-ref", ref)
    const name = (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      (el.textContent || "").replace(/\s+/g, " ").trim()
    ).slice(0, 120)
    refs.push({ ref, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || el.tagName.toLowerCase(), name })
  }
  const active = document.activeElement
  const focusVisible =
    !active || active === document.body
      ? true
      : (() => {
          const rect = active.getBoundingClientRect()
          const style = getComputedStyle(active)
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
        })()
  return {
    text: (document.body ? document.body.innerText : "").slice(0, 2000000),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    focusVisible,
    refs,
  }
})()`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const state = yield* InstanceState.make<State>(
      Effect.fn("Browser.state")(function* () {
        const value: State = { console: [], network: [] }
        yield* Effect.addFinalizer(() => closeState(value))
        return value
      }),
    )

    const getSession = Effect.fnUntraced(function* () {
      const current = yield* InstanceState.get(state)
      if (current.session) return current.session
      const session = yield* Effect.tryPromise({
        try: () =>
          connect({
            endpoint: process.env.BROWSER_CDP_URL || undefined,
          }),
        catch: (cause) =>
          browserError("BROWSER_UNAVAILABLE", cause instanceof Error ? cause.message : "Browser 初始化失败"),
      })
      current.session = session
      session.page.on("Runtime.consoleAPICalled", (params: any) => {
        const text = (params?.args ?? [])
          .map((arg: any) => arg?.value ?? arg?.description ?? "")
          .filter((value: unknown) => value !== "")
          .join(" ")
        if (!text) return
        current.console.push(redactSecrets("[" + (params?.type ?? "log") + "] " + text))
        if (current.console.length > 1000) current.console.shift()
      })
      session.page.on("Runtime.exceptionThrown", (params: any) => {
        const detail = params?.exceptionDetails
        const text = detail?.exception?.description ?? detail?.text ?? "未捕获异常"
        current.console.push(redactSecrets("[error] " + text))
        if (current.console.length > 1000) current.console.shift()
      })
      session.page.on("Network.requestWillBeSent", (params: any) => {
        current.network.push({ method: params?.request?.method ?? "GET", url: redactUrl(params?.request?.url ?? "") })
        if (current.network.length > 2000) current.network.shift()
      })
      session.page.on("Network.responseReceived", (params: any) => {
        const url = redactUrl(params?.response?.url ?? "")
        const item = current.network.findLast((entry) => entry.url === url && entry.status === undefined)
        if (item) item.status = params?.response?.status
      })
      return session
    })

    const getPage = Effect.fnUntraced(function* () {
      return (yield* getSession()).page
    })

    const usePage = <A>(run: (page: CdpSession["page"]) => Promise<A>, message: string) =>
      Effect.gen(function* () {
        const page = yield* getPage()
        return yield* Effect.tryPromise({
          try: () => run(page),
          catch: (cause) => browserError("BROWSER_ACTION_FAILED", cause instanceof Error ? cause.message : message),
        })
      })

    const clearTelemetry = Effect.fnUntraced(function* () {
      const current = yield* InstanceState.get(state)
      current.console.length = 0
      current.network.length = 0
    })

    // 本地产物验证不必先起 dev server：绝对路径 / file:// 直接交给浏览器打开。
    // 和右栏内置预览共用同一套归一化口径（Windows 盘符先于协议判断）。
    const targetUrl = (input: string): string | undefined => {
      const normalized = input.trim().replace(/\\/g, "/")
      if (!normalized) return undefined
      if (/^[a-zA-Z]:\//.test(normalized)) return new URL("file:///" + normalized).toString()
      try {
        const parsed = new URL(normalized)
        if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString()
        if (parsed.protocol === "file:" && parsed.pathname.length > 1) return parsed.toString()
        return undefined
      } catch {
        if (normalized.startsWith("/")) return new URL("file://" + normalized).toString()
        return undefined
      }
    }

    const setViewport = Effect.fn("Browser.setViewport")(function* (width: number, height: number) {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        return yield* browserError("BROWSER_ACTION_FAILED", "Browser viewport 必须是正整数")
      }
      yield* clearTelemetry()
      yield* usePage((page) => page.setViewport(width, height), "Browser viewport 设置失败")
    })

    const navigate = Effect.fn("Browser.navigate")(function* (url: string) {
      const target = targetUrl(url)
      if (!target) {
        return yield* browserError("BROWSER_ACTION_FAILED", "Browser 仅允许 http/https 或本地 file:// URL")
      }
      yield* clearTelemetry()
      return yield* usePage(async (page) => {
        await page.navigate(target)
        return { url: await page.currentUrl(), title: await page.title() }
      }, "Browser 导航失败")
    })

    const close = Effect.fn("Browser.close")(function* () {
      yield* closeState(yield* InstanceState.get(state))
    })

    /**
     * HTML / URL → PDF。
     *
     * 走 Chromium 自带的 `Page.printToPDF`，不需要额外的 PDF 引擎；用独立标签页，
     * 不打断当前的验证页面。`html` 存在时先落到临时文件再打开，这样相对资源
     * （图片、字体）仍能按所在目录解析。
     */
    const printToPdf = Effect.fn("Browser.printToPdf")(function* (input: {
      target: string
      html?: string
      landscape?: boolean
      printBackground?: boolean
    }) {
      const session = yield* getSession()
      const target = input.html ? undefined : targetUrl(input.target)
      if (!input.html && !target) {
        return yield* browserError("BROWSER_ACTION_FAILED", "PDF 仅支持 http/https、本地 file:// 或直接给 HTML")
      }
      return yield* Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => session.newPage({ width: 1280, height: 900 }),
          catch: (cause) => browserError("BROWSER_ACTION_FAILED", cause instanceof Error ? cause.message : "打印失败"),
        }),
        (tab) =>
          Effect.tryPromise({
            try: async () => {
              if (input.html) {
                await tab.page.navigate("about:blank")
                await tab.page.evaluate(
                  `document.open();document.write(${JSON.stringify(input.html)});document.close();`,
                )
                // document.write 之后等一帧，让内联脚本与样式先跑起来。
                await tab.page.evaluate(
                  "new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 80)))",
                )
              } else {
                await tab.page.navigate(target!)
              }
              return await tab.page.printToPdf({
                landscape: input.landscape,
                printBackground: input.printBackground,
              })
            },
            catch: (cause) =>
              browserError("BROWSER_ACTION_FAILED", cause instanceof Error ? cause.message : "打印失败"),
          }),
        (tab) => Effect.promise(() => tab.dispose().catch(() => undefined)),
      )
    })

    const status = Effect.fn("Browser.status")(function* () {
      const current = yield* InstanceState.get(state)
      return { active: Boolean(current.session) }
    })

    const snapshot = Effect.fn("Browser.snapshot")(function* () {
      return yield* usePage(async (page) => {
        const data = await page.evaluate<{
          text: string
          overflow: boolean
          focusVisible: boolean
          refs: SnapshotRef[]
        }>(SNAPSHOT_SCRIPT)
        const refs = data?.refs ?? []
        const lines = refs.map((item) => "[" + item.ref + "] " + item.role + (item.name ? ' "' + item.name + '"' : ""))
        return {
          url: await page.currentUrl(),
          title: await page.title(),
          text: data.text + String.fromCharCode(10) + lines.join(String.fromCharCode(10)),
          bodyText: data.text,
          refs,
          overflow: data.overflow,
          focusVisible: data.focusVisible,
        }
      }, "Browser 快照失败")
    })

    return Service.of({
      navigate,
      setViewport,
      snapshot,
      printToPdf,
      click: (ref) => usePage((page) => page.clickRef(ref), "Browser 点击失败"),
      fill: (ref, value) => usePage((page) => page.fillRef(ref, value), "Browser 填写失败"),
      press: (key, ref) => usePage((page) => page.press(key, ref), "Browser 按键失败"),
      screenshot: (fullPage) =>
        Effect.gen(function* () {
          const bytes = yield* usePage((page) => page.screenshot(fullPage), "Browser 截图失败")
          const ctx = yield* InstanceState.context
          const directory = path.join(ctx.worktree, ".novaway", "browser", "evidence")
          const file = path.join(directory, randomUUID() + ".png")
          yield* fs
            .makeDirectory(directory, { recursive: true })
            .pipe(Effect.mapError((cause) => browserError("BROWSER_ACTION_FAILED", cause.message)))
          yield* fs
            .writeFile(file, bytes)
            .pipe(Effect.mapError((cause) => browserError("BROWSER_ACTION_FAILED", cause.message)))
          // 同时给出 data URL：界面直接用它在消息流里展示"验证结果截图"，
          // 不依赖渲染进程能否读本地文件。
          return { path: file, dataURL: "data:image/png;base64," + Buffer.from(bytes).toString("base64") }
        }),
      console: () => InstanceState.get(state).pipe(Effect.map((value) => [...value.console])),
      network: () => InstanceState.get(state).pipe(Effect.map((value) => value.network.map((entry) => ({ ...entry })))),
      accessibility: () => usePage((page) => page.accessibility(), "Browser 无障碍快照失败"),
      status,
      close,
    })
  }),
)

function closeState(state: State) {
  return Effect.promise(async () => {
    const session = state.session
    state.session = undefined
    state.console.length = 0
    state.network.length = 0
    if (session) await session.close().catch(() => undefined)
  })
}

export const defaultLayer = layer.pipe(Layer.provide(NodeFileSystem.layer))

export * as BrowserService from "./browser"
export const Browser = { Service, layer }
