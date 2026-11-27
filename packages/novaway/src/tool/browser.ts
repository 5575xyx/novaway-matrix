import path from "node:path"
import { Effect, Schema } from "effect"
import { Bus } from "@/bus"
import * as BusEvent from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { BrowserService } from "@/browser/browser"
import { parseCookieText } from "@/browser/cookies"
import type { BrowserCookieParam } from "@/browser/cdp"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"

// 验证用的本地页面同步到应用内置预览：右侧「浏览器」标签跟着导航目标走，
// 用户能直接看到模型正在检查的页面，而不是只在一个看不见的隔离浏览器里跑。
export const BrowserEvent = {
  Navigated: BusEvent.define(
    "browser.navigated",
    Schema.Struct({
      sessionID: Schema.String,
      url: Schema.String,
    }),
  ),
}

const NavigateParameters = Schema.Struct({
  url: Schema.String.annotate({ description: "要打开的 http/https URL，或本地 HTML 的 file:// URL / 绝对路径" }),
})

const RefParameters = Schema.Struct({
  ref: Schema.String.annotate({ description: "最近一次 browser_snapshot 返回的 snapshot ref" }),
})

const FillParameters = Schema.Struct({
  ref: Schema.String.annotate({ description: "最近一次 browser_snapshot 返回的 snapshot ref" }),
  value: Schema.String.annotate({ description: "要填入的文本" }),
})

const TabParameters = Schema.Struct({
  targetId: Schema.String.annotate({ description: "browser_tabs 返回的 targetId" }),
})

const PressParameters = Schema.Struct({
  key: Schema.String.annotate({ description: "按键，例如 Enter 或 Control+A" }),
  ref: Schema.optional(Schema.String).annotate({ description: "可选目标 snapshot ref" }),
})

const ScreenshotParameters = Schema.Struct({
  fullPage: Schema.optional(Schema.Boolean).annotate({ description: "是否全页截图，默认 false" }),
})

const CookieInput = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  url: Schema.optional(Schema.String),
  domain: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  secure: Schema.optional(Schema.Boolean),
  httpOnly: Schema.optional(Schema.Boolean),
  sameSite: Schema.optional(Schema.Literals(["Strict", "Lax", "None"])),
  expires: Schema.optional(Schema.Number),
})

const CookieParameters = Schema.Struct({
  cookies: Schema.optional(Schema.Array(CookieInput)).annotate({ description: "结构化 Cookie 列表" }),
  text: Schema.optional(Schema.String).annotate({ description: "JSON Cookie 数组或 Netscape cookies.txt 文本" }),
  format: Schema.optional(Schema.Literals(["json", "netscape"])),
})

function permission(urlOrAction: string) {
  return {
    permission: "browser",
    patterns: [urlOrAction],
    always: ["*"] as string[],
    metadata: { target: urlOrAction },
  }
}

function run<A>(effect: Effect.Effect<A, unknown>) {
  return effect.pipe(Effect.orDie)
}

function parseCookieImport(params: Schema.Schema.Type<typeof CookieParameters>): BrowserCookieParam[] {
  if (params.cookies?.length) return params.cookies as BrowserCookieParam[]
  if (!params.text?.trim()) throw new Error("提供 cookies 数组，或提供 JSON/Netscape Cookie 文本")
  return parseCookieText(params.text, params.format)
}

export const BrowserNavigateTool = Tool.define(
  "browser_navigate",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    const bus = yield* Bus.Service
    return {
      description: DESCRIPTION + "\n\n动作：打开或导航到指定 URL。",
      parameters: NavigateParameters,
      execute: (params: Schema.Schema.Type<typeof NavigateParameters>, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission(params.url))
            const result = yield* browser.navigate(params.url)
            // 本地页面同步到右侧内置预览；外部站点不该抢用户的标签，客户端会自行过滤。
            yield* bus
              .publish(BrowserEvent.Navigated, { sessionID: ctx.sessionID, url: result.url })
              .pipe(Effect.ignore)
            return {
              title: `导航 ${result.url}`,
              metadata: result,
              output: JSON.stringify(result, null, 2),
            }
          }),
        ),
    }
  }),
)

export const BrowserSnapshotTool = Tool.define(
  "browser_snapshot",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：获取当前页面标题、URL 与文本快照。",
      parameters: Schema.Struct({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission("snapshot"))
            const result = yield* browser.snapshot()
            return {
              title: `快照 ${result.title}`,
              metadata: { url: result.url, title: result.title, refs: result.refs },
              output: result.text.slice(0, 20_000),
            }
          }),
        ),
    }
  }),
)

export const BrowserTabsTool = Tool.define(
  "browser_tabs",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：列出当前浏览器窗口中的标签页和 targetId。",
      parameters: Schema.Struct({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission("tabs"))
            const tabs = yield* browser.tabs()
            return {
              title: `${tabs.length} 个浏览器标签页`,
              metadata: { tabs },
              output: tabs.length
                ? tabs
                    .map((tab) => `[${tab.targetId}]${tab.active ? " *" : ""} ${tab.title || "(无标题)"} — ${tab.url}`)
                    .join("\n")
                : "没有可用的浏览器标签页。",
            }
          }),
        ),
    }
  }),
)

export const BrowserTabSwitchTool = Tool.define(
  "browser_tab_switch",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：切换到 browser_tabs 返回的标签页。切换后必须重新获取 browser_snapshot。",
      parameters: TabParameters,
      execute: (params: Schema.Schema.Type<typeof TabParameters>, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission(`tab:${params.targetId}`))
            yield* browser.selectTab(params.targetId)
            return {
              title: `已切换标签页 ${params.targetId}`,
              metadata: params,
              output: `已切换到标签页 ${params.targetId}，请重新获取页面快照。`,
            }
          }),
        ),
    }
  }),
)

export const BrowserClickTool = Tool.define(
  "browser_click",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：点击 snapshot ref 对应元素。",
      parameters: RefParameters,
      execute: (params: Schema.Schema.Type<typeof RefParameters>, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission(params.ref))
            yield* browser.click(params.ref)
            return { title: `点击 ${params.ref}`, metadata: params, output: `已点击 ${params.ref}` }
          }),
        ),
    }
  }),
)

export const BrowserFillTool = Tool.define(
  "browser_fill",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：向 snapshot ref 对应输入框填写文本。",
      parameters: FillParameters,
      execute: (params: Schema.Schema.Type<typeof FillParameters>, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission(params.ref))
            yield* browser.fill(params.ref, params.value)
            return {
              title: `填写 ${params.ref}`,
              metadata: { ref: params.ref },
              output: `已填写 ${params.ref}`,
            }
          }),
        ),
    }
  }),
)

export const BrowserPressTool = Tool.define(
  "browser_press",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：发送按键。",
      parameters: PressParameters,
      execute: (params: Schema.Schema.Type<typeof PressParameters>, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission(params.key))
            yield* browser.press(params.key, params.ref)
            return { title: `按键 ${params.key}`, metadata: params, output: `已发送按键 ${params.key}` }
          }),
        ),
    }
  }),
)

export const BrowserScreenshotTool = Tool.define(
  "browser_screenshot",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：截取当前页面并保存到 Worktree 证据目录。",
      parameters: ScreenshotParameters,
      execute: (params: Schema.Schema.Type<typeof ScreenshotParameters>, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission("screenshot"))
            const result = yield* browser.screenshot(params.fullPage === true)
            const instance = yield* InstanceState.context
            const relative = path.relative(instance.worktree, result.path).replaceAll("\\", "/")
            return {
              title: "截图",
              metadata: { path: relative },
              output: `截图已保存：${relative}`,
              // 用 data URL 而不是文件路径：消息流里要直接把截图当验证结果展示，
              // 也方便支持媒体的模型看到实际渲染效果。文件同时落在证据目录里。
              attachments: [
                {
                  type: "file" as const,
                  mime: "image/png",
                  url: result.dataURL,
                  filename: path.basename(result.path),
                },
              ],
            }
          }),
        ),
    }
  }),
)

export const BrowserConsoleTool = Tool.define(
  "browser_console",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：读取浏览器 console 记录。",
      parameters: Schema.Struct({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission("console"))
            const lines = yield* browser.console()
            return {
              title: "控制台",
              metadata: { count: lines.length },
              output: lines.join("\n") || "（无记录）",
            }
          }),
        ),
    }
  }),
)

export const BrowserNetworkTool = Tool.define(
  "browser_network",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：读取浏览器网络请求摘要。",
      parameters: Schema.Struct({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission("network"))
            const rows = yield* browser.network()
            return {
              title: "网络",
              metadata: { count: rows.length },
              output: JSON.stringify(rows.slice(-100), null, 2),
            }
          }),
        ),
    }
  }),
)

export const BrowserAccessibilityTool = Tool.define(
  "browser_accessibility",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：读取无障碍树摘要。",
      parameters: Schema.Struct({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission("accessibility"))
            const tree = yield* browser.accessibility()
            return {
              title: "无障碍树",
              metadata: {},
              output: tree.slice(0, 20_000),
            }
          }),
        ),
    }
  }),
)

export const BrowserCookieImportTool = Tool.define(
  "browser_cookie_import",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description:
        DESCRIPTION +
        "\n\n动作：把用户明确提供的 Cookie 导入当前浏览器会话。Cookie value 只用于设置，不会写入工具结果；导入后会刷新当前页面。",
      parameters: CookieParameters,
      execute: (params: Schema.Schema.Type<typeof CookieParameters>, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            const cookies = parseCookieImport(params)
            yield* ctx.ask(permission(`import ${cookies.length} cookies`))
            const result = yield* browser.importCookies(cookies)
            return {
              title: "Cookie 已导入",
              metadata: { count: result.count, reloaded: result.reloaded },
              output: `已导入 ${result.count} 个 Cookie${result.reloaded ? "，当前页面已刷新" : ""}。`,
            }
          }),
        ),
    }
  }),
)

export const BrowserStatusTool = Tool.define(
  "browser_status",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：检查浏览器会话是否已连接，以及是否使用持久化 Profile。",
      parameters: Schema.Struct({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission("status"))
            const result = yield* browser.status()
            return {
              title: result.active ? "浏览器已连接" : "浏览器未启动",
              metadata: result,
              output: result.active
                ? `浏览器已连接（${result.persistent ? "持久化会话" : "临时会话"}）。`
                : "浏览器尚未启动。",
            }
          }),
        ),
    }
  }),
)

export const BrowserCloseTool = Tool.define(
  "browser_close",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：关闭隔离浏览器上下文。",
      parameters: Schema.Struct({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission("close"))
            yield* browser.close()
            return { title: "浏览器已关闭", metadata: {}, output: "隔离浏览器上下文已关闭" }
          }),
        ),
    }
  }),
)

export const BrowserOpenTool = BrowserNavigateTool
export const BrowserTool = BrowserNavigateTool
