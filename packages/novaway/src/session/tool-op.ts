import type { Op } from "@/team/op-log"

/**
 * 幂等重放的三岔口：执行 / 跳过 / 拒绝。
 *
 * 抽成纯函数是为了能单独测：这段逻辑决定「崩溃后要不要重跑一个有副作用的
 * 工具」，判错一次就可能是重复扣款或重复推送，比渲染错一句话严重得多。
 *
 * - 没有历史记录 → 正常执行；
 * - 上次成功或失败 → **不重跑**，把「已经执行过」如实告诉模型；
 * - 上次停在 `started`（进程被杀）或已被判为 `unknown` → 拒绝继续，
 *   交给人核对副作用（`needs_review`），因为此时「执行了没有」本身未知。
 */
export type Replay =
  | { kind: "execute" }
  | { kind: "skip"; title: string; output: string; metadata: Record<string, unknown> }
  | { kind: "fail"; message: string }

export function decide(tool: string, previous: Op | undefined): Replay {
  if (!previous) return { kind: "execute" }
  if (previous.outcome === "unknown" || previous.outcome === "started") {
    return {
      kind: "fail",
      message:
        `The ${tool} tool call has an unresolved previous attempt (${previous.outcome}); ` +
        "check its side effects before retrying.",
    }
  }
  return {
    kind: "skip",
    title: `${tool} (already executed)`,
    output:
      `This ${tool} call was already executed as ${previous.idempotencyKey} ` +
      `(outcome: ${previous.outcome}); it was not run again.`,
    metadata: { replayed: true, outcome: previous.outcome, opID: previous.id },
  }
}

export * as ToolOp from "./tool-op"
