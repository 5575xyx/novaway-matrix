import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Git } from "@/git"
import { Ripgrep } from "@/file/ripgrep"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { prepareWorkflow, formatDiagnostics } from "@/dynamic-workflow"
import { runWorkflow } from "@/dynamic-workflow/runtime/harness"
import { makeNovaDriver, type DriverPromptOps } from "@/dynamic-workflow/driver/nova-driver"
import { loadReplayPlan, readRun } from "@/dynamic-workflow/journal/read"
import { SqliteJournal } from "@/dynamic-workflow/engine/sqlite-journal"
import * as registry from "@/dynamic-workflow/runtime/registry"
import { renderRun } from "@/dynamic-workflow/report"
import { resolveWorkflowModel } from "./workflow-model"
import { makeRunPublisher } from "@/dynamic-workflow/publish"
import { RunProgress, createProgressPump } from "@/dynamic-workflow/progress"
import { EffectBridge } from "@/effect/bridge"

/**
 * 把一次被停下的 run 接着跑完。
 *
 * 「恢复」在这里不是动词上的神秘操作：脚本原样再跑一遍，journal 回答已经发生过的事。
 * 已完成的 ask / world-read 直接拿缓存答案，不再花 token；上次没跑完的节点重新执行；
 * 子代理接回原来的会话，所以它记得上一轮说过什么。
 *
 * 两次生命的 settlement 是同一份：run id 不变，状态从 stopped 回到 running 再到 completed。
 * 这样查询、时间线、用量都只有一条记录。
 */

type Services = Session.Service | Agent.Service | AppFileSystem.Service | Ripgrep.Service | Git.Service | Bus.Service

type ResumeMetadata = {
  runId?: string
  status?: string
  cached?: number
  tokens?: number
  /** 跑着的时候按节奏更新的进度快照（见 dynamic-workflow/progress.ts）。 */
  progress?: unknown
}

const Parameters = Schema.Struct({
  run_id: Schema.String.annotate({ description: "要接着跑的 run id（workflow_run 的 list 能查）。" }),
  max_concurrency: Schema.optional(Schema.Finite).annotate({
    description: "这次改成最多几个子代理同时在飞。缺省沿用上次的。",
  }),
})

export const ResumeWorkflowTool = Tool.define<typeof Parameters, ResumeMetadata, Services>(
  "resume_workflow_run",
  Effect.gen(function* () {
    const context = yield* Effect.context<Services>()
    const bus = yield* Bus.Service
    return {
      description: [
        "把一次被停下（stopped）的工作流接着跑完。已经完成的子任务不会重跑、不会重复花 token。",
        "只有 stopped 的运行能恢复；completed / errored 不行——那两种要改脚本，应当重新 create_workflow。",
      ].join(""),
      parameters: Parameters,
      capabilities: { concurrencySafe: false, workspace: false, interrupt: "cancel" },

      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<ResumeMetadata>) =>
        Effect.gen(function* () {
          const runId = params.run_id.trim()
          const header = readRun(runId)
          if (!header) {
            return {
              title: "找不到这次运行",
              output: `没有 run ${runId}。用 workflow_run 的 action=list 看看有哪些。`,
              metadata: { status: "not-found" },
            }
          }
          if (header.status !== "stopped") {
            return {
              title: "这次运行不需要恢复",
              output:
                header.status === "running"
                  ? `run ${runId} 还在跑。等它结束，或者先 workflow_run 的 action=stop 把它停下。`
                  : `run ${runId} 已经是 ${header.status}。恢复只对 stopped 有用；要改脚本就重新 create_workflow。`,
              metadata: { runId, status: header.status },
            }
          }

          // 脚本原样再编译一次：编译器升级之后，老脚本可能已经不再合法。与其在沙箱里炸，
          // 不如把诊断交回给模型。
          const prepared = prepareWorkflow(header.scriptText)
          if (!prepared.ok) {
            return {
              title: "这次运行的脚本现在编译不过",
              output: [
                "恢复要重跑同一份脚本，但它没有通过当前的编译检查：",
                formatDiagnostics(prepared.diagnostics),
                "",
                "这说明校验规则变了，或脚本文件被人改过。请用 create_workflow 交一份新脚本。",
              ].join("\n"),
              metadata: { runId, status: "invalid" },
            }
          }

          const plan = loadReplayPlan(runId)
          const cached = plan.settled.size
          const maxConcurrency =
            typeof params.max_concurrency === "number" &&
            Number.isFinite(params.max_concurrency) &&
            params.max_concurrency >= 1
              ? Math.floor(params.max_concurrency)
              : header.maxConcurrency

          yield* ctx.ask({
            permission: "workflow",
            patterns: [header.name?.trim() || "工作流恢复"],
            always: ["*"],
            metadata: {
              name: header.name ?? "工作流恢复",
              resume: runId,
              cachedNodes: cached,
              phases: [...prepared.phaseNames],
              commands: [...prepared.commands],
              maxConcurrency,
            } as never,
          })

          const ops = ctx.extra?.promptOps as DriverPromptOps | undefined
          const model = yield* resolveWorkflowModel(ctx)
          if (!ops) {
            return {
              title: "无法恢复",
              output: "恢复需要助手轮次的派发能力（promptOps），当前调用没有提供。",
              metadata: { runId, status: "unsupported" },
            }
          }
          if (!model) {
            return {
              title: "无法恢复",
              output: "恢复需要知道用哪个模型跑子代理，当前调用没有提供。",
              metadata: { runId, status: "unsupported" },
            }
          }

          const built = yield* makeNovaDriver({
            runId,
            parentSessionID: SessionID.make(ctx.sessionID),
            parentAgent: ctx.agent,
            defaultModel: model,
            cwd: header.cwd,
            ops,
          }).pipe(Effect.provide(context))

          registry.register({
            runId,
            ...(header.name ? { name: header.name } : {}),
            scriptText: header.scriptText,
            phaseNames: prepared.phaseNames,
            siteIds: prepared.siteIds,
          })

          const publish = makeRunPublisher(
            {
              phases: prepared.phaseNames,
              siteCount: prepared.sites.length,
              ...(header.name ? { name: header.name } : {}),
              parentSessionID: String(ctx.sessionID),
              resumedFrom: runId,
            },
            {
              publish: (item) =>
                Effect.runPromise(
                  bus.publish(item.def as never, item.properties as never).pipe(Effect.ignore, Effect.provide(context)),
                ),
            },
          )

          // 恢复时也推进度：一次「接着跑」可能还要再问十几个子代理，用户同样需要看到走到哪。
          // `cached` 那一栏在这里特别有用——它直接回答了「这次恢复省下了多少」。
          const bridge = yield* EffectBridge.make()
          const progress = createProgressPump({
            progress: new RunProgress(prepared.phaseNames),
            push: (snapshot) => {
              void bridge.promise(ctx.metadata({ metadata: { progress: snapshot } as never })).catch(() => {})
            },
          })

          const result = yield* Effect.promise(() =>
            runWorkflow({
              prepared,
              driver: built.driver,
              runId,
              maxConcurrency,
              replay: plan,
              spentTokens: header.spentTokens,
              journal: new SqliteJournal({
                cwd: header.cwd,
                parentSessionID: String(ctx.sessionID),
                ...(header.name ? { name: header.name } : {}),
                scriptText: header.scriptText,
                ...(header.args ? { args: header.args } : {}),
                resumedFrom: runId,
              }),
              signal: ctx.abort,
              onEngine: (engine) => registry.attach(runId, engine),
              onEvent: (event) => {
                if (event.type === "report") registry.addReport(runId, event.item)
                if (event.type === "run-settled") progress.flush()
                else progress.apply(event)
                publish(event)
              },
            }),
          ).pipe(Effect.orDie)
          progress.stop()
          registry.settle(runId, result.settlement)

          const entry = registry.get(runId)!
          return {
            title:
              result.settlement.status === "completed"
                ? `工作流跑完了${header.name ? `：${header.name}` : ""}`
                : result.settlement.status === "errored"
                  ? "工作流失败"
                  : "工作流又停下了",
            output: renderRun(entry, result.settlement),
            metadata: {
              runId,
              status: result.settlement.status,
              cached,
              tokens: result.settlement.spentTokens,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
