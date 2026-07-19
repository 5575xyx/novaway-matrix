import { expect } from "bun:test"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem } from "effect"
import { createFingerprint } from "../../src/powersnexus/evidence"
import type { RunStep } from "../../src/powersnexus/run-repository"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(NodeFileSystem.layer)

function step(argument: string): RunStep {
  return {
    id: "pnr_evidence:build",
    run_id: "pnr_evidence",
    step_id: "build",
    sequence: 0,
    kind: "profile",
    profile_step_id: "build",
    argv: [process.execPath, argument],
    cwd: ".",
    timeout_ms: null,
    status: "passed",
    exit_code: 0,
    stdout_file: null,
    stderr_file: null,
    artifacts: [],
    evidence_digest: "a".repeat(64),
    time_started: 1,
    time_ended: 2,
    time_created: 1,
    time_updated: 2,
  }
}

it.instance("对规范化文件、步骤证据和环境生成稳定交付指纹", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.join(tmp.directory, "src"), { recursive: true })
    yield* fs.writeFileString(path.join(tmp.directory, "src", "a.ts"), "export const a = 1\n")
    yield* fs.writeFileString(path.join(tmp.directory, "package.json"), "{}\n")
    const input = {
      worktree: tmp.directory,
      files: ["src\\a.ts", "package.json", "src/a.ts"],
      steps: [step("-v")],
      profile: "library",
    }
    const first = yield* createFingerprint(input)
    const replay = yield* createFingerprint({ ...input, files: [...input.files].reverse() })
    expect(first.files).toEqual(["package.json", "src/a.ts"])
    expect(first.commands).toEqual([{ id: "build", argv: [process.execPath, "-v"], timeoutMs: null }])
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(replay.digest).toBe(first.digest)
    expect(first.environment).toEqual({ platform: process.platform, arch: process.arch, node: process.version })

    yield* fs.writeFileString(path.join(tmp.directory, "src", "a.ts"), "export const a = 2\n")
    expect((yield* createFingerprint(input)).digest).not.toBe(first.digest)
    expect((yield* createFingerprint({ ...input, steps: [step("--version")] })).digest).not.toBe(first.digest)
  }),
  { git: true },
)

it.instance("拒绝 Worktree 外的证据文件", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const result = yield* Effect.exit(
      createFingerprint({ worktree: tmp.directory, files: ["../escape.txt"], steps: [], profile: "library" }),
    )
    expect(result._tag).toBe("Failure")
  }),
  { git: true },
)
