import path from "node:path"
import { randomUUID } from "node:crypto"
import { InstanceState } from "@/effect/instance-state"
import { NodeFileSystem } from "@effect/platform-node"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { chromium, type Browser, type BrowserContext, type ElementHandle, type Page } from "playwright-core"

type SnapshotElement = HTMLElement | SVGElement

export type SnapshotRef = {
  ref: string
  role: string
  name: string
  tag: string
}

type State = {
  browser?: Browser
  context?: BrowserContext
  page?: Page
  owned: boolean
  console: string[]
  network: Array<{ method: string; url: string; status?: number }>
  refs: Map<string, ElementHandle<SnapshotElement>>
}

export class BrowserError extends Schema.TaggedErrorClass<BrowserError>()("PowersNexusBrowserError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export interface Interface {
  readonly navigate: (url: string) => Effect.Effect<{ url: string; title: string }, BrowserError>
  readonly setViewport: (width: number, height: number) => Effect.Effect<void, BrowserError>
  readonly snapshot: () => Effect.Effect<
    { url: string; title: string; text: string; bodyText: string; refs: SnapshotRef[]; overflow: boolean; focusVisible: boolean },
    BrowserError
  >
  readonly click: (ref: string) => Effect.Effect<void, BrowserError>
  readonly fill: (ref: string, value: string) => Effect.Effect<void, BrowserError>
  readonly press: (key: string, ref?: string) => Effect.Effect<void, BrowserError>
  readonly screenshot: (fullPage: boolean) => Effect.Effect<{ path: string }, BrowserError>
  readonly console: () => Effect.Effect<string[], BrowserError>
  readonly network: () => Effect.Effect<Array<{ method: string; url: string; status?: number }>, BrowserError>
  readonly accessibility: () => Effect.Effect<string, BrowserError>
  readonly close: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PowersNexusBrowser") {}

function browserError(code: string, message: string) {
  return new BrowserError({ code, message })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const state = yield* InstanceState.make<State>(
      Effect.fn("PowersNexus.Browser.state")(function* () {
        const value: State = { owned: false, console: [], network: [], refs: new Map() }
        yield* Effect.addFinalizer(() => closeState(value))
        return value
      }),
    )

    const getPage = Effect.fnUntraced(function* () {
      const current = yield* InstanceState.get(state)
      if (current.page && !current.page.isClosed()) return current.page
      const connected = yield* Effect.tryPromise({
        try: async () => {
          const endpoint = process.env.POWERSNEXUS_BROWSER_CDP_URL
          const browser = endpoint
            ? await chromium.connectOverCDP(endpoint)
            : process.env.POWERSNEXUS_BROWSER_ALLOW_LAUNCH === "1"
              ? await (async () => {
                  const channel = process.env.POWERSNEXUS_BROWSER_CHANNEL || "chrome"
                  try {
                    return await chromium.launch({ headless: true, channel })
                  } catch {
                    return await chromium.launch({ headless: true })
                  }
                })()
              : undefined
          if (!browser) throw browserError("BROWSER_UNAVAILABLE", "未配置 Browser CDP 端点，且未允许启动隔离浏览器")
          const owned = !endpoint
          const context = await browser.newContext({ viewport: null })
          const page = await context.newPage()
          return { browser, context, page, owned }
        },
        catch: (cause) =>
          cause instanceof BrowserError
            ? cause
            : browserError("BROWSER_UNAVAILABLE", cause instanceof Error ? cause.message : "Browser 初始化失败"),
      })
      current.browser = connected.browser
      current.context = connected.context
      current.page = connected.page
      current.owned = connected.owned
      connected.page.on("console", (message) => {
        current.console.push(`[${message.type()}] ${message.text()}`)
        if (current.console.length > 1000) current.console.shift()
      })
      connected.page.on("request", (request) => {
        current.network.push({ method: request.method(), url: request.url() })
        if (current.network.length > 2000) current.network.shift()
      })
      connected.page.on("response", (response) => {
        const item = current.network.findLast((entry) => entry.url === response.url() && entry.status === undefined)
        if (item) item.status = response.status()
      })
      return connected.page
    })

    const usePage = <A>(run: (page: Page) => Promise<A>, message: string) =>
      Effect.gen(function* () {
        const page = yield* getPage()
        return yield* Effect.tryPromise({
          try: () => run(page),
          catch: (cause) => browserError("BROWSER_ACTION_FAILED", cause instanceof Error ? cause.message : message),
        })
      })

    const clearSnapshotRefs = Effect.fnUntraced(function* () {
      const current = yield* InstanceState.get(state)
      yield* Effect.promise(() => Promise.all([...current.refs.values()].map((handle) => handle.dispose().catch(() => undefined))))
      current.refs.clear()
    })

    const clearTelemetry = Effect.fnUntraced(function* () {
      const current = yield* InstanceState.get(state)
      current.console.length = 0
      current.network.length = 0
    })

    const resolveRef = Effect.fnUntraced(function* (ref: string) {
      const current = yield* InstanceState.get(state)
      const normalized = ref.replace(/^ref=/, "")
      if (!/^e\d+$/.test(normalized)) return yield* browserError("SNAPSHOT_REF_REQUIRED", "Browser 元素操作必须使用 snapshot ref")
      const handle = current.refs.get(normalized)
      if (!handle) return yield* browserError("SNAPSHOT_REF_INVALID", `Browser snapshot ref 不存在：${normalized}`)
      return handle
    })

    const setViewport = Effect.fn("PowersNexus.Browser.setViewport")(function* (width: number, height: number) {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        return yield* browserError("BROWSER_ACTION_FAILED", "Browser viewport 必须是正整数")
      }
      yield* clearSnapshotRefs()
      yield* clearTelemetry()
      yield* usePage((page) => page.setViewportSize({ width, height }), "Browser viewport 设置失败")
    })

    const navigate = Effect.fn("PowersNexus.Browser.navigate")(function* (url: string) {
      const parsed = yield* Effect.try({
        try: () => new URL(url),
        catch: () => browserError("BROWSER_ACTION_FAILED", "Browser URL 无效"),
      })
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return yield* browserError("BROWSER_ACTION_FAILED", "Browser 仅允许 http/https URL")
      }
      yield* clearSnapshotRefs()
      yield* clearTelemetry()
      return yield* usePage(async (page) => {
        await page.goto(parsed.href, { waitUntil: "domcontentloaded" })
        return { url: page.url(), title: await page.title() }
      }, "Browser 导航失败")
    })

    const close = Effect.fn("PowersNexus.Browser.close")(function* () {
      yield* closeState(yield* InstanceState.get(state))
    })

    const snapshot = Effect.fn("PowersNexus.Browser.snapshot")(function* () {
      yield* clearSnapshotRefs()
      const page = yield* getPage()
      const data = yield* Effect.tryPromise({
        try: () =>
          page.evaluate(() => ({
            text: (document.body?.innerText ?? "").slice(0, 2_000_000),
            overflow: document.documentElement.scrollWidth > window.innerWidth,
            focusVisible: (() => {
              const active = document.activeElement
              if (!active || active === document.body) return true
              const rect = active.getBoundingClientRect()
              const style = getComputedStyle(active)
              return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
            })(),
          })),
        catch: (cause) => browserError("BROWSER_ACTION_FAILED", cause instanceof Error ? cause.message : "Browser 快照失败"),
      })
      const handles = yield* Effect.tryPromise({
        try: () => page.locator('a[href],button,input,textarea,select,summary,[role],[tabindex]:not([tabindex="-1"]),[contenteditable="true"]').elementHandles() as unknown as Promise<ElementHandle<SnapshotElement>[]>,
        catch: (cause) => browserError("BROWSER_ACTION_FAILED", cause instanceof Error ? cause.message : "Browser 元素快照失败"),
      })
      const refs: SnapshotRef[] = []
      const current = yield* InstanceState.get(state)
      for (const [index, handle] of handles.entries()) {
        const visible = yield* Effect.tryPromise({
          try: () => handle.isVisible(),
          catch: () => browserError("BROWSER_ACTION_FAILED", "Browser 元素可见性读取失败"),
        }).pipe(Effect.orElseSucceed(() => false))
        if (!visible) continue
        const details = yield* Effect.tryPromise({
          try: () =>
            handle.evaluate((element) => {
              const node = element as SnapshotElement
              return {
              tag: node.tagName.toLowerCase(),
              role: node.getAttribute("role") ?? node.tagName.toLowerCase(),
              name:
                node.getAttribute("aria-label") ??
                node.getAttribute("placeholder") ??
                node.getAttribute("title") ??
                (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
              }
            }),
          catch: (cause) => browserError("BROWSER_ACTION_FAILED", cause instanceof Error ? cause.message : "Browser 元素解析失败"),
        })
        const ref = `e${index + 1}`
        current.refs.set(ref, handle)
        refs.push({ ref, ...details })
      }
      const lines = refs.map((item) => `[${item.ref}] ${item.role}${item.name ? ` "${item.name}"` : ""}`)
      return {
        url: page.url(),
        title: yield* Effect.tryPromise({
          try: () => page.title(),
          catch: (cause) => browserError("BROWSER_ACTION_FAILED", cause instanceof Error ? cause.message : "Browser 标题读取失败"),
        }),
        text: `${data.text}\n${lines.join("\n")}`,
        bodyText: data.text,
        refs,
        overflow: data.overflow,
        focusVisible: data.focusVisible,
      }
    })

    const withRef = <A>(ref: string, run: (handle: ElementHandle<SnapshotElement>) => Promise<A>, message: string) =>
      Effect.gen(function* () {
        const handle = yield* resolveRef(ref)
        return yield* Effect.tryPromise({ try: () => run(handle), catch: (cause) => browserError("BROWSER_ACTION_FAILED", cause instanceof Error ? cause.message : message) })
      })

    return Service.of({
      navigate,
      setViewport,
      snapshot,
      click: (ref) => withRef(ref, (handle) => handle.click(), "Browser 点击失败"),
      fill: (ref, value) => withRef(ref, (handle) => handle.fill(value), "Browser 填写失败"),
      press: (key, ref) =>
        ref ? withRef(ref, (handle) => handle.press(key), "Browser 按键失败") : usePage((page) => page.keyboard.press(key), "Browser 按键失败"),
      screenshot: (fullPage) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const directory = path.join(ctx.worktree, ".novaway", "powersnexus", "evidence", "browser")
          const file = path.join(directory, `${randomUUID()}.png`)
          yield* fs
            .makeDirectory(directory, { recursive: true })
            .pipe(Effect.mapError((cause) => browserError("BROWSER_ACTION_FAILED", cause.message)))
          return yield* usePage(async (page) => {
            await page.screenshot({ path: file, fullPage })
            return { path: file }
          }, "Browser 截图失败")
        }),
      console: () => InstanceState.get(state).pipe(Effect.map((value) => [...value.console])),
      network: () => InstanceState.get(state).pipe(Effect.map((value) => value.network.map((entry) => ({ ...entry })))),
      accessibility: () => usePage((page) => page.locator("body").ariaSnapshot(), "Browser 无障碍快照失败"),
      close,
    })
  }),
)

function closeState(state: State) {
  return Effect.promise(async () => {
    await Promise.all([...state.refs.values()].map((handle) => handle.dispose().catch(() => undefined)))
    state.refs.clear()
    if (state.context) await state.context.close().catch(() => undefined)
    if (state.owned && state.browser) await state.browser.close().catch(() => undefined)
    state.page = undefined
    state.context = undefined
    state.browser = undefined
    state.owned = false
  })
}

export const defaultLayer = layer.pipe(Layer.provide(NodeFileSystem.layer))

export * as PowersNexusBrowser from "./browser"
