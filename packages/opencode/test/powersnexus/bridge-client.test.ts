import { expect } from "bun:test"
import path from "node:path"
import { AppProcess } from "@opencode-ai/core/process"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { inspect, transition, validate } from "../../src/powersnexus/bridge-client"

const it = testEffect(AppProcess.defaultLayer)

const fakeBridge = String.raw`
const command = process.argv[3]
const changeName = process.argv[process.argv.indexOf("--change") + 1]
const snapshot = {
  protocolVersion: "1.0",
  powersnexusVersion: "6.1.0",
  changeName,
  level: null,
  phase: "needs_plan",
  status: "ready",
  revision: 123,
  artifactDigest: "a".repeat(64),
  requirements: [{ id: "REQ-101", module: "todo" }],
  tasks: [],
  blockers: [],
  nextAction: "create_plan",
  delivery: null,
  updatedAt: "2026-07-16T00:00:00.000Z"
}
if (command === "inspect") process.stdout.write(JSON.stringify(snapshot))
if (command === "validate") process.stdout.write(JSON.stringify({ valid: true, errors: [], snapshot }))
if (command === "transition") {
  let input = ""
  process.stdin.on("data", (chunk) => input += chunk)
  process.stdin.on("end", () => {
    const request = JSON.parse(input)
    process.stdout.write(JSON.stringify({ protocolVersion: "1.0", type: "action.started", actionID: request.actionID }) + "\n")
    process.stdout.write(JSON.stringify({ protocolVersion: "1.0", type: "action.completed", actionID: request.actionID, accepted: true, replayed: false, snapshot }) + "\n")
  })
}
`

it.instance("只调用 VersionRef 中的绝对 CLI，并解析 inspect/validate/transition", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const cliPath = path.join(tmp.directory, "powersnexus-cli.mjs")
    yield* Effect.promise(() => Bun.write(cliPath, fakeBridge))
    const version = {
      version: "6.1.0",
      protocolVersion: "1.0",
      digest: "4".repeat(64),
      source: "bundled" as const,
      compatible: true,
      verified: true,
      cliPath,
    }

    const inspected = yield* inspect({ version, worktree: tmp.directory, changeName: "react-todo" })
    const validated = yield* validate({ version, worktree: tmp.directory, changeName: "react-todo" })
    const completed = yield* transition({
      version,
      worktree: tmp.directory,
      changeName: "react-todo",
      request: { actionID: "action-0001", expectedRevision: 123, action: "verify", input: {} },
    })

    expect(inspected.changeName).toBe("react-todo")
    expect(validated.valid).toBe(true)
    expect(completed.type).toBe("action.completed")
    expect(completed.snapshot.artifactDigest).toBe("a".repeat(64))
  }),
)

it.instance("在执行前拒绝相对 CLI、越界 worktree 和不兼容协议", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const base = {
      version: "6.1.0",
      protocolVersion: "1.0",
      digest: "4".repeat(64),
      source: "bundled" as const,
      compatible: true,
      verified: true,
      cliPath: "relative-cli.js",
    }

    const relative = yield* Effect.exit(inspect({ version: base, worktree: tmp.directory, changeName: "react-todo" }))
    const protocol = yield* Effect.exit(
      inspect({
        version: { ...base, cliPath: path.join(tmp.directory, "missing.js"), protocolVersion: "2.0" },
        worktree: tmp.directory,
        changeName: "react-todo",
      }),
    )
    const invalidName = yield* Effect.exit(
      inspect({
        version: { ...base, cliPath: path.join(tmp.directory, "missing.js") },
        worktree: tmp.directory,
        changeName: "../escape",
      }),
    )

    expect(relative._tag).toBe("Failure")
    expect(protocol._tag).toBe("Failure")
    expect(invalidName._tag).toBe("Failure")
  }),
)

it.instance("Bridge 失败不会在错误消息和 evidence 中泄露秘密", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const cliPath = path.join(tmp.directory, "powersnexus-failure.mjs")
    yield* Effect.promise(() =>
      Bun.write(
        cliPath,
        `process.stderr.write(JSON.stringify({
          protocolVersion: "1.0",
          error: {
            code: "ARTIFACT_INVALID",
            message: "Authorization: Bearer top-secret-token",
            recoverable: true,
            evidence: ["https://example.test/log?access_token=top-secret-token"]
          }
        })); process.exit(2)`,
      ),
    )
    const version = {
      version: "6.1.0",
      protocolVersion: "1.0",
      digest: "4".repeat(64),
      source: "bundled" as const,
      compatible: true,
      verified: true,
      cliPath,
    }
    const exit = yield* Effect.exit(inspect({ version, worktree: tmp.directory, changeName: "redact-test" }))
    expect(exit._tag).toBe("Failure")
    const rendered = JSON.stringify(exit)
    expect(rendered).not.toContain("top-secret-token")
    expect(rendered).toContain("***REDACTED***")
  }),
  { git: true },
)
