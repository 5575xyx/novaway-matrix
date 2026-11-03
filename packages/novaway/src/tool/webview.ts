import { Effect, Option, Schema } from "effect"
import { PlatformWebview } from "@/platform-webview"
import * as Tool from "./tool"

/**
 * 运营工作台里的「内嵌浏览器」工具组。
 *
 * 和 `browser_*` 的区别必须让模型一眼看懂：
 * - `browser_*` 另起一个无头 Chrome，**没有**用户的登录态，适合看文档/验证页面；
 * - `webview_*` 操作用户眼前那块已经登录好的平台页面（公众号后台、小红书创作中心…），
 *   动作会真实地显示在界面上，用户能看见模型在点什么。
 *
 * 所以「发公众号 / 发小红书」这类需要登录态的流程，一律走这里，不要用 `browser_*`。
 */

const DESCRIPTION = [
  "Operate the platform page shown in the user's 运营工作台 (the embedded, already-logged-in browser).",
  "This is NOT browser_*: browser_* launches a separate headless Chrome without the user's login session.",
  "Use webview_* for logged-in platform consoles (mp.weixin.qq.com, creator.xiaohongshu.com, …) where publishing/creating content requires the real session.",
  "The user can see every action on screen, so keep steps small and verify with webview_snapshot between actions.",
].join(" ")

const Target = Schema.optional(Schema.String).annotate({
  description: "平台 id 或账号 id；省略时操作工作台当前打开的那个页面",
})

const Common = { target: Target }

const StatusParameters = Schema.Struct({ ...Common })

const SnapshotParameters = Schema.Struct({
  ...Common,
  selector: Schema.optional(Schema.String).annotate({
    description: "可选：只看这个 CSS 选择器对应的区域（例如正文编辑器）",
  }),
})

const RefParameters = Schema.Struct({
  ...Common,
  ref: Schema.String.annotate({ description: "webview_snapshot 返回的 ref（例如 e12）" }),
})

const FillParameters = Schema.Struct({
  ...Common,
  ref: Schema.String.annotate({ description: "webview_snapshot 返回的 ref" }),
  value: Schema.String.annotate({ description: "要写入的文本（支持多行）" }),
})

const PressParameters = Schema.Struct({
  ...Common,
  key: Schema.String.annotate({ description: "按键名，例如 Enter / Escape / Control+A" }),
  ref: Schema.optional(Schema.String).annotate({ description: "可选：按键发给哪个元素" }),
})

const NavigateParameters = Schema.Struct({
  ...Common,
  url: Schema.String.annotate({ description: "要打开的 http/https 地址" }),
})

const ScriptParameters = Schema.Struct({
  ...Common,
  script: Schema.String.annotate({
    description:
      "在页面里执行的一段 JS（同步返回可序列化的值）。用于快照/点击覆盖不到的场景，例如往 iframe 里的编辑器写正文。",
  }),
})

const ScreenshotParameters = Schema.Struct({ ...Common })

/** 点按钮这类有副作用的动作才走权限确认；读页面不打断人。 */
function ask(ctx: Tool.Context, action: string, detail: string) {
  return ctx.ask({
    permission: "webview",
    patterns: [action],
    always: ["*"],
    metadata: { action, detail },
  })
}

const text = (value: unknown) => JSON.stringify(value, null, 2)

/**
 * 通道服务是可选的：最小 layer（单测、嵌入式用法）里没有它，工具仍然要能注册。
 * 真的被调用时再给出明确说明，而不是在注册阶段就把整个工具集拖垮。
 */
const unavailable = {
  title: "内嵌浏览器不可用",
  metadata: {},
  output:
    "当前客户端没有连接内嵌浏览器通道。请在桌面端打开运营工作台、选中平台账号后重试；这类流程不能用 browser_* 代替（没有登录态）。",
}

/** 给元素打 ref 并收集可见文字；和 browser_snapshot 同一套 ref 语义。 */
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
    if (el.closest('[aria-hidden="true"]')) continue
    const ref = "e" + ++index
    el.setAttribute("data-nv-ref", ref)
    const name = (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      (el.textContent || "").replace(/\s+/g, " ").trim()
    ).slice(0, 120)
    refs.push({ ref, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || el.tagName.toLowerCase(), name })
    if (refs.length >= 400) break
  }
  const body = document.body ? document.body.innerText || "" : ""
  return { url: location.href, title: document.title, text: body.slice(0, 8000), refs, overflow: refs.length >= 400 }
})()`

function scopedSnapshotScript(selector: string) {
  const safe = JSON.stringify(selector)
  return `(() => {
  const root = document.querySelector(${safe})
  if (!root) return { url: location.href, title: document.title, text: "", missing: true }
  return { url: location.href, title: document.title, text: (root.innerText || root.textContent || "").slice(0, 8000) }
})()`
}

function clickScript(ref: string) {
  const selector = JSON.stringify(`[data-nv-ref="${ref}"]`)
  return `(() => {
  const el = document.querySelector(${selector})
  if (!el) return { ok: false, error: "ref_not_found", hint: "页面可能已经变化，请重新 webview_snapshot" }
  el.scrollIntoView({ block: "center", inline: "center" })
  const rect = el.getBoundingClientRect()
  const options = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, view: window }
  for (const name of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    const Ctor = name.indexOf("pointer") === 0 ? window.PointerEvent || MouseEvent : MouseEvent
    el.dispatchEvent(new Ctor(name, options))
  }
  if (typeof el.click === "function") el.click()
  return { ok: true, tag: el.tagName.toLowerCase(), name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 80) }
})()`
}

function fillScript(ref: string, value: string) {
  const selector = JSON.stringify(`[data-nv-ref="${ref}"]`)
  const payload = JSON.stringify(value)
  return `(() => {
  const el = document.querySelector(${selector})
  if (!el) return { ok: false, error: "ref_not_found" }
  const text = ${payload}
  el.scrollIntoView({ block: "center" })
  el.focus()
  if (el.isContentEditable) {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    if (selection) { selection.removeAllRanges(); selection.addRange(range) }
    if (!document.execCommand("insertText", false, text)) el.textContent = text
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }))
    return { ok: true, mode: "contenteditable" }
  }
  if ("value" in el) {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, "value")
    const setter = desc && desc.set
    if (setter) setter.call(el, text)
    else el.value = text
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    return { ok: true, mode: "value" }
  }
  return { ok: false, error: "not_editable" }
})()`
}

function pressScript(key: string, ref: string | undefined) {
  const selector = ref ? JSON.stringify(`[data-nv-ref="${ref}"]`) : "null"
  const payload = JSON.stringify(key)
  return `(() => {
  const key = ${payload}
  const target = ${selector} ? document.querySelector(${selector}) : document.activeElement || document.body
  if (!target) return { ok: false, error: "ref_not_found" }
  const parts = key.split("+")
  const name = parts[parts.length - 1]
  const lower = parts.map((p) => p.toLowerCase())
  const options = {
    key: name,
    code: name.length === 1 ? "Key" + name.toUpperCase() : name,
    bubbles: true,
    cancelable: true,
    ctrlKey: lower.indexOf("control") >= 0,
    metaKey: lower.indexOf("meta") >= 0,
    shiftKey: lower.indexOf("shift") >= 0,
    altKey: lower.indexOf("alt") >= 0,
  }
  if (target.focus) target.focus()
  target.dispatchEvent(new KeyboardEvent("keydown", options))
  target.dispatchEvent(new KeyboardEvent("keyup", options))
  return { ok: true, key }
})()`
}

export const WebviewStatusTool = Tool.define(
  "webview_status",
  Effect.gen(function* () {
    const webview = Option.getOrUndefined(yield* Effect.serviceOption(PlatformWebview.Service))
    return {
      description:
        DESCRIPTION +
        "\n\n动作：查看工作台当前页面（地址、标题、平台账号）。先用它确认「页面开着、并且已登录」，再做后续动作。",
      parameters: StatusParameters,
      capabilities: { readOnly: true, concurrencySafe: false, idempotent: true },
      execute: (params: Schema.Schema.Type<typeof StatusParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!webview) return unavailable
          const data = yield* webview.exec({
            sessionID: ctx.sessionID,
            action: "status",
            ...(params.target ? { target: params.target } : {}),
          })
          return { title: "内嵌浏览器状态", metadata: { data }, output: text(data) }
        }).pipe(Effect.orDie),
    }
  }),
)

export const WebviewSnapshotTool = Tool.define(
  "webview_snapshot",
  Effect.gen(function* () {
    const webview = Option.getOrUndefined(yield* Effect.serviceOption(PlatformWebview.Service))
    return {
      description:
        DESCRIPTION +
        "\n\n动作：获取页面快照（标题、URL、可见文字、可交互元素的 ref）。点击/填写都用这里返回的 ref。",
      parameters: SnapshotParameters,
      capabilities: { readOnly: true, concurrencySafe: false, idempotent: true },
      execute: (params: Schema.Schema.Type<typeof SnapshotParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!webview) return unavailable
          const data = yield* webview.exec({
            sessionID: ctx.sessionID,
            action: "script",
            script: params.selector ? scopedSnapshotScript(params.selector) : SNAPSHOT_SCRIPT,
            ...(params.target ? { target: params.target } : {}),
          })
          return { title: "内嵌浏览器快照", metadata: { data }, output: text(data).slice(0, 24_000) }
        }).pipe(Effect.orDie),
    }
  }),
)

export const WebviewClickTool = Tool.define(
  "webview_click",
  Effect.gen(function* () {
    const webview = Option.getOrUndefined(yield* Effect.serviceOption(PlatformWebview.Service))
    return {
      description: DESCRIPTION + "\n\n动作：点击 snapshot ref 对应的元素。",
      parameters: RefParameters,
      capabilities: { concurrencySafe: false, destructive: true },
      execute: (params: Schema.Schema.Type<typeof RefParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!webview) return unavailable
          yield* ask(ctx, "click", params.ref)
          const data = yield* webview.exec({
            sessionID: ctx.sessionID,
            action: "script",
            script: clickScript(params.ref),
            ...(params.target ? { target: params.target } : {}),
          })
          return { title: `点击 ${params.ref}`, metadata: { ref: params.ref, data }, output: text(data) }
        }).pipe(Effect.orDie),
    }
  }),
)

export const WebviewFillTool = Tool.define(
  "webview_fill",
  Effect.gen(function* () {
    const webview = Option.getOrUndefined(yield* Effect.serviceOption(PlatformWebview.Service))
    return {
      description:
        DESCRIPTION +
        "\n\n动作：向 snapshot ref 对应的输入框（input / textarea / contenteditable 富文本）写入文本。",
      parameters: FillParameters,
      capabilities: { concurrencySafe: false, destructive: true },
      execute: (params: Schema.Schema.Type<typeof FillParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!webview) return unavailable
          yield* ask(ctx, "fill", params.ref)
          const data = yield* webview.exec({
            sessionID: ctx.sessionID,
            action: "script",
            script: fillScript(params.ref, params.value),
            ...(params.target ? { target: params.target } : {}),
          })
          return {
            title: `填写 ${params.ref}`,
            metadata: { ref: params.ref, length: params.value.length, data },
            output: text(data),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const WebviewPressTool = Tool.define(
  "webview_press",
  Effect.gen(function* () {
    const webview = Option.getOrUndefined(yield* Effect.serviceOption(PlatformWebview.Service))
    return {
      description: DESCRIPTION + "\n\n动作：向页面发送按键（Enter / Escape / Control+A 等）。",
      parameters: PressParameters,
      capabilities: { concurrencySafe: false, destructive: true },
      execute: (params: Schema.Schema.Type<typeof PressParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!webview) return unavailable
          yield* ask(ctx, "press", params.key)
          const data = yield* webview.exec({
            sessionID: ctx.sessionID,
            action: "script",
            script: pressScript(params.key, params.ref),
            ...(params.target ? { target: params.target } : {}),
          })
          return { title: `按键 ${params.key}`, metadata: { key: params.key, data }, output: text(data) }
        }).pipe(Effect.orDie),
    }
  }),
)

export const WebviewNavigateTool = Tool.define(
  "webview_navigate",
  Effect.gen(function* () {
    const webview = Option.getOrUndefined(yield* Effect.serviceOption(PlatformWebview.Service))
    return {
      description:
        DESCRIPTION +
        "\n\n动作：把工作台的页面导航到指定地址（例如平台的文章编辑页）。会等待页面加载完成。",
      parameters: NavigateParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof NavigateParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!webview) return unavailable
          yield* ask(ctx, "navigate", params.url)
          const data = yield* webview.exec({
            sessionID: ctx.sessionID,
            action: "navigate",
            url: params.url,
            timeoutMs: 60_000,
            ...(params.target ? { target: params.target } : {}),
          })
          return { title: `导航 ${params.url}`, metadata: { url: params.url, data }, output: text(data) }
        }).pipe(Effect.orDie),
    }
  }),
)

export const WebviewScriptTool = Tool.define(
  "webview_script",
  Effect.gen(function* () {
    const webview = Option.getOrUndefined(yield* Effect.serviceOption(PlatformWebview.Service))
    return {
      description: [
        DESCRIPTION,
        "",
        "动作：在页面里执行一段脚本并返回结果（同步返回可 JSON 序列化的值）。",
        "用于快照/点击覆盖不到的流程，例如往 iframe#ueditor_0 里写公众号正文、读页面里的某个变量。",
        "脚本运行在平台页面自己的上下文里：可以访问 document / location / localStorage，但没有 Node 能力。",
      ].join("\n"),
      parameters: ScriptParameters,
      capabilities: { concurrencySafe: false, destructive: true },
      execute: (params: Schema.Schema.Type<typeof ScriptParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!webview) return unavailable
          yield* ask(ctx, "script", params.script.slice(0, 80))
          const data = yield* webview.exec({
            sessionID: ctx.sessionID,
            action: "script",
            script: params.script,
            ...(params.target ? { target: params.target } : {}),
          })
          return { title: "执行页面脚本", metadata: { data }, output: text(data).slice(0, 24_000) }
        }).pipe(Effect.orDie),
    }
  }),
)

export const WebviewScreenshotTool = Tool.define(
  "webview_screenshot",
  Effect.gen(function* () {
    const webview = Option.getOrUndefined(yield* Effect.serviceOption(PlatformWebview.Service))
    return {
      description: DESCRIPTION + "\n\n动作：截取工作台当前页面（用户看到的那一屏）。",
      parameters: ScreenshotParameters,
      capabilities: { readOnly: true, concurrencySafe: false, idempotent: true },
      execute: (params: Schema.Schema.Type<typeof ScreenshotParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!webview) return unavailable
          const data = (yield* webview.exec({
            sessionID: ctx.sessionID,
            action: "screenshot",
            ...(params.target ? { target: params.target } : {}),
          })) as { dataURL?: string } | undefined
          const url = data?.dataURL
          return {
            title: "内嵌浏览器截图",
            metadata: { hasImage: Boolean(url) },
            output: url ? "已截取工作台页面（附图）。" : "截图失败：客户端没有返回图片。",
            ...(url
              ? { attachments: [{ type: "file" as const, mime: "image/png", url, filename: "webview.png" }] }
              : {}),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
