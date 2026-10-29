import { Context, Effect, Layer } from "effect"
import { SessionCheckpoint } from "@/session/checkpoint"
import { Snapshot } from "@/snapshot"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"

/**
 * 团队运行的检查点：复用会话检查点（消息 + 文件快照），
 * 额外记录「这是哪一次运行、哪一个任务、走到哪一步」。
 *
 * 恢复顺序必须是：文件快照 → 任务清单 → 操作日志复核。
 * 只恢复消息不恢复文件，会让成员在错的工作区上继续；
 * 只恢复文件不复核操作日志，会把「可能已执行」的副作用当成没做过（见设计文档 §8.5）。
 */

export type TaskPoint = {
  checkpointID: string
  sessionID: string
  runID: string
  taskID?: string
  step?: string
  snapshot?: string
  at: number
}

export type ResumePoint = {
  point: TaskPoint
  /** 检查点里记录的下一步；恢复时优先从这里继续，而不是从头再来。 */
  next?: { taskID?: string; step?: string }
}

export interface Interface {
  readonly mark: (input: {
    sessionID: string
    runID: string
    taskID?: string
    step?: string
    name?: string
    note?: string
  }) => Effect.Effect<TaskPoint>
  readonly list: (input: { sessionID: string; runID: string }) => Effect.Effect<TaskPoint[]>
  readonly latest: (input: {
    sessionID: string
    runID: string
    taskID?: string
  }) => Effect.Effect<TaskPoint | undefined>
  readonly resume: (input: { sessionID: string; runID: string }) => Effect.Effect<ResumePoint | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/TeamCheckpoint") {}

const runTag = (runID: string) => "team-run:" + runID

const toPoint = (checkpoint: SessionCheckpoint.Checkpoint, runID: string): TaskPoint | undefined => {
  if (!checkpoint.tags.includes(runTag(runID))) return undefined
  const context = checkpoint.data.context ?? {}
  return {
    checkpointID: checkpoint.id,
    sessionID: checkpoint.sessionId,
    runID,
    taskID: typeof context.taskID === "string" ? context.taskID : undefined,
    step: typeof context.step === "string" ? context.step : undefined,
    snapshot: checkpoint.data.snapshot,
    at: checkpoint.createdAt.getTime(),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const checkpoints = yield* SessionCheckpoint.Service
    const snapshots = yield* Snapshot.Service
    const sessions = yield* Session.Service

    const mark: Interface["mark"] = Effect.fn("TeamCheckpoint.mark")(function* (input) {
      const sessionID = SessionID.make(input.sessionID)
      const messages = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
      const snapshot = yield* snapshots.track().pipe(Effect.catch(() => Effect.succeed(undefined)))
      const checkpoint = yield* checkpoints.create({
        sessionId: input.sessionID,
        name: input.name ?? "团队检查点 " + new Date().toISOString(),
        reason: input.note ?? "team-run",
        tags: ["team-run", runTag(input.runID)],
        messages,
        snapshot,
        context: { runID: input.runID, taskID: input.taskID, step: input.step },
      })
      return {
        checkpointID: checkpoint.id,
        sessionID: checkpoint.sessionId,
        runID: input.runID,
        taskID: input.taskID,
        step: input.step,
        snapshot: checkpoint.data.snapshot,
        at: checkpoint.createdAt.getTime(),
      }
    })

    const list: Interface["list"] = Effect.fn("TeamCheckpoint.list")(function* (input) {
      const all = yield* checkpoints.list(input.sessionID)
      return all
        .map((checkpoint) => toPoint(checkpoint, input.runID))
        .filter((point): point is TaskPoint => point !== undefined)
        .sort((a, b) => a.at - b.at)
    })

    const latest: Interface["latest"] = Effect.fn("TeamCheckpoint.latest")(function* (input) {
      const points = yield* list({ sessionID: input.sessionID, runID: input.runID })
      const filtered = input.taskID ? points.filter((point) => point.taskID === input.taskID) : points
      return filtered[filtered.length - 1]
    })

    const resume: Interface["resume"] = Effect.fn("TeamCheckpoint.resume")(function* (input) {
      const point = yield* latest({ sessionID: input.sessionID, runID: input.runID })
      if (!point) return undefined
      return {
        point,
        next: point.taskID || point.step ? { taskID: point.taskID, step: point.step } : undefined,
      }
    })

    return Service.of({ mark, list, latest, resume })
  }),
)

export const defaultLayer = layer
