import { describe, expect, test } from "bun:test"
import { replayTaskMutations, InvalidTaskGraph } from "../../src/super-agent"
import { SuperAgentRuntime } from "../../src/super-agent"
import type { Goal, TaskNode } from "../../src/super-agent"

const goal: Goal = {
  text: "replay a durable graph",
  constraints: [],
  source: "user",
  requestedBy: "graph-test",
  acceptanceCriteria: [],
}

describe("Super-Agent task mutation replay", () => {
  test("replays ordered updates and inserts new task snapshots", () => {
    const run = SuperAgentRuntime.create({ id: "sa_graph_replay", goal }).runtime.snapshot()
    const root = run.graph.nodes[0]!
    const child: TaskNode = {
      ...root,
      id: "sa_graph_replay:child",
      title: "Child task",
      objective: "replayed child",
      dependencies: [],
      createdAt: root.createdAt + 1,
      updatedAt: root.updatedAt + 2,
    }

    const replayed = replayTaskMutations(run.graph, [
      {
        taskID: root.id,
        graphVersion: 3,
        after: { ...root, title: "Final root", updatedAt: root.updatedAt + 3 },
      },
      { taskID: child.id, graphVersion: 2, after: child },
    ])

    expect(replayed.version).toBe(3)
    expect(replayed.nodes).toHaveLength(2)
    expect(replayed.nodes.find((task) => task.id === root.id)?.title).toBe("Final root")
    expect(replayed.nodes.find((task) => task.id === child.id)).toMatchObject({
      id: child.id,
      graphID: run.graph.id,
      title: "Child task",
    })
  })

  test("rejects malformed mutation snapshots through graph validation", () => {
    const run = SuperAgentRuntime.create({ id: "sa_graph_invalid", goal }).runtime.snapshot()
    const root = run.graph.nodes[0]!

    expect(() =>
      replayTaskMutations(run.graph, [
        { taskID: root.id, graphVersion: 2, after: { ...root, graphID: "other-graph" } },
      ]),
    ).toThrow(InvalidTaskGraph)

    expect(() =>
      replayTaskMutations(run.graph, [{ taskID: root.id, graphVersion: 2, after: { ...root, id: "other-task" } }]),
    ).toThrow("mutation task ID mismatch")
  })
})
