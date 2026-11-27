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

const ScreenshotParameters = Schema.Struct({
  window: Schema.optional(Schema.String).annotate({
    description: "Window title (or part of it) to capture, e.g. the app name shown in the title bar",
  }),
})

const ClickParameters = Schema.Struct({
  x: Schema.optional(Schema.Number.annotate({ description: "Absolute screen X coordinate" })),
  y: Schema.optional(Schema.Number.annotate({ description: "Absolute screen Y coordinate" })),
  ref: Schema.optional(Schema.String.annotate({ description: "Element ref from the latest computer_snapshot" })),
  window: Schema.optional(Schema.String.annotate({ description: "Window title or part of it when using ref" })),
  button: Schema.optional(BUTTON),
})

const SnapshotParameters = Schema.Struct({
  window: Schema.optional(Schema.String).annotate({
    description: "Window title or part of it; omit to inspect the foreground window",
  }),
})

const WaitWindowParameters = Schema.Struct({
  title: Schema.String.annotate({ description: "Window title or part of it, e.g. the app name" }),
  timeout_ms: Schema.optional(Schema.Number).annotate({
    description: "Maximum wait in milliseconds (default 30000)",
  }),
})

/**
 * 电脑控制工具组。
 *
 * 每个动作都是一步一调用，和浏览器工具同构：
 * 截图 → 点击 → 再截图确认。所有动作都会走权限确认（permission: computer）。
 */
export const ComputerStatusTool = Tool.define(
  "computer_status",
  Effect.gen(function* () {
    return {
      description:
        "Check desktop automation support and available screenshot, mouse, keyboard and semantic snapshot capabilities.",
      parameters: Schema.Struct({}),
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "status", "desktop capabilities")
          const result = yield* Effect.promise(() => Computer.status())
          return {
            title: result.supported ? "Computer control available" : "Computer control unavailable",
            metadata: result,
            output: result.supported
              ? `${result.platform}: ${Object.entries(result.capabilities)
                  .filter(([, enabled]) => enabled)
                  .map(([name]) => name)
                  .join(", ")}`
              : (result.reason ?? "Desktop automation is unavailable."),
          }
        }),
    }
  }),
)

export const ComputerScreenshotTool = Tool.define(
  "computer_screenshot",
  Effect.gen(function* () {
    return {
      description:
        "Capture a window (preferred) or the whole screen. Pass `window` with a title or part of it to capture only that window — it works while the window is in the background, so do not call computer_focus first. Use this for native desktop apps; for web pages (including local HTML) use browser_screenshot instead. Omit `window` only when the whole desktop is genuinely the target.",
      parameters: ScreenshotParameters,
      execute: (params: Schema.Schema.Type<typeof ScreenshotParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "screenshot", params.window ? `window: ${params.window}` : "capture screen")
          const shot = yield* Effect.promise(() =>
            params.window ? Computer.screenshotWindow(params.window) : Computer.screenshot(),
          )
          return {
            title: params.window ? `Screenshot: ${params.window}` : "Screenshot",
            metadata: { mime: shot.mime, mode: shot.mode, window: shot.window },
            output: params.window
              ? `Captured window "${params.window}" (${shot.mode ?? "window"}).`
              : "Screenshot captured.",
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
      description:
        "Click a semantic element from computer_snapshot (preferred) or at absolute screen coordinates. Always take a snapshot first when possible; refs are safer than guessing pixels.",
      parameters: ClickParameters,
      execute: (params: any, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.ref) {
            if (!params.window) throw new Error("window is required when clicking a snapshot ref")
            yield* ask(ctx, "click", `${params.window}:${params.ref}`)
            const evidence = yield* Effect.promise(() =>
              Computer.clickElement(params.window!, params.ref!, params.button),
            )
            return {
              title: "Click " + params.ref,
              metadata: {
                target: `${params.window ?? ""}:${params.ref}`,
                button: params.button ?? "left",
                verified: Boolean(evidence),
              },
              output: `Clicked element ${params.ref}${evidence ? " and captured post-action evidence." : "."}`,
              attachments: evidence
                ? [
                    {
                      type: "file" as const,
                      mime: evidence.mime,
                      url: `data:${evidence.mime};base64,${evidence.base64}`,
                    },
                  ]
                : undefined,
            }
          }
          if (params.x === undefined || params.y === undefined) {
            throw new Error("Provide either ref + window or both x and y")
          }
          yield* ask(ctx, "click", params.x + "," + params.y)
          yield* Effect.promise(() => Computer.click({ x: params.x!, y: params.y!, button: params.button }))
          let evidence: Awaited<ReturnType<typeof Computer.screenshotWindow>> | undefined
          if (params.window) {
            evidence = yield* Effect.promise(() => Computer.screenshotWindow(params.window).catch(() => undefined))
          }
          return {
            title: "Click " + params.x + "," + params.y,
            metadata: {
              target: `${params.x},${params.y}`,
              button: params.button ?? "left",
              verified: Boolean(evidence),
            },
            output: `Clicked at ${params.x},${params.y}${evidence ? " and captured post-action evidence." : "."}`,
            attachments: evidence
              ? [{ type: "file" as const, mime: evidence.mime, url: `data:${evidence.mime};base64,${evidence.base64}` }]
              : undefined,
          }
        }),
    }
  }),
)

export const ComputerSnapshotTool = Tool.define(
  "computer_snapshot",
  Effect.gen(function* () {
    return {
      description:
        "Inspect the foreground desktop window using native accessibility APIs (Windows UI Automation, macOS Accessibility, or Linux AT-SPI). Returns stable element refs, names, roles, enabled state and bounds, plus a window-only screenshot. Prefer computer_snapshot → computer_click(ref) over coordinate guessing.",
      parameters: SnapshotParameters,
      execute: (params: Schema.Schema.Type<typeof SnapshotParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ask(ctx, "snapshot", params.window ?? "foreground window")
          const result = yield* Effect.promise(() => Computer.snapshotWindow(params.window, true))
          const visible = result.elements.filter((item) => item.name || item.role)
          const lines = visible.map(
            (item) =>
              `[${item.ref}] ${item.role}${item.name ? ` "${item.name.replaceAll('"', "'")}"` : ""}${item.enabled ? "" : " (disabled)"}${item.automationId ? ` id=${item.automationId}` : ""} @ ${item.x},${item.y} ${item.width}x${item.height}`,
          )
          return {
            title: `Desktop snapshot: ${result.window.title}`,
            metadata: { window: result.window, count: visible.length },
            output: [`Window: ${result.window.title}`, ...lines].join("\n"),
            attachments: result.screenshot
              ? [
                  {
                    type: "file" as const,
                    mime: result.screenshot.mime,
                    url: `data:${result.screenshot.mime};base64,${result.screenshot.base64}`,
                  },
                ]
              : undefined,
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

export const ComputerWaitForWindowTool = Tool.define(
  "computer_wait_for_window",
  Effect.gen(function* () {
    return {
      description:
        "Wait until a window whose title contains the given text appears. Use this after launching a desktop app: a running background job is not proof the app opened. If this times out, read the launch job output and fix the failure instead of reporting success.",
      parameters: WaitWindowParameters,
      execute: (params: Schema.Schema.Type<typeof WaitWindowParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const timeoutMs = Math.min(Math.max(params.timeout_ms ?? 30_000, 500), 120_000)
          yield* ask(ctx, "wait_window", `${params.title} (${timeoutMs}ms)`)
          const result = yield* Effect.promise(() => Computer.waitForWindow(params.title, timeoutMs))
          return {
            title: result.found
              ? `Window found: ${result.window?.title ?? params.title}`
              : `Window not found: ${params.title}`,
            metadata: { found: result.found, waitedMs: result.waitedMs, window: result.window },
            output: result.found
              ? `Window appeared after ${result.waitedMs}ms: ${result.window?.title ?? params.title}`
              : [
                  `<window_not_found>No window matching "${params.title}" appeared within ${result.waitedMs}ms.</window_not_found>`,
                  "This is NOT success. Read the background job output for the launch command, fix the cause, and try again before reporting to the user.",
                ].join("\n"),
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
