/**
 * 动态工作流的**编译期入口**。
 *
 * 一次 `prepareWorkflow(scriptText)` 把作者写的脚本变成三样东西：
 *   - `diagnostics`：能不能跑、跑不了是哪儿不对（说人话，带行列）；
 *   - `sites` / `phaseNames` / `commands`：这次 run 的**形状**——确认窗展示的就是它；
 *   - `lowered`：丢进沙箱就能跑的函数体，唯一自由标识符是 `__host`。
 *
 * 这个模块只做纯计算：不读盘、不起进程、不碰数据库。工具层拿到结果之后才决定要不要弹确认窗、
 * 要不要开后台任务。这样「同一个脚本会得到同一份形状」这件事，可以在单元测试里被完整证明。
 *
 * 依赖方向：facade → compiler → analysis → lowering，单向。沙箱与引擎在 M2 才进来，
 * 它们依赖本模块，不反过来。
 */

import { compileScript, type WorkflowDiagnostic } from "./compiler/compile"
import { collectSites, type Site, type SiteTable } from "./analysis/sites"
import { lower, type LoweredWorkflow } from "./lowering/lower"
import { LOWERED_SITES_MISMATCH } from "./analysis/diagnostics"

export { compileScript, formatDiagnostics } from "./compiler/compile"
export type { CompileResult, WorkflowDiagnostic } from "./compiler/compile"
export { collectSites, WORLD_READ_OPS, facadeTargetOf } from "./analysis/sites"
export type { Site, SiteTable, SiteKind, FacadeTarget, WorldReadOp } from "./analysis/sites"
export { lower } from "./lowering/lower"
export type { LoweredWorkflow } from "./lowering/lower"
export { WORKFLOW_FACADE_DTS, WORKFLOW_FACADE_FILE, WORKFLOW_SCRIPT_FILE } from "./facade/dts"
export * as DiagnosticCode from "./analysis/diagnostics"

// —— 执行侧（M2）——
export { WorkflowEngine } from "./engine/engine"
export type { EngineConfig } from "./engine/engine"
export { MemoryJournal } from "./engine/memory-journal"
export type { StoredNode, StoredRun } from "./engine/memory-journal"
export { SqliteJournal } from "./engine/sqlite-journal"
export type { SqliteJournalMeta } from "./engine/sqlite-journal"
export { buildReplayPlan, instanceKey } from "./engine/replay"
export type { ReplayPlan, ReplayNode, ReplayEvent } from "./engine/replay"
export { boundRecord, boundJson, DEFAULT_MAX_RECORD_BYTES } from "./engine/bound"
export * as JournalRead from "./journal/read"
export type { RunSummary, RunHeader, NodeRow } from "./journal/read"
export { Event as WorkflowBusEvent, toBusEvents } from "./events"
export type { BusPublishable } from "./events"
export { makeRunPublisher } from "./publish"
export * as SavedWorkflow from "./saved"
export { AskScheduler } from "./engine/scheduler"
export { fnv1a, canonicalJson, inputHash } from "./engine/hash"
export * as WorkflowTypes from "./engine/types"
export type {
  ActorRef,
  AskAnswer,
  AskRequest,
  CreateActorRequest,
  InstanceRef,
  JournalPort,
  NodeKind,
  NodeRecord,
  RunEvent,
  RunFailure,
  RunId,
  RunStatus,
  SessionRef,
  Settlement,
  StopReason,
  WorkflowDriver,
  WorldReadRequest,
} from "./engine/types"
export { runWorkflow, defaultMaxConcurrency, WorkflowCompileError } from "./runtime/harness"
export type { RunWorkflowInput, RunWorkflowResult } from "./runtime/harness"
export { renderChildEntry } from "./runtime/entry"
export { CHILD_BOOTSTRAP } from "./runtime/child-bootstrap"
export type { ChildMessage, ChildPayload, ParentMessage, ResponseMessage, WireError } from "./runtime/protocol"

/** 一次编译的全部产物。 */
export interface PreparedWorkflow {
  readonly ok: boolean
  readonly diagnostics: readonly WorkflowDiagnostic[]
  readonly sites: readonly Site[]
  readonly siteIds: readonly string[]
  /** 阶段名，按首次出现顺序去重。 */
  readonly phaseNames: readonly string[]
  /** 脚本里出现过的 world.run 命令（字面量），去重后按出现顺序。确认窗要展示它。 */
  readonly commands: readonly string[]
  /** 有名字的子代理，按出现顺序。确认窗用来说明「最多会有几个子代理」。 */
  readonly actorNames: readonly string[]
  /** 只有 `ok` 为真时才有。 */
  readonly lowered?: LoweredWorkflow
  /**
   * 作者脚本原文。
   *
   * 带在结果里是有意的：journal 要存它（恢复时逐字节比对）、工具要把它写进草稿文件、
   * 确认窗要展示它。让每个调用方各自再传一遍，等于给「传错了一份」留下机会。
   */
  readonly scriptText: string
}

const EMPTY = {
  diagnostics: [] as readonly WorkflowDiagnostic[],
  sites: [] as readonly Site[],
  siteIds: [] as readonly string[],
  phaseNames: [] as readonly string[],
  commands: [] as readonly string[],
  actorNames: [] as readonly string[],
} as const

function summarize(table: SiteTable) {
  const commands: string[] = []
  const actorNames: string[] = []
  for (const site of table.sites) {
    if (site.command !== undefined && !commands.includes(site.command)) commands.push(site.command)
    if (site.name !== undefined) actorNames.push(site.name)
  }
  return { ...table, commands, actorNames }
}

/**
 * 编译、分析、降级，一步到位。
 *
 * 顺序是承重的：**有诊断就不降级**。降级一份有错误的脚本只会产出一堆无法解释的东西，
 * 而模型需要的是「第几行第几列哪里不对」。
 */
export function prepareWorkflow(scriptText: string): PreparedWorkflow {
  const compiled = compileScript(scriptText)
  if (!compiled.ok) return { ok: false, ...EMPTY, diagnostics: compiled.diagnostics, scriptText }

  const table = collectSites(compiled)
  if (table.diagnostics.length > 0) {
    return { ok: false, ...summarize(table), diagnostics: table.diagnostics, scriptText }
  }

  const lowered = lower(compiled, table, scriptText)

  // 自检：降级产物里的站点必须与站点表逐个对上。对不上说明我们自己的代码有 bug，
  // 而这种 bug 一旦放过去，journal 会把两次不同的执行记成同一件事——比直接失败糟得多。
  const expected = table.siteIds.filter((id) => !id.startsWith("join#") && !id.startsWith("fan-out#"))
  const actual = lowered.siteIds
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    return {
      ok: false,
      ...summarize(table),
      scriptText,
      diagnostics: [
        {
          code: LOWERED_SITES_MISMATCH,
          message: `内部错误：降级后的站点表与分析结果不一致（期望 ${expected.length} 个，得到 ${actual.length} 个）。这是 NovaWay 自己的 bug，请把这个脚本报告给维护者。`,
          line: 1,
          column: 1,
        },
      ],
    }
  }

  return { ok: true, ...summarize(table), scriptText, lowered }
}
