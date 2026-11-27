import { eq } from "drizzle-orm"
import type { TxOrDb } from "@/storage/db"
import { AgentTaskTable } from "@/team/team.sql"
import type { TaskGraph, TaskNode, TaskNodeStatus } from "./types"

/** Synthetic team id used by the task-board projection for Super-Agent runs. */
export const projectionTeamID = (runID: string) => `super-agent:${runID}`

const projectedTaskID = (runID: string, taskID: string) => `sa:${runID}:${taskID}`

function status(status: TaskNodeStatus): "pending" | "in_progress" | "completed" | "failed" {
  switch (status) {
    case "running":
      return "in_progress"
    case "succeeded":
    case "completed":
      return "completed"
    case "failed":
    case "needs_review":
      return "failed"
    default:
      return "pending"
  }
}

/**
 * Rebuild the AgentTask projection from the durable TaskGraph.
 *
 * This function deliberately only writes the projection table. The graph in
 * SuperAgentRun remains the source of truth; callers invoke it from the same
 * SQLite transaction that persists a graph mutation, so a crash cannot leave
 * a newly committed graph with an apparently current task board.
 */
export function projectTaskGraph(tx: TxOrDb, runID: string, graph: TaskGraph, now: number) {
  const teamID = projectionTeamID(runID)
  tx.delete(AgentTaskTable).where(eq(AgentTaskTable.team_id, teamID)).run()

  const blocks = new Map<string, string[]>()
  for (const node of graph.nodes) blocks.set(node.id, [])
  for (const node of graph.nodes) {
    for (const dependency of node.dependencies) blocks.get(dependency)?.push(projectedTaskID(runID, node.id))
  }

  for (const node of graph.nodes) {
    const id = projectedTaskID(runID, node.id)
    tx.insert(AgentTaskTable)
      .values({
        id,
        team_id: teamID,
        subject: node.title,
        description: node.objective,
        active_form: node.title,
        status: status(node.status),
        owner_session_id: null,
        blocks: blocks.get(node.id) ?? [],
        blocked_by: node.dependencies.map((dependency) => projectedTaskID(runID, dependency)),
        metadata: {
          projection: "super-agent-task-node",
          sourceRunID: runID,
          sourceTaskID: node.id,
          graphID: node.graphID,
          graphVersion: graph.version,
          kind: node.kind,
          sourceStatus: node.status,
          attempts: node.attempts,
          assignedAgent: node.assignedAgent,
          acceptanceCount: node.acceptanceCriteria.length,
          evidenceIDs: [...node.evidenceIDs],
          verificationIDs: [...node.verificationIDs],
        },
        created_by: null,
        created_at: node.createdAt,
        updated_at: Math.max(now, node.updatedAt),
      })
      .onConflictDoUpdate({
        target: AgentTaskTable.id,
        set: {
          subject: node.title,
          description: node.objective,
          active_form: node.title,
          status: status(node.status),
          blocks: blocks.get(node.id) ?? [],
          blocked_by: node.dependencies.map((dependency) => projectedTaskID(runID, dependency)),
          metadata: {
            projection: "super-agent-task-node",
            sourceRunID: runID,
            sourceTaskID: node.id,
            graphID: node.graphID,
            graphVersion: graph.version,
            kind: node.kind,
            sourceStatus: node.status,
            attempts: node.attempts,
            assignedAgent: node.assignedAgent,
            acceptanceCount: node.acceptanceCriteria.length,
            evidenceIDs: [...node.evidenceIDs],
            verificationIDs: [...node.verificationIDs],
          },
          updated_at: Math.max(now, node.updatedAt),
        },
      })
      .run()
  }
}
