import type { TaskGraph } from "./types"

export class InvalidTaskGraph extends Error {
  constructor(message: string) {
    super(`invalid Super-Agent task graph: ${message}`)
  }
}

export function validateTaskGraph(graph: TaskGraph, maxNodes = 200): TaskGraph {
  if (!graph.id || !graph.rootTaskID) throw new InvalidTaskGraph("id and rootTaskID are required")
  if (!Number.isSafeInteger(graph.version) || graph.version < 1)
    throw new InvalidTaskGraph("version must be a positive integer")
  if (graph.nodes.length === 0 || graph.nodes.length > maxNodes)
    throw new InvalidTaskGraph(`node count must be 1..${maxNodes}`)
  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (ids.has(node.id)) throw new InvalidTaskGraph(`duplicate node: ${node.id}`)
    ids.add(node.id)
    if (node.graphID !== graph.id) throw new InvalidTaskGraph(`node ${node.id} belongs to another graph`)
  }
  if (!ids.has(graph.rootTaskID)) throw new InvalidTaskGraph("root task does not exist")
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new InvalidTaskGraph("edge references a missing node")
    if (edge.from === edge.to && edge.kind === "depends_on") throw new InvalidTaskGraph("self dependency")
  }
  const dependencies = new Map(graph.nodes.map((node) => [node.id, node.dependencies]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new InvalidTaskGraph("dependency cycle")
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of dependencies.get(id) ?? []) {
      if (!ids.has(dependency)) throw new InvalidTaskGraph(`task ${id} depends on missing task ${dependency}`)
      visit(dependency)
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)
  return graph
}

export type TaskMutationSnapshot = {
  taskID: string
  graphVersion: number
  after: unknown
}

/** Replays durable Task snapshots onto a known graph after a restart/reconnect. */
export function replayTaskMutations(graph: TaskGraph, mutations: readonly TaskMutationSnapshot[]): TaskGraph {
  const next = structuredClone(graph)
  for (const mutation of [...mutations].sort((a, b) => a.graphVersion - b.graphVersion)) {
    if (!Number.isSafeInteger(mutation.graphVersion) || mutation.graphVersion < 1)
      throw new InvalidTaskGraph(`mutation version must be a positive integer: ${mutation.graphVersion}`)
    if (!mutation.after || typeof mutation.after !== "object")
      throw new InvalidTaskGraph(`mutation ${mutation.taskID} has no task snapshot`)
    const task = mutation.after as TaskGraph["nodes"][number]
    if (task.id !== mutation.taskID)
      throw new InvalidTaskGraph(`mutation task ID mismatch: ${mutation.taskID} != ${task.id}`)
    const index = next.nodes.findIndex((item) => item.id === mutation.taskID)
    if (index === -1) next.nodes.push(task)
    else next.nodes[index] = task
    next.version = Math.max(next.version, mutation.graphVersion)
  }
  return validateTaskGraph(next)
}

export function nextTaskGraph(current: TaskGraph, replacement: TaskGraph, expectedVersion: number) {
  if (current.version !== expectedVersion)
    throw new InvalidTaskGraph(`version conflict: expected ${expectedVersion}, current ${current.version}`)
  if (replacement.id !== current.id) throw new InvalidTaskGraph("graph ID cannot change")
  const next = { ...replacement, version: current.version + 1 }
  return validateTaskGraph(next)
}
