// 临时插桩测试:复制 registry.test.ts 的 layer 链,在 bun test 环境下定位 0xC0000002 死点。用完即删。
import { describe, expect } from "bun:test"
import path from "path"
import { writeFileSync } from "fs"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { BrowserService } from "@/browser/browser"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Plugin } from "@/plugin"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Goal } from "@/session/goal"
import { defaultLayer as WorkflowDefaultLayer } from "@/workflow/workflow"
import { defaultLayer as OrchestratorDefaultLayer } from "@/orchestrator/orchestrator"
import { Skill } from "@/skill"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Provider } from "@/provider/provider"
import { Git } from "@/git"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/unstable/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"
import { Reference } from "@/reference/reference"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Auth } from "@/auth"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

const LOG = path.join(process.env.TEMP ?? ".", "registry-crash-test.log")
const stage = (name: string) => {
  const mem = process.memoryUsage()
  writeFileSync(LOG, `[${name}] rss=${Math.round(mem.rss / 1024 / 1024)}MB heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB\n`, { flag: "a" })
}
writeFileSync(LOG, "")
stage("T1 module top-level")

const node = CrossSpawnSpawner.defaultLayer
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

const registryLayer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  ToolRegistry.layer
    .pipe(
      Layer.provide(configLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(Todo.defaultLayer),
      Layer.provide(Skill.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(Layer.mergeAll(SessionStatus.defaultLayer, BackgroundJob.defaultLayer)),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Git.defaultLayer),
      Layer.provide(Reference.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(Bus.layer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Format.defaultLayer),
      Layer.provide(node),
      Layer.provide(Ripgrep.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
    )
    .pipe(
      Layer.provide(RuntimeFlags.layer(flags)),
      Layer.provide(Auth.defaultLayer),
      Layer.provide(BrowserService.defaultLayer),
      Layer.provide(Goal.defaultLayer),
      Layer.provide(WorkflowDefaultLayer),
      Layer.provide(OrchestratorDefaultLayer),
    )

const it = testEffect(Layer.mergeAll(registryLayer({ pure: true, disableDefaultPlugins: true }), node, Agent.defaultLayer, Auth.defaultLayer) as any)

describe("debug-crash", () => {
  it.instance("ids", () =>
    Effect.gen(function* () {
      stage("T2 test body started")
      const registry = yield* ToolRegistry.Service
      stage("T3 registry service obtained")
      const ids = yield* registry.ids()
      stage(`T4 ids done count=${ids.length}`)
      expect(ids.length).toBeGreaterThan(0)
    }),
  )
})
