import path from "node:path"
import { AppProcess } from "@opencode-ai/core/process"
import { NodeFileSystem } from "@effect/platform-node"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import { PowersNexusBrowser } from "./browser"

export type Viewport = { name: string; width: number; height: number }

export const DEFAULT_VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
]

export type BrowserQaScenario = {
  id: string
  url: string
  steps?: ReadonlyArray<
    | { type: "snapshot" }
    | { type: "click"; ref: string }
    | { type: "fill"; ref: string; value: string }
    | { type: "press"; key: string; ref?: string }
    | { type: "screenshot"; fullPage?: boolean }
  >
  requiredText?: ReadonlyArray<string>
}

export type BrowserQaServer = {
  argv: ReadonlyArray<string>
  cwd: string
  healthUrl: string
  timeoutMs?: number
}

export type BrowserQaRequest = {
  scenarios: ReadonlyArray<BrowserQaScenario>
  viewports?: ReadonlyArray<Viewport>
  server?: BrowserQaServer
}

export type BrowserQaResult = {
  scenarioID: string
  viewport: string
  url: string
  title: string
  screenshots: string[]
  consoleErrors: string[]
  failedNetwork: Array<{ method: string; url: string; status?: number }>
  accessibility: string
  overflow: boolean
  focusVisible: boolean
  blank: boolean
  missingText: string[]
  passed: boolean
  evidenceFiles: string[]
}

export class BrowserQaError extends Schema.TaggedErrorClass<BrowserQaError>()("PowersNexusBrowserQaError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export interface Interface {
  readonly run: (input: {
    worktree: string
    scenarios: BrowserQaRequest["scenarios"]
    viewports?: BrowserQaRequest["viewports"]
    server?: BrowserQaRequest["server"]
  }) => Effect.Effect<BrowserQaResult[], BrowserQaError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PowersNexusBrowserQa") {}

function qaError(code: string, message: string) {
  return new BrowserQaError({ code, message })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const browser = yield* PowersNexusBrowser.Service
    const fs = yield* FileSystem.FileSystem
    const appProcess = yield* AppProcess.Service

    const map = <A>(effect: Effect.Effect<A, unknown>) =>
      effect.pipe(
        Effect.mapError((cause) =>
          cause instanceof BrowserQaError
            ? cause
            : qaError(
                typeof cause === "object" &&
                  cause &&
                  "code" in cause &&
                  typeof (cause as { code: unknown }).code === "string"
                  ? (cause as { code: string }).code
                  : "BROWSER_QA_FAILED",
                cause instanceof Error ? cause.message : "Browser QA 执行失败",
              ),
        ),
      )

    const waitForHealth = Effect.fnUntraced(function* (url: string, handle?: ChildProcessHandle, timeoutMs = 60_000) {
      const deadline = Date.now() + Math.max(1_000, Math.min(timeoutMs, 10 * 60_000))
      const probe = () =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
            return response.status < 500
          },
          catch: () => new Error("Browser QA 健康探测失败"),
        }).pipe(Effect.orElseSucceed(() => false))
      const loop = (): Effect.Effect<void, BrowserQaError> => Effect.gen(function* () {
        if (yield* probe()) return
        if (handle && !(yield* handle.isRunning.pipe(Effect.mapError(() => qaError("BROWSER_QA_SERVICE_EXITED", "Browser QA 服务状态读取失败"))))) {
          return yield* qaError("BROWSER_QA_SERVICE_EXITED", "Browser QA 服务在健康探测前退出")
        }
        if (Date.now() >= deadline) return yield* qaError("BROWSER_QA_HEALTH_TIMEOUT", `Browser QA 健康探测超时：${url}`)
        yield* Effect.sleep("100 millis")
        return yield* loop()
      })
      yield* loop()
    })

    const runScenarios = Effect.fnUntraced(function* (input: {
      worktree: string
      scenarios: ReadonlyArray<BrowserQaScenario>
      viewports?: ReadonlyArray<Viewport>
    }) {
      if (input.scenarios.length === 0) return []
      const viewports = input.viewports ?? DEFAULT_VIEWPORTS
      const root = path.resolve(input.worktree)
      const outDir = path.join(root, ".novaway", "powersnexus", "browser-qa")
      yield* map(fs.makeDirectory(outDir, { recursive: true }))
      const results: BrowserQaResult[] = []

      for (const scenario of input.scenarios) {
        for (const viewport of viewports) {
          const screenshots: string[] = []
          const evidenceFiles: string[] = []
          yield* map(browser.setViewport(viewport.width, viewport.height))
          const opened = yield* map(browser.navigate(scenario.url))
          yield* map(browser.press("Escape")).pipe(Effect.catch(() => Effect.void))
          for (const step of scenario.steps ?? [{ type: "snapshot" as const }, { type: "screenshot" as const }]) {
            if (step.type === "snapshot") yield* map(browser.snapshot())
            if (step.type === "click") yield* map(browser.click(step.ref))
            if (step.type === "fill") yield* map(browser.fill(step.ref, step.value))
            if (step.type === "press") yield* map(browser.press(step.key, step.ref))
            if (step.type === "screenshot") {
              const shot = yield* map(browser.screenshot(step.fullPage === true))
              const relative = path.relative(root, shot.path).replaceAll("\\", "/")
              screenshots.push(relative)
              evidenceFiles.push(relative)
            }
          }
          const snap = yield* map(browser.snapshot())
          const consoleLines = yield* map(browser.console())
          const network = yield* map(browser.network())
          const accessibility = yield* map(browser.accessibility())
          const consoleErrors = consoleLines.filter((line) => line.includes("[error]") || line.includes("Error"))
          const failedNetwork = network.filter((item) => typeof item.status === "number" && item.status >= 400)
          const missingText = (scenario.requiredText ?? []).filter((text) => !snap.text.includes(text))
          const blank = snap.bodyText.trim().length === 0 && snap.refs.length === 0
          const overflow = snap.overflow
          const passed = consoleErrors.length === 0 && failedNetwork.length === 0 && missingText.length === 0 && !blank && !overflow && snap.focusVisible
          const reportPath = path.join(outDir, `${scenario.id}-${viewport.name}.json`)
          const snapshotPath = path.join(outDir, `${scenario.id}-${viewport.name}.snapshot.json`)
          yield* map(
            fs.writeFileString(
              snapshotPath,
              JSON.stringify({ url: snap.url, title: snap.title, text: snap.bodyText, refs: snap.refs, overflow, focusVisible: snap.focusVisible }, null, 2),
            ),
          )
          const snapshotRelative = path.relative(root, snapshotPath).replaceAll("\\", "/")
          evidenceFiles.push(snapshotRelative)
          const report = {
            scenarioID: scenario.id,
            viewport: viewport.name,
            url: opened.url,
            title: snap.title,
            screenshots,
            consoleErrors,
            failedNetwork,
            accessibility: accessibility.slice(0, 4000),
            overflow,
            focusVisible: snap.focusVisible,
            blank,
            missingText,
            passed,
            evidenceFiles,
            snapshotRefs: snap.refs,
          }
          yield* map(fs.writeFileString(reportPath, JSON.stringify(report, null, 2)))
          evidenceFiles.push(path.relative(root, reportPath).replaceAll("\\", "/"))
          results.push({ ...report, accessibility, evidenceFiles })
        }
      }
      return results
    })

    const run = Effect.fn("PowersNexus.BrowserQa.run")(function* (input: {
      worktree: string
      scenarios: ReadonlyArray<BrowserQaScenario>
      viewports?: ReadonlyArray<Viewport>
      server?: BrowserQaServer
    }) {
      if (input.scenarios.length === 0) return []
      const root = path.resolve(input.worktree)
      const execute = input.server
        ? Effect.scoped(
            Effect.gen(function* () {
              const cwd = path.resolve(root, input.server!.cwd)
              const relative = path.relative(root, cwd)
              if (relative.startsWith("..") || path.isAbsolute(relative)) return yield* qaError("PATH_OUTSIDE_WORKTREE", "Browser QA 服务 cwd 越出 Worktree")
              if (input.server!.argv.length === 0 || !input.server!.argv[0]) return yield* qaError("BROWSER_QA_SERVICE_INVALID", "Browser QA 服务 argv 不能为空")
              const handle = yield* appProcess.spawn(
                ChildProcess.make(input.server!.argv[0], input.server!.argv.slice(1), {
                  cwd,
                  extendEnv: true,
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "ignore",
                }),
              )
              yield* waitForHealth(input.server!.healthUrl, handle, input.server!.timeoutMs)
              return yield* runScenarios(input)
            }),
          )
        : runScenarios(input)
      return yield* map(execute.pipe(Effect.ensuring(browser.close().pipe(Effect.ignore))))
    })

    return Service.of({ run })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(PowersNexusBrowser.defaultLayer),
  Layer.provide(AppProcess.defaultLayer),
  Layer.provide(NodeFileSystem.layer),
)

export * as PowersNexusBrowserQa from "./browser-qa"
