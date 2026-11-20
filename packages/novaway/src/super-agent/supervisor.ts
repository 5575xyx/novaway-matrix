import { readyTasks } from "./state"
import type { AgentInstruction, SuperAgentRun } from "./types"

export type SupervisorDecision = {
  instructions: AgentInstruction[]
  reason: string
}

export interface SuperAgentSupervisor {
  readonly id: string
  decide(run: SuperAgentRun): SupervisorDecision
}

export class DeterministicSupervisor implements SuperAgentSupervisor {
  readonly id = "builtin.deterministic"

  decide(run: SuperAgentRun): SupervisorDecision {
    const tasks = readyTasks(run)
    if (tasks.length === 0) return { instructions: [], reason: "no ready tasks" }
    return {
      reason: `dispatch ${tasks.length} ready task(s)`,
      instructions: tasks.map((task, index) => {
        const requestedTool = task.input as { tool?: unknown; input?: unknown } | undefined
        const requestedAgent = task.input as { agentID?: unknown; instruction?: unknown } | undefined
        if (typeof requestedAgent?.agentID === "string")
          return {
            type: "call_agent" as const,
            runID: run.id,
            taskID: task.id,
            agentID: requestedAgent.agentID,
            instruction: typeof requestedAgent.instruction === "string" ? requestedAgent.instruction : task.objective,
            instructionID: `${run.id}:agent:${run.graph.version}:${task.id}:attempt:${task.attempts}`,
            issuedAt: Date.now(),
            policyContextHash: "builtin.deterministic:v1",
            capability: "agent",
            idempotencyKey: `${run.id}:agent:${run.graph.version}:${task.id}:attempt:${task.attempts}`,
          }
        if (typeof requestedTool?.tool === "string")
          return {
            type: "run_tool" as const,
            runID: run.id,
            taskID: task.id,
            tool: requestedTool.tool,
            input: requestedTool.input,
            instructionID: `${run.id}:tool:${run.graph.version}:${task.id}:attempt:${task.attempts}`,
            issuedAt: Date.now(),
            policyContextHash: "builtin.deterministic:v1",
            capability: "tool",
            idempotencyKey: `${run.id}:tool:${run.graph.version}:${task.id}:attempt:${task.attempts}`,
          }
        return {
          type: "checkpoint" as const,
          runID: run.id,
          reason: `before scheduling ${task.id}`,
          instructionID: `${run.id}:checkpoint:${run.graph.version}:${index}`,
          issuedAt: Date.now(),
          policyContextHash: "builtin.deterministic:v1",
          capability: "checkpoint",
          idempotencyKey: `${run.id}:checkpoint:${run.graph.version}:${task.id}`,
        }
      }),
    }
  }
}
