import path from "node:path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { BrowserService } from "@/browser/browser"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"

const NavigateParameters = Schema.Struct({
  url: Schema.String.annotate({ description: "要打开的 http/https URL" }),
})

const RefParameters = Schema.Struct({
  ref: Schema.String.annotate({ description: "最近一次 browser_snapshot 返回的 snapshot ref" }),
})

const FillParameters = Schema.Struct({
  ref: Schema.String.annotate({ description: "最近一次 browser_snapshot 返回的 snapshot ref" }),
  value: Schema.String.annotate({ description: "要填入的文本" }),
})

const PressParameters = Schema.Struct({
  key: Schema.String.annotate({ description: "按键，例如 Enter 或 Control+A" }),
  ref: Schema.optional(Schema.String).annotate({ description: "可选目标 snapshot ref" }),
})

const ScreenshotParameters = Schema.Struct({
  fullPage: Schema.optional(Schema.Boolean).annotate({ description: "是否全页截图，默认 false" }),
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

export const BrowserNavigateTool = Tool.define(
  "browser_navigate",
  Effect.gen(function* () {
    const browser = yield* BrowserService.Service
    return {
      description: DESCRIPTION + "\n\n动作：打开或导航到指定 URL。",
      parameters: NavigateParameters,
      execute: (params: Schema.Schema.Type<typeof NavigateParameters>, ctx: Tool.Context) =>
        run(
          Effect.gen(function* () {
            yield* ctx.ask(permission(params.url))
            const result = yield* browser.navigate(params.url)
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
              attachments: [
                {
                  type: "file" as const,
                  mime: "image/png",
                  url: result.path,
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
