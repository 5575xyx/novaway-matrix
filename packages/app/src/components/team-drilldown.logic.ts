import { UNCLAIMED, type GraphLaneInput, type GraphMember, type GraphTask } from "./team-graph.layout"

/**
 * 点开一个节点之后要回答的问题（§4.3）。
 *
 * 图只画了「队长 → 任务 → 人」的形状；用户点一个节点，真正想知道的是
 * 「这一步谁在做、这个人还领了什么、验收过了没有」。这里把这些算成一个
 * 可断言的结构：哪些任务、归谁、挂了几条验收、最近一次结论是什么。
 *
 * 不读会话内容、不读命令与输出：验收只给结论，任务只给标题与状态 ——
 * 与事件流、回放同一条约束。
 */

export type DrillAcceptance = {
  id: string
  taskID?: string
  text: string
  kind: string
  /** 最近一次验证的结论：pass / fail / unverified / stale；还没验过时缺省。 */
  outcome?: string
}

export type DrillLine = {
  task: GraphTask
  owner?: GraphMember
  /** 挂在这条任务上的验收，按「没过的在前」排：先看要返工的。 */
  acceptances: DrillAcceptance[]
}

export type DrillView = {
  kind: "task" | "member" | "captain"
  /** 任务节点是任务标题；成员 / 队长节点是人名。未认领时为空，由界面翻译。 */
  title: string
  /** 节点的落点不是某个人：任务还没派下去。 */
  unclaimed?: boolean
  /** 做这一步的人：任务节点看认领人，成员 / 队长节点就是本人。 */
  person?: { name: string; job?: string; role?: "captain" | "worker" }
  /** 打开执行会话用：任务认领人的会话 id。 */
  ownerSessionID?: string
  lines: DrillLine[]
  /** 这条泳道上「有任务、还没人认领」的条数。 */
  unassigned: number
}

/** 已完成的排在前面：用户点进来通常先看「他做完了什么」。 */
const TASK_RANK: Record<string, number> = { completed: 0, in_progress: 1, failed: 2, pending: 3, cancelled: 4 }
/** 没过的排在前面，和看板的验收账本同一口径。 */
const OUTCOME_RANK: Record<string, number> = { fail: 0, stale: 1, unverified: 2, pass: 3 }

const TASK_PREFIX = "task:"
const MEMBER_PREFIX = "member:"
const CAPTAIN_PREFIX = "captain:"

const rankOf = (rank: Record<string, number>, key: string | undefined, fallback: number) =>
  key === undefined ? fallback : (rank[key] ?? fallback)

/** 与布局同一把钥匙：有名字按名字，没名字按会话，再没有就是未认领。 */
const memberKey = (task: GraphTask) => task.ownerName ?? task.owner ?? UNCLAIMED

const isUnclaimed = (task: GraphTask) => !task.owner && !task.ownerName

function memberOf(lane: GraphLaneInput, task?: GraphTask): GraphMember | undefined {
  if (!task) return undefined
  return (
    lane.members.find((member) => task.ownerName !== undefined && member.name === task.ownerName) ??
    lane.members.find((member) => task.owner !== undefined && member.id === task.owner) ??
    lane.members.find((member) => task.ownerName !== undefined && member.id === task.ownerName)
  )
}

function linesOf(
  lane: GraphLaneInput,
  tasks: readonly GraphTask[],
  acceptances: readonly DrillAcceptance[],
): DrillLine[] {
  return [...tasks]
    .sort((a, b) => rankOf(TASK_RANK, a.status, 9) - rankOf(TASK_RANK, b.status, 9))
    .map((task) => {
      const owner = memberOf(lane, task)
      return {
        task,
        ...(owner ? { owner } : {}),
        acceptances: acceptances
          .filter((acceptance) => acceptance.taskID === task.id)
          .sort((a, b) => rankOf(OUTCOME_RANK, a.outcome, 4) - rankOf(OUTCOME_RANK, b.outcome, 4)),
      }
    })
}

/**
 * 把点击的节点翻译成面板内容。
 *
 * 节点 id 是布局生成的（`task:` / `member:` / `captain:`），这里按同一套前缀
 * 反解；认不出就返回 `undefined`，界面不画一个空面板。
 */
export function buildDrill(input: {
  nodeID: string
  lane: GraphLaneInput
  acceptances: readonly DrillAcceptance[]
}): DrillView | undefined {
  const tasks = input.lane.tasks ?? []
  const unassigned = tasks.filter(isUnclaimed).length

  if (input.nodeID.startsWith(TASK_PREFIX)) {
    const task = tasks.find((item) => item.id === input.nodeID.slice(TASK_PREFIX.length))
    if (!task) return undefined
    return {
      kind: "task",
      title: task.subject,
      ...(task.ownerName
        ? {
            person: {
              name: task.ownerName,
              ...(task.ownerJob ? { job: task.ownerJob } : {}),
              ...(task.ownerRole ? { role: task.ownerRole } : {}),
            },
          }
        : {}),
      ...(task.owner ? { ownerSessionID: task.owner } : {}),
      lines: linesOf(input.lane, [task], input.acceptances),
      unassigned,
    }
  }

  if (input.nodeID.startsWith(MEMBER_PREFIX)) {
    const key = input.nodeID.slice(MEMBER_PREFIX.length)
    const owned = tasks.filter((task) => memberKey(task) === key)
    const roster = input.lane.members.find((member) => member.id === key)
    const first = owned[0]
    // 未认领不是一个人：标题交给界面说「还没人认领」，但任务仍然列出来。
    if (key === UNCLAIMED) {
      return {
        kind: "member",
        title: "",
        unclaimed: true,
        lines: linesOf(input.lane, owned, input.acceptances),
        unassigned,
      }
    }
    const name = first?.ownerName ?? roster?.name ?? key
    const job = first?.ownerJob ?? roster?.job
    const role = first?.ownerRole ?? roster?.role
    return {
      kind: "member",
      title: name,
      person: { name, ...(job ? { job } : {}), ...(role ? { role } : {}) },
      ...(first?.owner ? { ownerSessionID: first.owner } : {}),
      lines: linesOf(input.lane, owned, input.acceptances),
      unassigned,
    }
  }

  if (input.nodeID.startsWith(CAPTAIN_PREFIX)) {
    const captain = input.lane.members.find((member) => member.role === "captain")
    return {
      kind: "captain",
      title: captain?.name ?? input.lane.name,
      ...(captain ? { person: { name: captain.name, job: captain.job, role: captain.role } } : {}),
      lines: linesOf(input.lane, tasks, input.acceptances),
      unassigned,
    }
  }

  return undefined
}
