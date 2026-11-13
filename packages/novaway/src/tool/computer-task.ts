import { Effect, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Tool from "./tool"
import * as Computer from "@/computer/computer"
import * as Annotate from "@/computer/annotate"
import { Config } from "@/config/config"
import { ConfigComputer } from "@/config/computer"
import { runComputerLoop, type ComputerAction } from "@/computer/loop"
import { makeRunAgent, type RunAgentPromptOps } from "@/session/agent-step"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { MessageV2 } from "@/session/message-v2"

/**
 * Multi-step computer use: screenshot → decide → act → screenshot, bounded by
 * `computer.max_steps`. Disabled by default, and every action still goes through
 * the `computer` permission, so enabling the loop never grants silent control.
 *
 * Decisions come from a fresh subagent per step because a tool cannot ask the
 * parent model mid-call. The screenshot is passed by path: the subagent reads it
 * with the image-capable read tool instead of receiving a base64 blob in text.
 */

const Parameters = Schema.Struct({
  goal: Schema.String.annotate({
    description: "What the user wants done on screen. Be concrete: which app and what end state.",
  }),
  window: Schema.optional(Schema.String).annotate({
    description: "Window title (or part of it) to capture. Strongly preferred over the whole desktop.",
  }),
  max_steps: Schema.optional(Schema.Number).annotate({
    description: "Override computer.max_steps for this run (still capped by config).",
  }),
  annotate: Schema.optional(Schema.Boolean).annotate({
    description:
      "Draw a coordinate grid over each screenshot so the model can read absolute screen coordinates (default: true).",
  }),
  regions: Schema.optional(
    Schema.mutable(
      Schema.Array(
        Schema.Struct({
          x: Schema.Number,
          y: Schema.Number,
          width: Schema.Number,
          height: Schema.Number,
          label: Schema.optional(Schema.String),
        }),
      ),
    ),
  ).annotate({
    description: "Optional numbered boxes to highlight on every screenshot (screenshot pixels).",
  }),
})

const decidePrompt = (input: {
  goal: string
  step: number
  maxSteps: number
  screenshot: Computer.Screenshot
  window?: string
  annotation?: Annotate.Annotation
}) =>
  [
    "You are the decision step of a computer-use loop. Do not call tools other than read.",
    `Goal: ${input.goal}`,
    input.window ? `Target window: ${input.window}` : "Target: whole desktop",
    `Step ${input.step} of ${input.maxSteps}.`,
    `Screenshot path: ${input.screenshot.path}`,
    "Read that image first, then choose exactly one action.",
    ...(input.annotation
      ? [
          `The image has a ${input.annotation.columns}x${input.annotation.rows} grid. Each cell's top-left label is the absolute screen coordinate of that pixel — read the target's label instead of estimating.`,
          ...(input.annotation.regions.length
            ? [
                "Numbered regions (absolute screen coordinates):",
                ...input.annotation.regions.map((region) =>
                  `  ${region.label ?? ""} ${region.screenX},${region.screenY} ${region.width}x${region.height}`.trim(),
                ),
              ]
            : []),
        ]
      : []),
    'Reply with ONLY JSON: {"type":"click","x":123,"y":456} | {"type":"move","x":1,"y":2} | {"type":"scroll","amount":-3} | {"type":"type","text":"..."} | {"type":"key","keys":"CTRL+S"} | "done".',
    'Coordinates are absolute screen pixels. Use "done" only when the goal is visibly achieved or impossible.',
  ].join("\n")

function parseDecision(text: string): ComputerAction | "done" | undefined {
  const trimmed = text.trim()
  const fenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim()
  if (fenced === '"done"' || fenced === "done" || fenced === "'done'") return "done"
  const start = fenced.indexOf("{")
  const end = fenced.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  let value: unknown
  try {
    value = JSON.parse(fenced.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (!value || typeof value !== "object") return undefined
  const type = Reflect.get(value, "type")
  const num = (key: string) => {
    const raw = Reflect.get(value, key)
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined
  }
  const str = (key: string) => {
    const raw = Reflect.get(value, key)
    return typeof raw === "string" && raw.trim() ? raw : undefined
  }
  if (type === "click") {
    const x = num("x")
    const y = num("y")
    if (x === undefined || y === undefined) return undefined
    const button = str("button")
    return {
      type: "click",
      x,
      y,
      ...(button === "left" || button === "right" || button === "middle" ? { button } : {}),
    }
  }
  if (type === "move") {
    const x = num("x")
    const y = num("y")
    return x === undefined || y === undefined ? undefined : { type: "move", x, y }
  }
  if (type === "scroll") {
    const amount = num("amount")
    return amount === undefined ? undefined : { type: "scroll", amount }
  }
  if (type === "type") {
    const text = str("text")
    return text === undefined ? undefined : { type: "type", text }
  }
  if (type === "key") {
    const keys = str("keys")
    return keys === undefined ? undefined : { type: "key", keys }
  }
  return undefined
}

function describe(action: ComputerAction) {
  if (action.type === "click") return `click ${action.x},${action.y}`
  if (action.type === "move") return `move ${action.x},${action.y}`
  if (action.type === "scroll") return `scroll ${action.amount}`
  if (action.type === "type") return `type ${action.text.slice(0, 40)}`
  return `key ${action.keys}`
}

/**
 * Screenshot files are removed right after being read, so the decision subagent
 * would find nothing at `screenshot.path`. Persist one copy for the step.
 */
async function persistForStep(shot: Computer.Screenshot) {
  const file = path.join(os.tmpdir(), `novaway-step-${process.pid}-${Date.now()}.png`)
  await fs.writeFile(file, Buffer.from(shot.base64, "base64"))
  return { ...shot, path: file }
}

async function act(action: ComputerAction) {
  if (action.type === "click") {
    await Computer.click({ x: action.x, y: action.y, button: action.button })
    return
  }
  if (action.type === "move") {
    await Computer.move(action.x, action.y)
    return
  }
  if (action.type === "scroll") {
    await Computer.scroll(action.amount)
    return
  }
  if (action.type === "type") {
    await Computer.type(action.text)
    return
  }
  await Computer.key(action.keys)
}

export const ComputerTaskTool = Tool.define<
  typeof Parameters,
  { status?: string; steps?: number },
  Config.Service | Session.Service | Agent.Service
>(
  "computer_task",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service

    return {
      description:
        "Run a bounded screenshot→decide→act loop against a desktop window. Disabled unless computer.enabled is true. " +
        "Every action asks for the `computer` permission. Prefer the single-step computer_* tools when one action suffices.",
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context<{ status?: string; steps?: number }>,
      ) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          const computer = ConfigComputer.resolve(cfg.computer)
          if (!computer.enabled) {
            return yield* Effect.die(new Error("computer_task is disabled; set computer.enabled = true in config"))
          }

          const message = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
            Effect.orDie,
          )
          if (message.info.role !== "assistant") {
            return yield* Effect.die(new Error("computer_task must run inside an assistant turn"))
          }
          const ops = ctx.extra?.promptOps as RunAgentPromptOps | undefined
          if (!ops) return yield* Effect.die(new Error("computer_task requires promptOps in ctx.extra"))

          const runAgent = makeRunAgent({
            ops,
            sessions,
            agents,
            parentSessionID: ctx.sessionID,
            defaultModel: { providerID: message.info.providerID, modelID: message.info.modelID },
            defaultAgent: ctx.agent,
          })

          const maxSteps = Math.min(Math.max(1, params.max_steps ?? computer.max_steps), computer.max_steps)

          const annotate = params.annotate !== false
          const result = yield* Effect.promise(() =>
            runComputerLoop<Computer.Screenshot>({
              enabled: true,
              maxSteps,
              backend: {
                screenshot: async () => {
                  const shot = params.window
                    ? await Computer.screenshotWindow(params.window)
                    : await Computer.screenshot()
                  if (!annotate) return persistForStep(shot)
                  return Annotate.annotate(shot, params.regions ? { regions: params.regions } : {})
                },
                decide: async (observation, step) => {
                  const annotation = (observation as Partial<Annotate.AnnotatedScreenshot>).annotation
                  try {
                    const decision = await Effect.runPromise(
                      runAgent({
                        agent: "general",
                        prompt: decidePrompt({
                          goal: params.goal,
                          step,
                          maxSteps,
                          screenshot: observation,
                          ...(params.window ? { window: params.window } : {}),
                          ...(annotation ? { annotation } : {}),
                        }),
                        title: `computer_task step ${step}`,
                      }).pipe(
                        Effect.map((result) => result.text),
                        Effect.catchCause(() => Effect.succeed("")),
                      ),
                    )
                    return parseDecision(decision) ?? "done"
                  } finally {
                    await fs.rm(observation.path, { force: true })
                  }
                },
                approve: (action) =>
                  Effect.runPromise(
                    ctx
                      .ask({
                        permission: "computer",
                        patterns: [action.type],
                        always: [],
                        metadata: { action: action.type, detail: describe(action) },
                      })
                      .pipe(
                        Effect.as(true),
                        Effect.catchCause(() => Effect.succeed(false)),
                      ),
                  ),
                act,
              },
            }),
          )

          const summary = `status: ${result.status}\nsteps: ${result.steps}`
          return {
            title: `Computer task (${result.status}, ${result.steps} steps)`,
            output: summary,
            metadata: { status: result.status, steps: result.steps },
          }
        }),
    }
  }),
)
