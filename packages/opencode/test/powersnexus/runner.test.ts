import { expect } from "bun:test"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { AppProcess } from "@opencode-ai/core/process"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { InstanceState } from "../../src/effect/instance-state"
import { Effect, Layer } from "effect"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { make as makeRepository } from "../../src/powersnexus/repository"
import { make as makeRunner } from "../../src/powersnexus/runner"
import { make as makeRunRepository } from "../../src/powersnexus/run-repository"

const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, AppProcess.defaultLayer, BackgroundJob.defaultLayer, Bus.layer))

it.instance("按 argv 顺序执行步骤，持久日志与证据并完成 run", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const ctx = yield* InstanceState.context
    const repository = yield* makeRepository()
    const version = {
      version: "6.1.0",
      protocolVersion: "1.0",
      digest: "a".repeat(64),
      source: "bundled",
      compatible: true,
      verified: true,
      cliPath: path.join(tmp.directory, "powersnexus-cli.js"),
    } as const
    const binding = yield* repository.create({
      projectID: ctx.project.id,
      worktree: tmp.directory,
      changeName: "runner-test",
      level: "L2",
      version,
    })
    const runner = yield* makeRunner()
    const started = yield* runner.start({
      bindingID: binding.id,
      action: "verify",
      snapshotRevision: 1,
      worktree: tmp.directory,
      steps: [
        { id: "build", argv: [process.execPath, "-e", "console.log('build-ok')"], cwd: tmp.directory },
        { id: "test", argv: [process.execPath, "-e", "console.error('test-ok')"], cwd: tmp.directory },
      ],
    })
    const waited = yield* runner.wait(started.runID, 30_000)
    expect(waited.timedOut).toBe(false)
    expect(waited.info?.status).toBe("completed")
    const result = yield* runner.get(started.runID)
    expect(result.run?.status).toBe("passed")
    expect(result.steps.map((step) => step.status)).toEqual(["passed", "passed"])
    expect(result.steps.every((step) => /^[a-f0-9]{64}$/.test(step.evidence_digest ?? ""))).toBe(true)
    expect(yield* Effect.promise(() => Bun.file(result.steps[0].stdout_file!).text())).toContain("build-ok")
    expect(yield* Effect.promise(() => Bun.file(result.steps[1].stderr_file!).text())).toContain("test-ok")
    const first = yield* runner.log({ runID: started.runID, stepID: "build", stream: "stdout", offset: 0, limit: 5 })
    const second = yield* runner.log({
      runID: started.runID,
      stepID: "build",
      stream: "stdout",
      offset: first.nextOffset,
      limit: 64,
    })
    expect(first).toMatchObject({ text: "build", offset: 0, nextOffset: 5, eof: false })
    expect(second).toMatchObject({ text: "-ok\n", offset: 5, eof: true })
  }),
  { git: true },
)

it.instance("进程超时时持久化失败状态与可分页错误日志", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const ctx = yield* InstanceState.context
    const repository = yield* makeRepository()
    const binding = yield* repository.create({
      projectID: ctx.project.id,
      worktree: tmp.directory,
      changeName: "runner-process-error",
      level: "L2",
      version: {
        version: "6.1.0",
        protocolVersion: "1.0",
        digest: "f".repeat(64),
        source: "bundled",
        compatible: true,
        verified: true,
        cliPath: path.join(tmp.directory, "powersnexus-cli.js"),
      },
    })
    const runner = yield* makeRunner()
    const started = yield* runner.start({
      bindingID: binding.id,
      action: "verify",
      snapshotRevision: 6,
      worktree: tmp.directory,
      steps: [
        {
          id: "timeout",
          argv: [process.execPath, "-e", "setTimeout(()=>{},30000)"],
          cwd: tmp.directory,
          timeoutMs: 25,
        },
      ],
    })
    expect((yield* runner.wait(started.runID, 30_000)).info?.status).toBe("error")
    const result = yield* runner.get(started.runID)
    expect(result.run?.status).toBe("failed")
    expect(result.run?.error_code).toBe("RUN_PROCESS_ERROR")
    expect(result.steps[0]?.status).toBe("failed")
    const log = yield* runner.log({ runID: started.runID, stepID: "timeout", stream: "stderr", offset: 0, limit: 64 })
    expect(log.text).toBe("进程执行失败")
    expect(log.eof).toBe(true)
  }),
  { git: true },
)

it.instance("步骤失败时停止后续步骤并拒绝 Worktree 外 cwd", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const ctx = yield* InstanceState.context
    const repository = yield* makeRepository()
    const binding = yield* repository.create({
      projectID: ctx.project.id,
      worktree: tmp.directory,
      changeName: "runner-failure",
      level: "L2",
      version: {
        version: "6.1.0",
        protocolVersion: "1.0",
        digest: "b".repeat(64),
        source: "bundled",
        compatible: true,
        verified: true,
        cliPath: path.join(tmp.directory, "powersnexus-cli.js"),
      },
    })
    const runner = yield* makeRunner()
    const started = yield* runner.start({
      bindingID: binding.id,
      action: "verify",
      snapshotRevision: 2,
      worktree: tmp.directory,
      steps: [
        { id: "fail", argv: [process.execPath, "-e", "process.exit(7)"], cwd: tmp.directory },
        { id: "never", argv: [process.execPath, "-e", "console.log('never')"], cwd: tmp.directory },
      ],
    })
    expect((yield* runner.wait(started.runID, 30_000)).info?.status).toBe("error")
    const failed = yield* runner.get(started.runID)
    expect(failed.run?.status).toBe("failed")
    expect(failed.steps.map((step) => step.status)).toEqual(["failed", "pending"])

    const outside = yield* Effect.exit(
      runner.start({
        bindingID: binding.id,
        action: "verify",
        snapshotRevision: 2,
        worktree: tmp.directory,
        steps: [{ id: "escape", argv: [process.execPath, "-v"], cwd: path.dirname(tmp.directory) }],
      }),
    )
    expect(outside._tag).toBe("Failure")
  }),
  { git: true },
)

it.instance("失败步骤探测通过后重新执行全部步骤并递增 attempt", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const ctx = yield* InstanceState.context
    const repository = yield* makeRepository()
    const binding = yield* repository.create({
      projectID: ctx.project.id,
      worktree: tmp.directory,
      changeName: "runner-retry",
      level: "L2",
      version: {
        version: "6.1.0",
        protocolVersion: "1.0",
        digest: "c".repeat(64),
        source: "bundled",
        compatible: true,
        verified: true,
        cliPath: path.join(tmp.directory, "powersnexus-cli.js"),
      },
    })
    const marker = path.join(tmp.directory, "retry-marker")
    const counter = path.join(tmp.directory, "full-run-counter")
    const runner = yield* makeRunner()
    const started = yield* runner.start({
      bindingID: binding.id,
      action: "verify",
      snapshotRevision: 3,
      worktree: tmp.directory,
      steps: [
        {
          id: "setup",
          argv: [
            process.execPath,
            "-e",
            `const f=${JSON.stringify(counter)};const n=Number(require('fs').existsSync(f)&&require('fs').readFileSync(f,'utf8')||0);require('fs').writeFileSync(f,String(n+1))`,
          ],
          cwd: tmp.directory,
        },
        {
          id: "flaky",
          argv: [
            process.execPath,
            "-e",
            `const fs=require('fs');const f=${JSON.stringify(marker)};if(!fs.existsSync(f)){fs.writeFileSync(f,'ready');process.exit(7)}`,
          ],
          cwd: tmp.directory,
        },
      ],
    })
    expect((yield* runner.wait(started.runID, 30_000)).info?.status).toBe("error")

    const retried = yield* runner.retry(started.runID)
    expect((yield* runner.wait(retried.runID, 30_000)).info?.status).toBe("completed")
    const result = yield* runner.get(retried.runID)
    expect(result.run?.attempt).toBe(2)
    expect(result.steps.map((step) => step.step_id)).toEqual(["flaky.retry", "setup", "flaky"])
    expect(result.steps.map((step) => step.status)).toEqual(["passed", "passed", "passed"])
    expect(yield* Effect.promise(() => Bun.file(counter).text())).toBe("2")
  }),
  { git: true },
)

it.instance("取消活动 run 并将运行步骤持久化为 cancelled", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const ctx = yield* InstanceState.context
    const repository = yield* makeRepository()
    const binding = yield* repository.create({
      projectID: ctx.project.id,
      worktree: tmp.directory,
      changeName: "runner-cancel",
      level: "L2",
      version: {
        version: "6.1.0",
        protocolVersion: "1.0",
        digest: "d".repeat(64),
        source: "bundled",
        compatible: true,
        verified: true,
        cliPath: path.join(tmp.directory, "powersnexus-cli.js"),
      },
    })
    const runner = yield* makeRunner()
    const started = yield* runner.start({
      bindingID: binding.id,
      action: "verify",
      snapshotRevision: 4,
      worktree: tmp.directory,
      steps: [{ id: "long", argv: [process.execPath, "-e", "setTimeout(()=>{},30000)"], cwd: tmp.directory }],
    })
    yield* pollWithTimeout(
      runner.get(started.runID).pipe(
        Effect.map((result) => (result.steps[0]?.status === "running" ? true : undefined)),
      ),
      "run 步骤未进入 running",
    )
    expect((yield* runner.cancel(started.runID))?.status).toBe("cancelled")
    const result = yield* runner.get(started.runID)
    expect(result.run?.status).toBe("cancelled")
    expect(result.run?.error_code).toBe("RUN_CANCELLED")
    expect(result.steps[0]?.status).toBe("cancelled")
  }),
  { git: true },
)

it.instance("恢复时将遗留的 running run 与步骤标记为 interrupted", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const ctx = yield* InstanceState.context
    const repository = yield* makeRepository()
    const runRepository = yield* makeRunRepository()
    const binding = yield* repository.create({
      projectID: ctx.project.id,
      worktree: tmp.directory,
      changeName: "runner-recover",
      level: "L2",
      version: {
        version: "6.1.0",
        protocolVersion: "1.0",
        digest: "e".repeat(64),
        source: "bundled",
        compatible: true,
        verified: true,
        cliPath: path.join(tmp.directory, "powersnexus-cli.js"),
      },
    })
    const now = Date.now()
    const runID = "pnr_recovery_test"
    yield* runRepository.createRun({
      id: runID,
      binding_id: binding.id,
      action: "verify",
      status: "running",
      attempt: 1,
      snapshot_revision: 5,
      log_directory: path.join(tmp.directory, ".novaway", "powersnexus", "runs", runID),
      recovery_policy: "retry-failed-step-then-full-run",
      time_created: now,
      time_updated: now,
    })
    yield* runRepository.createSteps([
      {
        id: `${runID}:build`,
        run_id: runID,
        step_id: "build",
        sequence: 0,
        profile_step_id: "build",
        argv: [process.execPath, "-v"],
        cwd: tmp.directory,
        status: "running",
        artifacts: [],
        time_created: now,
        time_updated: now,
      },
    ])
    const runner = yield* makeRunner()
    expect((yield* runner.recover()).map((run) => run.id)).toContain(runID)
    const result = yield* runner.get(runID)
    expect(result.run?.status).toBe("interrupted")
    expect(result.run?.error_code).toBe("RUN_INTERRUPTED")
    expect(result.steps[0]?.status).toBe("cancelled")
  }),
  { git: true },
)

it.instance("服务步骤就绪后托管进程并继续后续步骤，结束时清理服务", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    const ctx = yield* InstanceState.context
    const repository = yield* makeRepository()
    const binding = yield* repository.create({
      projectID: ctx.project.id,
      worktree: tmp.directory,
      changeName: "runner-service-mode",
      level: "L2",
      version: {
        version: "6.1.0",
        protocolVersion: "1.0",
        digest: "b".repeat(64),
        source: "bundled",
        compatible: true,
        verified: true,
        cliPath: path.join(tmp.directory, "powersnexus-cli.js"),
      },
    })
    const runner = yield* makeRunner()
    const serverScript = path.join(tmp.directory, "service-server.js")
    yield* Effect.promise(() =>
      Bun.write(
        serverScript,
        `
const http = require("http");
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end("no");
});
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  console.log("PORT=" + port);
  require("fs").writeFileSync(${JSON.stringify(path.join(tmp.directory, "service-port.txt").replace(/\\/g, "\\\\"))}, String(port));
});
setInterval(() => {}, 1 << 30);
`,
      ),
    )
    // 用固定端口脚本：先选端口再启动
    const port = 18765 + Math.floor(Math.random() * 1000)
    yield* Effect.promise(() =>
      Bun.write(
        serverScript,
        `
const http = require("http");
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end("no");
});
server.listen(${port}, "127.0.0.1");
setInterval(() => {}, 1 << 30);
`,
      ),
    )
    const started = yield* runner.start({
      bindingID: binding.id,
      action: "verify",
      snapshotRevision: 1,
      worktree: tmp.directory,
      steps: [
        {
          id: "run",
          argv: [process.execPath, serverScript],
          cwd: tmp.directory,
          mode: "service",
          readyUrl: `http://127.0.0.1:${port}/health`,
          timeoutMs: 15_000,
        },
        {
          id: "health",
          argv: [
            process.execPath,
            "-e",
            `fetch('http://127.0.0.1:${port}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(2))`,
          ],
          cwd: tmp.directory,
          dependsOn: ["run"],
        },
      ],
    })
    const waited = yield* runner.wait(started.runID, 30_000)
    expect(waited.timedOut).toBe(false)
    expect(waited.info?.status).toBe("completed")
    const result = yield* runner.get(started.runID)
    expect(result.run?.status).toBe("passed")
    expect(result.steps.map((step) => [step.step_id, step.status])).toEqual([
      ["run", "passed"],
      ["health", "passed"],
    ])
    expect(result.steps[0]?.exit_code).toBeNull()
    expect(yield* Effect.promise(() => Bun.file(result.steps[0].stdout_file!).text())).toContain("service-ready")
  }),
  { git: true },
)
