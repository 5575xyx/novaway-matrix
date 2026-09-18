// 临时插桩脚本:定位 registry.test.ts 全量提供 layer 后进程访问违例(0xC0000002)的死点。
// 用完即删。所有阶段用 writeFileSync 落盘,原生崩溃也不会丢最后一条标记。
import { writeFileSync } from "fs"
import path from "path"
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
import { Reference } from "@/reference/reference"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Auth } from "@/auth"
import { TestConfig } from "./test/fixture/config"
import { withTmpdirInstance } from "./test/fixture/fixture"
import { InstanceState } from "@/effect/instance-state"

const LOG = path.join(process.env.TEMP ?? ".", "registry-crash.log")
const stage = (name: string) => {
  const mem = process.memoryUsage()
  writeFileSync(
    LOG,
    `[${name}] rss=${Math.round(mem.rss / 1024 / 1024)}MB heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB\n`,
    { flag: "a" },
  )
}

writeFileSync(LOG, "")
stage("A imports done")

const node = CrossSpawnSpawner.defaultLayer
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

const registryLayer = Layer.suspend(() =>
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
      Layer.provide(RuntimeFlags.defaultLayer),
      Layer.provide(Auth.defaultLayer),
      Layer.provide(BrowserService.defaultLayer),
      Layer.provide(Goal.defaultLayer),
      Layer.provide(WorkflowDefaultLayer),
      Layer.provide(OrchestratorDefaultLayer),
    ),
)

stage("B layer constructed")

const runIds = (label: string) => {
  stage(`C ${label} starting`)
  const work = Effect.gen(function* () {
    stage(`C1 ${label} got registry service`)
    const registry = yield* ToolRegistry.Service
    stage(`C2 ${label} calling ids()`)
    const ids = yield* registry.ids()
    stage(`C3 ${label} ids() done count=${ids.length}`)
    return ids.length
  })
  return Effect.runPromise(work.pipe(withTmpdirInstance(), Effect.scoped, Effect.provide(registryLayer)))
}

try {
  const withInstance = await runIds("with-instance")
  stage(`D with-instance -> ${withInstance}`)
} catch (err) {
  stage(`D with-instance THREW -> ${String(err).slice(0, 300)}`)
}
stage("E finished")
console.log("done, log:", LOG)
