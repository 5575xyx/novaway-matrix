/**
 * 工作线的图形布局（§4.3 的「像图谱一样看一条工作线」）。
 *
 * 一次派发的形状其实很固定：队长发出若干任务 → 成员并行认领、干活 → 完成后把
 * 产物交回队长。这里把这个形状算成一列节点与一条条边，界面只负责画。
 *
 * 为什么是纯函数：布局出错时最难查的是「为什么这条边连错了人」。把「谁做什么、
 * 谁交回什么」算成一个可断言的结构，测试能钉住口径，界面怎么换皮都不会改坏它。
 */

export type GraphTask = {
  id: string
  subject: string
  status: string
  /** 最后动过的时间：详情里用来说「这一步停了多久」，不冒充完成时间。 */
  updatedAt?: number
  owner?: string
  ownerName?: string
  ownerJob?: string
  ownerRole?: "captain" | "worker"
}

export type GraphMember = {
  id: string
  name: string
  job: string
  role: "captain" | "worker"
}

export type GraphLaneInput = {
  id: string
  name: string
  phase: string
  /** 这一队在跑第几轮；返工轮次在图上要标出来，不能和第一轮混在一起。 */
  round: number
  members: readonly GraphMember[]
  tasks: readonly GraphTask[]
}

export type NodeKind = "captain" | "task" | "member"

export type GraphNode = {
  id: string
  kind: NodeKind
  label: string
  /** 岗位或状态说明，画在第二行。 */
  sublabel?: string
  status: string
  x: number
  y: number
  round: number
}

export type EdgeKind = "assign" | "work" | "deliver"

export type GraphEdge = {
  id: string
  from: string
  to: string
  kind: EdgeKind
  round: number
  /** 边上有人正在动：动画只给这条，不给整张图。 */
  active: boolean
  /** 交付已经完成（任务全部完成或团队已交付）。 */
  done: boolean
}

/**
 * 边上的流动档位（§4.3）：正在做 → 快，已完成 → 慢，还没轮到 → 背景里最慢。
 *
 * 这一档只由状态决定，不交给界面去猜：否则「有动画就是进行中」这条口径
 * 会在各处的 classList 里各写一遍，慢慢就漂了。
 */
export type EdgeFlow = "active" | "settled" | "idle"

export function edgeFlow(edge: GraphEdge): EdgeFlow {
  if (edge.active) return "active"
  return edge.done ? "settled" : "idle"
}

export type GraphLane = {
  id: string
  name: string
  phase: string
  round: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  width: number
  height: number
  /** 有任务但还没有人认领时，界面要明确说「还没派下去」。 */
  unassigned: number
  participants: number
}

export const NODE_WIDTH = 164
export const NODE_HEIGHT = 46
const COLUMN_GAP = 96
const ROW_GAP = 62
const PAD = 16
/** 交付回边要从成员绕回队长，给底部留出弧线的空间。 */
const RETURN_PAD = 56
const COLUMNS = [PAD, PAD + NODE_WIDTH + COLUMN_GAP, PAD + (NODE_WIDTH + COLUMN_GAP) * 2]

const DONE = new Set(["completed", "delivered"])
const ACTIVE = new Set(["in_progress", "running", "executing", "rework"])

const isDone = (status: string) => DONE.has(status)
const isActive = (status: string) => ACTIVE.has(status)

/** 未认领的任务也要有一个落点：它们和「已认领但没开工」是两件事。 */
export const UNCLAIMED = "unclaimed"

/**
 * 参与者：按名字去重（一个成员可能同时拥有多个任务），保持任务出现顺序。
 *
 * 只统计真正出现在任务上的名字，不把名册里没接到活的人算进「实际参与人数」——
 * 那个数字回答的是「这次有几个人干了活」。
 */
export function participants(tasks: readonly GraphTask[]): string[] {
  const names = new Set<string>()
  for (const task of tasks) if (task.ownerName) names.add(task.ownerName)
  return [...names]
}

export function layoutLane(input: GraphLaneInput): GraphLane {
  const tasks = input.tasks ?? []
  const captainMember = input.members.find((member) => member.role === "captain")
  const workers = input.members.filter((member) => member.role !== "captain")

  // 按「认领人」分组：有名字按名字，没名字落到「未认领」。
  const groups = new Map<string, { name: string; job?: string; tasks: GraphTask[] }>()
  for (const task of tasks) {
    const key = task.ownerName ?? (task.owner ? task.owner : UNCLAIMED)
    const name = task.ownerName ?? "未认领"
    const current = groups.get(key) ?? { name, job: task.ownerJob, tasks: [] }
    current.tasks.push(task)
    groups.set(key, current)
  }
  // 一条任务都还没派下去时，图不该是空的：把名册里的成员画成待命。
  const showRoster = groups.size === 0
  if (showRoster) for (const worker of workers) groups.set(worker.id, { name: worker.name, job: worker.job, tasks: [] })

  const rows = Math.max(groups.size, 1)
  const height = rows * ROW_GAP + PAD * 2 + RETURN_PAD
  const center = PAD + ((rows - 1) * ROW_GAP) / 2

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const captainID = "captain:" + input.id

  nodes.push({
    id: captainID,
    kind: "captain",
    label: captainMember?.name ?? input.name,
    // 说明文字交给界面翻译：布局只表达「忙 / 闲」。
    sublabel: isActive(input.phase) ? "busy" : "idle",
    status: isActive(input.phase) ? "active" : "idle",
    x: COLUMNS[0],
    y: center,
    round: input.round,
  })

  let index = 0
  for (const [key, group] of groups) {
    const y = PAD + index * ROW_GAP
    const memberID = "member:" + key
    const allDone = group.tasks.length > 0 && group.tasks.every((task) => isDone(task.status))
    nodes.push({
      id: memberID,
      kind: "member",
      label: group.name,
      sublabel: group.job,
      status: showRoster ? "idle" : allDone ? "done" : "active",
      x: COLUMNS[2],
      y,
      round: input.round,
    })

    // 任务节点：一条任务一个，按出现顺序排成一列；边负责把「谁做的」说清楚。
    for (const task of group.tasks) {
      const taskID = "task:" + task.id
      const taskY = PAD + nodes.filter((node) => node.kind === "task").length * ROW_GAP
      nodes.push({
        id: taskID,
        kind: "task",
        label: task.subject,
        sublabel: task.status,
        status: task.status,
        x: COLUMNS[1],
        y: taskY,
        round: input.round,
      })
      edges.push({
        id: "assign:" + task.id,
        from: captainID,
        to: taskID,
        kind: "assign",
        round: input.round,
        active: isActive(task.status),
        done: isDone(task.status),
      })
      edges.push({
        id: "work:" + task.id,
        from: taskID,
        to: memberID,
        kind: "work",
        round: input.round,
        active: isActive(task.status),
        done: isDone(task.status),
      })
    }

    if (allDone) {
      // 交付是一条回边：成员把产物交回队长，不是又一条「派发」。
      edges.push({
        id: "deliver:" + key,
        from: memberID,
        to: captainID,
        kind: "deliver",
        round: input.round,
        active: false,
        done: true,
      })
    }
    index += 1
  }

  return {
    id: input.id,
    name: input.name,
    phase: input.phase,
    round: input.round,
    nodes,
    edges,
    width: COLUMNS[2] + NODE_WIDTH + PAD,
    height,
    unassigned: groups.get(UNCLAIMED)?.tasks.length ?? 0,
    participants: showRoster ? 0 : participants(tasks).length,
  }
}

/** 一次运行里的每支团队各画一条泳道，按原顺序上下排。 */
export function layoutRun(input: { teams: readonly GraphLaneInput[] }): GraphLane[] {
  return input.teams.map((team) => layoutLane(team))
}
