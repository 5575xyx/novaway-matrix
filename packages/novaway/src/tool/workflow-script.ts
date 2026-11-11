import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Git } from "@/git"
import { Ripgrep } from "@/file/ripgrep"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { prepareWorkflow, formatDiagnostics, type PreparedWorkflow } from "@/dynamic-workflow"
import { runWorkflow, defaultMaxConcurrency } from "@/dynamic-workflow/runtime/harness"
import { SqliteJournal } from "@/dynamic-workflow/engine/sqlite-journal"
import { makeNovaDriver, type DriverPromptOps } from "@/dynamic-workflow/driver/nova-driver"
import * as registry from "@/dynamic-workflow/runtime/registry"
import { renderRun } from "@/dynamic-workflow/report"
import { resolveWorkflowModel } from "./workflow-model"
import { makeRunPublisher } from "@/dynamic-workflow/publish"
import { RunProgress, createProgressPump } from "@/dynamic-workflow/progress"
import { listSaved, loadSaved } from "./workflow-save"
import { EffectBridge } from "@/effect/bridge"
import type { Settlement } from "@/dynamic-workflow/engine/types"

type Services = Session.Service | Agent.Service | AppFileSystem.Service | Ripgrep.Service | Git.Service | Bus.Service

type CreateMetadata = {
  runId?: string
  status?: string
  phases?: string[]
  siteCount?: number
  commandCount?: number
  tokens?: number
  /** 跑着的时候按节奏更新的进度快照（见 dynamic-workflow/progress.ts）。 */
  progress?: unknown
}

const ScriptParameters = Schema.Struct({
  script: Schema.optional(Schema.String).annotate({
    description:
      "工作流脚本，一段 TypeScript 的函数体。可以直接用 agent / phase / log / report / files / git / world / args，不需要 import。顶层可以 await、结尾用 return 交结果。与 saved 二选一。",
  }),
  saved: Schema.optional(Schema.String).annotate({
    description: "跑一个保存过的工作流：给它的名字（list_saved_workflows 能查）。与 script 二选一。",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "这次运行的名字，显示在确认窗与结果里。用用户的语言写，例如「评审本次改动」。",
  }),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "传给脚本的只读参数对象，脚本里用 args.xxx 读。",
  }),
  max_concurrency: Schema.optional(Schema.Finite).annotate({
    description: "同时在飞的最多子代理数。缺省按机器核数算（4–16）。只有确实需要限制时才填。",
  }),
})

/** 把编译产物渲染成一段给模型看的说明。有诊断时只有这一段。 */
export function renderDiagnostics(diagnostics: PreparedWorkflow["diagnostics"]): string {
  return [
    "脚本没有通过检查，没有启动。请按下面的位置改：",
    formatDiagnostics(diagnostics),
    "",
    "改完再调用一次。若某个用法反复不通过，可以先只写不依赖它的部分。",
  ].join("\n")
}

/** 确认窗里给用户看的东西。**有界**：脚本正文按行截断，命令去重。 */
export function confirmationMetadata(prepared: PreparedWorkflow, maxConcurrency: number) {
  const lines = prepared.scriptText.split("\n")
  const shown = lines.slice(0, 200).join("\n")
  return {
    name: "工作流脚本",
    script: lines.length > 200 ? `${shown}\n…（共 ${lines.length} 行）` : shown,
    phases: [...prepared.phaseNames],
    commands: [...prepared.commands],
    actors: [...new Set(prepared.actorNames)],
    siteCount: prepared.sites.length,
    maxConcurrency,
  }
}

/** 新建一个 run id。短、可读、带一点随机，足够在同一进程里区分。 */
function newRunId(): string {
  return `dwfrun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 跑一段工作流脚本。
 *
 * 一次调用走完四步：编译 → 确认 → 跑 → 汇报。任何一步不成立都**在这里**结束，不让它
 * 变成一次跑到一半的 run：
 *   - 编译有诊断 → 把行列交回给模型，不弹窗；
 *   - 用户拒绝 → `ctx.ask` 直接抛出，子进程根本没起过；
 *   - run 结算 → 把结论、报告、用量渲染成文本。
 */
export const CreateWorkflowTool = Tool.define<typeof ScriptParameters, CreateMetadata, Services>(
  "create_workflow",
  Effect.gen(function* () {
    // 工具的执行体必须是 R = never，所以在这里把上下文捕获下来：驱动在 execute 里构造，
    // 用同一份上下文补齐它需要的服务。
    const context = yield* Effect.context<Services>()
    // 总线服务在**外壳**里取：`execute` 必须是 R = never，所以凡是需要服务的，都在这里
    // 捕获、被 execute 闭包住（与下面 `Effect.provide(context)` 是同一套写法）。
    const bus = yield* Bus.Service
    const fs = yield* AppFileSystem.Service
    return {
      description: [
        "运行一段 TypeScript 工作流脚本：用 agent() 派子代理、用 Promise.all 扇出、",
        "用 files / git 读工作区、用 world.run 跑命令，最后 return 一个结果。",
        "适用：需要多步子任务、每条结果要结构化、或者要按中途结果决定下一步的活儿。",
        "单次派发用 task 就够了。脚本会先被编译检查，再让用户确认，然后才运行。",
      ].join(""),
      parameters: ScriptParameters,

      execute: (params: Schema.Schema.Type<typeof ScriptParameters>, ctx: Tool.Context<CreateMetadata>) =>
        Effect.gen(function* () {
          const cwd = ctx.directory ?? process.cwd()

          // 0. 取脚本正文。saved 优先于 script 缺省值无所谓——两者二选一，同时给就用 script。
          let source = params.script
          let savedName: string | undefined
          if (!source && params.saved) {
            const loaded = yield* loadSaved(fs, { name: params.saved, cwd }).pipe(Effect.orDie)
            if (!loaded) {
              const known = (yield* listSaved(fs, { cwd }).pipe(Effect.orDie)).map((item) => item.name)
              return {
                title: "找不到这个保存的工作流",
                output:
                  known.length === 0
                    ? `没有名为 ${params.saved} 的工作流，而且当前工作区里一个都没保存过。用 save_workflow 存一个，或者直接给 script。`
                    : `没有名为 ${params.saved} 的工作流。已有的：${known.join("、")}。`,
                metadata: { status: "not-found" },
              }
            }
            source = loaded.script
            savedName = params.saved
          }
          if (!source) {
            return {
              title: "没有脚本",
              output: "要么给 script（一段脚本正文），要么给 saved（一个保存过的工作流名字）。",
              metadata: { status: "invalid" },
            }
          }

          // 1. 编译 + 分析 + 降级。纯计算，不起子进程。
          const prepared = prepareWorkflow(source)
          if (!prepared.ok) {
            return {
              title: "工作流脚本有错误",
              output: renderDiagnostics(prepared.diagnostics),
              metadata: { status: "invalid" },
            }
          }

          // 2. 确认。这是整条链路上**唯一**的授权点：批准之后，run 内部不再弹权限窗。
          const requested = params.max_concurrency
          const maxConcurrency =
            typeof requested === "number" && Number.isFinite(requested) && requested >= 1
              ? Math.floor(requested)
              : defaultMaxConcurrency()
          yield* ctx.ask({
            permission: "workflow",
            patterns: [params.name?.trim() || savedName || "工作流"],
            always: ["*"],
            metadata: confirmationMetadata(prepared, maxConcurrency) as never,
          })

          // 3. 准备驱动。子代理的权限来自父会话 + general 的派生规则，与 task 派发的完全一致。
          const model = yield* resolveWorkflowModel(ctx)
          const ops = ctx.extra?.promptOps as DriverPromptOps | undefined
          if (!ops || !model) {
            return {
              title: "无法启动工作流",
              output: [
                "工作流需要一个能派发子代理的助手轮次（promptOps 与当前模型）。",
                "当前调用没有提供它们，所以没有启动——这不是脚本的问题。",
              ].join(""),
              metadata: { status: "unsupported" },
            }
          }

          const runId = newRunId()
          const built = yield* makeNovaDriver({
            runId,
            parentSessionID: SessionID.make(ctx.sessionID),
            parentAgent: ctx.agent,
            defaultModel: model,
            cwd,
            ops,
          }).pipe(Effect.provide(context))

          const displayName = params.name ?? savedName
          registry.register({
            runId,
            ...(displayName ? { name: displayName } : {}),
            scriptText: prepared.scriptText,
            phaseNames: prepared.phaseNames,
            siteIds: prepared.siteIds,
          })

          // 事件走总线：界面据此画时间线。发布不阻塞、失败不影响 run（见 publish.ts）。
          // `bus.publish` 的 R 是 never（服务自己持有实例状态），所以直接 runPromise 即可，
          // 不必再借 bridge 把工具上下文搬过去。
          const publish = makeRunPublisher(
            {
              phases: prepared.phaseNames,
              siteCount: prepared.sites.length,
              ...(displayName ? { name: displayName } : {}),
              parentSessionID: String(ctx.sessionID),
            },
            {
              // 用工具自己的上下文跑：总线按 InstanceRef 分实例，拿默认运行时的空上下文
              // 会直接死在「InstanceRef not provided」上。
              publish: (item) =>
                Effect.runPromise(
                  bus.publish(item.def as never, item.properties as never).pipe(Effect.ignore, Effect.provide(context)),
                ),
            },
          )

          // 进度快照：跑着的时候按 250ms 的节奏推一次工具元数据。`ctx.metadata` 是 Effect，
          // 而事件回调是同步的 JS，所以走 bridge 把服务与 InstanceRef 带过去（与 task 工具
          // 的做法一致）。推不出去就算了——进度是锦上添花，不能让 run 等它。
          const bridge = yield* EffectBridge.make()
          const progress = createProgressPump({
            progress: new RunProgress(prepared.phaseNames),
            push: (snapshot) => {
              void bridge.promise(ctx.metadata({ metadata: { progress: snapshot } as never })).catch(() => {})
            },
          })

          // 4. 跑。engine 的每一次 ask / world-read 都经由 bridge 回到这里捕获的上下文。
          //    journal 落 SQLite：进程被杀掉之后，`workflow_run` 还能查到这次 run，
          //    `resume_workflow_run` 也才有东西可读。
          const result = yield* Effect.promise(() =>
            runWorkflow({
              prepared,
              driver: built.driver,
              runId,
              maxConcurrency,
              journal: new SqliteJournal({
                cwd,
                parentSessionID: String(ctx.sessionID),
                ...(displayName ? { name: displayName } : {}),
                scriptText: prepared.scriptText,
                ...(params.args ? { args: params.args } : {}),
                ...(ctx.callID ? { toolCallID: ctx.callID } : {}),
              }),
              ...(params.args ? { args: params.args } : {}),
              signal: ctx.abort,
              onEngine: (engine) => registry.attach(runId, engine),
              onEvent: (event) => {
                if (event.type === "report") registry.addReport(runId, event.item)
                // 结算事件之后不会再有事发生，把定时器停掉，别留一个空转的 handle。
                if (event.type === "run-settled") progress.flush()
                else progress.apply(event)
                publish(event)
              },
            }),
          ).pipe(Effect.orDie)
          progress.stop()
          registry.settle(runId, result.settlement)

          // 5. 汇报。
          const entry = registry.get(runId)!
          const settlement: Settlement = result.settlement
          return {
            title:
              settlement.status === "completed"
                ? `工作流完成${displayName ? `：${displayName}` : ""}`
                : settlement.status === "errored"
                  ? "工作流失败"
                  : "工作流已停止",
            output: renderRun(entry, settlement),
            metadata: {
              runId,
              status: settlement.status,
              phases: [...prepared.phaseNames],
              siteCount: prepared.sites.length,
              commandCount: prepared.commands.length,
              tokens: settlement.spentTokens,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
