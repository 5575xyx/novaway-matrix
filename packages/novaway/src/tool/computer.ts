import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as Computer from "@/computer/computer"

const BUTTON = Schema.Literals(["left", "right", "middle"])

function ask(ctx: Tool.Context, action: string, detail: string) {
  return ctx.ask({
    permission: "computer",
    patterns: [action],
    always: ["*"],
    metadata: { action, detail },
  })
}

const text = (value: unknown) => JSON.stringify(value, null, 2)

/**
 * 电脑控制工具组。
 *
 * 每个动作都是一步一调用，和浏览器工具同构：
 * 截图 → 点击 → 再截图确认。所有动作都会走权限确认（permission: computer）。
 */
export const ComputerScreenshotTool = Tool.define(
  "computer_screenshot",
  Effect.gen(function* () {
    return {
      description:
        "Capture the whole screen and return it as an image. Use it before and after desktop actions to verify the result.",
      parameters: Schema.Struct({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "screenshot", "capture screen")
          const shot = yield* Effect.promise(() => Computer.screenshot())
          return {
            title: "Screenshot",
            metadata: { mime: shot.mime },
            output: "Screenshot captured.",
            attachments: [
              { type: "file" as const, mime: shot.mime, url: "data:" + shot.mime + ";base64," + shot.base64 },
            ],
          }
        }),
    }
  }),
)

export const ComputerClickTool = Tool.define(
  "computer_click",
  Effect.gen(function* () {
    return {
      description: "Click at absolute screen coordinates. Take a screenshot first to find the target.",
      parameters: Schema.Struct({
        x: Schema.Number.annotate({ description: "Absolute screen X coordinate" }),
        y: Schema.Number.annotate({ description: "Absolute screen Y coordinate" }),
        button: Schema.optional(BUTTON),
      }),
      execute: (params: Schema.Schema.Type<any>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "click", params.x + "," + params.y)
          yield* Effect.promise(() => Computer.click({ x: params.x, y: params.y, button: params.button }))
          return {
            title: "Click " + params.x + "," + params.y,
            metadata: { x: params.x, y: params.y, button: params.button ?? "left" },
            output: "Clicked at " + params.x + "," + params.y,
          }
        }),
    }
  }),
)

export const ComputerMoveTool = Tool.define(
  "computer_move",
  Effect.gen(function* () {
    return {
      description: "Move the mouse pointer to absolute screen coordinates without clicking.",
      parameters: Schema.Struct({
        x: Schema.Number.annotate({ description: "Absolute screen X coordinate" }),
        y: Schema.Number.annotate({ description: "Absolute screen Y coordinate" }),
      }),
      execute: (params: Schema.Schema.Type<any>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "move", params.x + "," + params.y)
          yield* Effect.promise(() => Computer.move(params.x, params.y))
          return { title: "Move " + params.x + "," + params.y, metadata: params, output: "Pointer moved." }
        }),
    }
  }),
)

export const ComputerTypeTool = Tool.define(
  "computer_type",
  Effect.gen(function* () {
    return {
      description: "Type text into the focused window. Chinese and other Unicode text is supported.",
      parameters: Schema.Struct({ text: Schema.String.annotate({ description: "Text to type" }) }),
      execute: (params: { text: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "type", params.text.slice(0, 40))
          yield* Effect.promise(() => Computer.type(params.text))
          return {
            title: "Typed " + params.text.length + " chars",
            metadata: { length: params.text.length },
            output: "Typed text.",
          }
        }),
    }
  }),
)

export const ComputerKeyTool = Tool.define(
  "computer_key",
  Effect.gen(function* () {
    return {
      description: 'Press a key combination, e.g. "Enter", "Ctrl+A", "Alt+Tab", "Cmd+Shift+4".',
      parameters: Schema.Struct({ keys: Schema.String.annotate({ description: "Key combination" }) }),
      execute: (params: { keys: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "key", params.keys)
          yield* Effect.promise(() => Computer.key(params.keys))
          return { title: "Key " + params.keys, metadata: { keys: params.keys }, output: "Key pressed." }
        }),
    }
  }),
)

export const ComputerScrollTool = Tool.define(
  "computer_scroll",
  Effect.gen(function* () {
    return {
      description: "Scroll at the current pointer position. Positive scrolls down, negative scrolls up.",
      parameters: Schema.Struct({ amount: Schema.Number.annotate({ description: "Wheel steps" }) }),
      execute: (params: { amount: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "scroll", String(params.amount))
          yield* Effect.promise(() => Computer.scroll(params.amount))
          return { title: "Scroll " + params.amount, metadata: params, output: "Scrolled." }
        }),
    }
  }),
)

export const ComputerWindowsTool = Tool.define(
  "computer_windows",
  Effect.gen(function* () {
    return {
      description: "List visible application windows (title and process id).",
      parameters: Schema.Struct({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "windows", "list windows")
          const list = yield* Effect.promise(() => Computer.windows())
          return {
            title: list.length + " windows",
            metadata: { count: list.length, windows: list },
            output: list.length === 0 ? "No visible windows." : list.map((item) => "- " + item.title).join("\n"),
          }
        }),
    }
  }),
)

export const ComputerFocusTool = Tool.define(
  "computer_focus",
  Effect.gen(function* () {
    return {
      description: "Bring a window to the foreground by (partial) title.",
      parameters: Schema.Struct({ title: Schema.String.annotate({ description: "Window title or part of it" }) }),
      execute: (params: { title: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "focus", params.title)
          yield* Effect.promise(() => Computer.focus(params.title))
          return { title: "Focus " + params.title, metadata: params, output: "Window focused." }
        }),
    }
  }),
)

export * as ComputerTools from "./computer"
