import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as registry from "@/dynamic-workflow/runtime/registry"
import { renderRun, renderRow, renderStoredRun } from "@/dynamic-workflow/report"
import { listRuns, readRun } from "@/dynamic-workflow/journal/read"
import type { Settlement } from "@/dynamic-workflow/engine/types"

/**
 * 查 / 停一次工作流运行。
 *
 * 为什么单独一个工具而不是 `create_workflow` 的一个动作：`create_workflow` 会阻塞到 run 结束，
 * 它没有机会「查」任何东西。用户说「刚才那次跑得怎么样」时，主代理需要一个立刻能调的东西。
 *
 * 数据有**两个来源**，顺序是先进程内、后库里：
 *   - 进程内的登记表有实时报告与停止把手；
 *   - 库里是上一次进程留下的记录（重启之后还在，但没有把手）。
 * 这正是一个用户会问的两种情形：「现在跑到哪了」和「昨天那次成了没」。
 */

const Parameters = Schema.Struct({
  action: Schema.Literals(["get", "list", "stop"]),
  run_id: Schema.optional(Schema.String).annotate({
    description: "get / stop 必填：create_workflow 返回的 run id。",
  }),
  limit: Schema.optional(Schema.Finite).annotate({ description: "list 返回多少条，缺省 10。" }),
})

type Metadata = { action: string; runId?: string; status?: string }

/** 把库里的一行变成渲染器认识的结算形状。 */
function settlementOf(header: NonNullable<ReturnType<typeof readRun>>): Settlement | undefined {
  if (header.status === "completed") {
    return { status: "completed", value: header.result, spentTokens: header.spentTokens }
  }
  if (header.status === "errored") {
    const failure = (header.failure ?? {}) as { name?: string; message?: string; code?: string }
    return {
      status: "errored",
      error: { name: failure.name ?? "Error", message: failure.message ?? "（没有留下原因）" },
      spentTokens: header.spentTokens,
    }
  }
  if (header.status === "stopped") {
    return {
      status: "stopped",
      reason: (header.stopReason ?? "interrupted") as "user" | "model" | "provider" | "interrupted",
      spentTokens: header.spentTokens,
    }
  }
  return undefined
}

export const WorkflowRunTool = Tool.define<typeof Parameters, Metadata, never>(
  "workflow_run",
  Effect.succeed({
    description: [
      "查看或停止一次动态工作流运行。",
      "action=get 看某次运行的结论、报告与用量；action=list 看最近的运行；action=stop 停下来。",
      "运行中的 run 会在后台继续，这个工具不会等它。重启之后的历史也能查到。",
    ].join(""),
    parameters: Parameters,
    capabilities: { concurrencySafe: false, workspace: false },
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.sync(() => {
        if (params.action === "list") {
          const limit = Math.max(1, Math.min(Math.floor(params.limit ?? 10), 50))
          const live = registry.list(limit)
          const liveIds = new Set(live.map((entry) => entry.runId))
          // 库里是跨进程的真相；进程内没有的才补上，免得同一次 run 列两遍。
          const stored = listRuns({ ...(ctx.directory ? { cwd: ctx.directory } : {}), limit })
          const storedRows = stored.filter((row) => !liveIds.has(row.runId))
          if (live.length === 0 && storedRows.length === 0) {
            return {
              title: "暂无工作流运行",
              output: "这个工作区里还没有跑过工作流。",
              metadata: { action: "list" },
            }
          }
          const lines = [
            ...live.map((entry) => `${renderRow(entry)}  运行中`),
            ...storedRows.map(
              (row) =>
                `${row.runId}  ${row.name ? `${row.name} ` : ""}[${row.status}]${
                  row.spentTokens ? ` ${row.spentTokens} tokens` : ""
                }`,
            ),
          ]
          return {
            title: `${lines.length} 次工作流运行`,
            output: lines.join("\n"),
            metadata: { action: "list" },
          }
        }

        const runId = params.run_id?.trim()
        if (!runId) {
          return {
            title: "缺少 run_id",
            output: "get 与 stop 都需要 run_id。先用 action=list 看看有哪些运行。",
            metadata: { action: params.action },
          }
        }

        const entry = registry.get(runId)
        const header = readRun(runId)

        if (params.action === "stop") {
          if (!entry?.stop) {
            return {
              title: header ? "这次运行已经结束" : "找不到这次运行",
              output: header
                ? `run ${runId} 不在运行中，没有可停的东西。${String.fromCharCode(10)}${renderStoredRun(header)}`
                : `没有 run ${runId}。用 action=list 看看有哪些。`,
              metadata: { action: "stop", runId, ...(header ? { status: header.status } : {}) },
            }
          }
          entry.stop("user")
          return {
            title: "已请求停止",
            output: `已请求停止 run ${runId}。在飞的子代理会被中断，尚未轮到的不会再开始。`,
            metadata: { action: "stop", runId, status: "stopping" },
          }
        }

        if (entry) {
          const status = entry.settlement?.status ?? "running"
          return {
            title: `run ${runId}：${status}`,
            output: renderRun(entry, entry.settlement),
            metadata: { action: "get", runId, ...(entry.settlement ? { status } : {}) },
          }
        }

        if (!header) {
          return {
            title: "找不到这次运行",
            output: `没有 run ${runId}。它可能是别的工作区跑的。用 action=list 看现在能查到的。`,
            metadata: { action: "get", status: "not-found" },
          }
        }

        return {
          title: `run ${runId}：${header.status}`,
          output: renderStoredRun(header),
          metadata: {
            action: "get",
            runId,
            status: header.status,
            ...(header.status === "stopped" ? { resumable: true } : {}),
          },
        }
      }).pipe(Effect.orDie),
  }),
)
