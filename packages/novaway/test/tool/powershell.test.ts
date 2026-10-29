import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import type * as Scope from "effect/Scope"
import { Config } from "@/config/config"
import { Shell } from "@/shell/shell"
import { PowerShellTool } from "@/tool/shell"
import { provideInstance } from "../fixture/fixture"
import type { Permission } from "@/permission"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "@/session/schema"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Plugin } from "@/plugin"
import { testEffect } from "../lib/effect"
import { Tool } from "@/tool/tool"
import { RuntimeFlags } from "@/effect/runtime-flags"

const layer = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  AppFileSystem.defaultLayer,
  Plugin.defaultLayer,
  Truncate.defaultLayer,
  Config.defaultLayer,
  Agent.defaultLayer,
  RuntimeFlags.defaultLayer,
  BackgroundJob.defaultLayer,
)
const it = testEffect(layer)

// The standalone tool is only registered when a PowerShell binary exists; skip
// the execution cases elsewhere so CI on Linux without pwsh stays green.
const available = Boolean(Shell.powershell())

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const withShell = <A, E, R>(value: string | undefined, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.SHELL
      if (value === undefined) delete process.env.SHELL
      else process.env.SHELL = value
      Shell.acceptable.reset()
      Shell.preferred.reset()
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env.SHELL
        else process.env.SHELL = prev
        Shell.acceptable.reset()
        Shell.preferred.reset()
      }),
  )

const run = Effect.fn("PowerShellToolTest.run")(function* (
  args: Tool.InferParameters<typeof PowerShellTool>,
  next: Tool.Context = ctx,
) {
  const info = yield* PowerShellTool
  const powershell = yield* info.init()
  return yield* powershell.execute(args, next)
})

const runIn = <A, E, R>(directory: string, self: Effect.Effect<A, E, R>) => self.pipe(provideInstance(directory))

describe("tool.powershell", () => {
  test("registers under its own id", () => {
    expect(PowerShellTool.id).toBe("powershell")
  })

  test("resolves a PowerShell binary", () => {
    const shell = Shell.powershell()
    if (!available) expect(shell).toBeUndefined()
    else expect(Shell.ps(shell!)).toBe(true)
  })

  it.live(
    "runs PowerShell even when the configured shell is bash",
    () =>
      withShell(
        process.platform === "win32" ? "C:\Windows\System32\cmd.exe" : "/bin/bash",
        runIn(
          process.cwd(),
          Effect.gen(function* () {
            if (!available) return
            // `Write-Output` is a cmdlet: bash would fail on it, so a successful
            // run proves the standalone tool ignored the configured shell.
            const result = yield* run({
              command: "$PSVersionTable.PSVersion.Major | Write-Output",
              description: "Print PowerShell major version",
            })
            expect(result.metadata.exit).toBe(0)
            expect(Number(result.output.trim())).toBeGreaterThanOrEqual(5)
          }),
        ),
      ),
    30_000,
  )

  it.live(
    "asks for the powershell permission, not bash",
    () =>
      runIn(
        process.cwd(),
        Effect.gen(function* () {
          if (!available) return
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            { command: "Write-Output 'permission probe'", description: "Permission probe" },
            {
              ...ctx,
              ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
                Effect.sync(() => {
                  requests.push(req)
                }),
            },
          )
          expect(requests.every((req) => req.permission !== "bash")).toBe(true)
          expect(requests.some((req) => req.permission === "powershell")).toBe(true)
        }),
      ),
    30_000,
  )

  it.live(
    "reports the PowerShell exit code",
    () =>
      runIn(
        process.cwd(),
        Effect.gen(function* () {
          if (!available) return
          const result = yield* run({
            command: "Write-Output 'boom'; exit 3",
            description: "Exit with code 3",
          })
          expect(result.metadata.exit).toBe(3)
          expect(result.output).toContain("Exit code 3")
        }),
      ),
    30_000,
  )
})
