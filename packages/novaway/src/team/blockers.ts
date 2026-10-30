import type { RunEvent } from "./run"

/**
 * 看板上的「阻塞与拒绝」（§11.2）。
 *
 * 拒绝不能只写在事件日志里等人去翻：它必须出现在看板上，并且要标出
 * **换成别人也没用** —— 权限类阻塞换人是提权，只能由用户放行。
 *
 * 这里只做筛选与规整，不重写原因：事件里的 `reason` 才是当时真正发生的事。
 */

export type BlockerKind = "tool.denied" | "integration.commit_failed" | "budget.exceeded" | "team.conflict"

export type Blocker = {
  seq: number
  at: number
  kind: BlockerKind
  /** 被拒绝的工具（`tool.denied`）。 */
  tool?: string
  taskID?: string
  /** 拒绝/失败的原因原文。 */
  reason?: string
  /** 冲突涉及的团队与文件数。 */
  teamID?: string
  files?: number
}

export const BLOCKING_KINDS: readonly BlockerKind[] = [
  "tool.denied",
  "integration.commit_failed",
  "budget.exceeded",
  "team.conflict",
]

const isBlocking = (kind: string): kind is BlockerKind => (BLOCKING_KINDS as readonly string[]).includes(kind)

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

/**
 * 从事件流里取出阻塞项。
 *
 * 顺序保持事件序：先发生的先显示，和看板上其他「按时间往下讲」的部分一致。
 */
export function from(events: readonly RunEvent[]): Blocker[] {
  return events.flatMap((event) => {
    if (!isBlocking(event.kind)) return []
    const payload = event.payload ?? {}
    const files: unknown = Reflect.get(payload, "files")
    return [
      {
        seq: event.seq,
        at: event.at,
        kind: event.kind,
        tool: text(Reflect.get(payload, "tool")),
        taskID: text(Reflect.get(payload, "taskID")),
        reason:
          text(Reflect.get(payload, "reason")) ??
          text(Reflect.get(payload, "message")) ??
          text(Reflect.get(payload, "team")),
        teamID: text(Reflect.get(payload, "teamID")),
        ...(Array.isArray(files) ? { files: files.length } : {}),
      },
    ]
  })
}

/**
 * 能不能靠「换个人来做」解决。
 *
 * 只有权限类不能（§11.2）：换一个「权限更高」的员工去执行同一个动作，就是提权。
 */
export function swappable(kind: BlockerKind): boolean {
  return kind !== "tool.denied"
}
