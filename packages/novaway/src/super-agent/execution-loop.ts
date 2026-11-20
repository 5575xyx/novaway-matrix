import { Effect } from "effect"
import { DeterministicSupervisor, type SuperAgentSupervisor } from "./supervisor"
import type { Interface as SuperAgentStoreInterface } from "./store"
import type { AgentInstruction, ExecutorResult, SuperAgentRun } from "./types"
import { SuperAgentRuntime, type SuperAgentExecutor } from "./runtime"

export type SuperAgentExecutionStep = {
  instructions: readonly AgentInstruction[]
  results: readonly { instruction: AgentInstruction; result: ExecutorResult }[]
  checkpointIDs: readonly string[]
}

/**
 * Small host-side coordinator for the vertical slice. It deliberately keeps
 * scheduling outside the kernel: the kernel remains the only owner of state
 * transitions, idempotency, and completion guards.
 */
export class SuperAgentExecutionLoop {
  constructor(
    private readonly runtime: SuperAgentRuntime,
    private readonly supervisor: SuperAgentSupervisor = new DeterministicSupervisor(),
    private readonly maxParallel = 4,
    private readonly store?: SuperAgentStoreInterface,
  ) {
    if (!Number.isInteger(maxParallel) || maxParallel < 1) throw new Error("maxParallel must be a positive integer")
  }

  snapshot() {
    return this.runtime.snapshot()
  }

  async step(): Promise<SuperAgentExecutionStep> {
    const decision = this.supervisor.decide(this.runtime.snapshot())
    const results: { instruction: AgentInstruction; result: ExecutorResult }[] = []
    const checkpointIDs: string[] = []
    for (let offset = 0; offset < decision.instructions.length; offset += this.maxParallel) {
      const batch = decision.instructions.slice(offset, offset + this.maxParallel)
      await Promise.all(
        batch.map(async (instruction) => {
          if (instruction.type === "checkpoint") {
            checkpointIDs.push(this.runtime.checkpoint(instruction.reason).id)
            return
          }
          const dispatched = await this.runtime.dispatch(instruction)
          results.push({ instruction, result: dispatched.result })
        }),
      )
    }
    if (this.store) {
      const current = await Effect.runPromise(this.store.get(this.runtime.snapshot().id))
      if (current) {
        const updated = await Effect.runPromise(
          this.store.updateGraph(current.id, this.runtime.snapshot().graph, current.graph.version),
        )
        if (updated) {
          this.runtime.restore(updated)
          for (const entry of results) {
            if (entry.result.type !== "agent_failed" && entry.result.type !== "unknown") continue
            const taskID = "taskID" in entry.instruction ? entry.instruction.taskID : undefined
            const task = taskID ? updated.graph.nodes.find((candidate) => candidate.id === taskID) : undefined
            if (task?.status === "ready" && task.retryAt !== undefined) {
              await Effect.runPromise(
                this.store.appendEvent({
                  runID: updated.id,
                  type: "task_retry_scheduled",
                  at: Date.now(),
                  payload: {
                    taskID: task.id,
                    attempt: task.attempts,
                    retryAt: task.retryAt,
                    reason: "message" in entry.result ? entry.result.message : entry.result.reason,
                  },
                }),
              )
            }
          }
        }
      }
    }
    return { instructions: decision.instructions, results, checkpointIDs }
  }

  async run(maxSteps = 100) {
    const steps: SuperAgentExecutionStep[] = []
    for (let index = 0; index < maxSteps; index += 1) {
      const step = await this.step()
      steps.push(step)
      if (step.instructions.length === 0) break
    }
    return { run: this.runtime.snapshot(), steps }
  }
}

export type SuperAgentExecutionLoopInput = {
  run: SuperAgentRun
  executor: SuperAgentExecutor
  supervisor?: SuperAgentSupervisor
  maxParallel?: number
  store?: SuperAgentStoreInterface
}

export function createSuperAgentExecutionLoop(input: SuperAgentExecutionLoopInput) {
  return new SuperAgentExecutionLoop(
    new SuperAgentRuntime(input.run, { append() {}, events: () => [] }, input.executor),
    input.supervisor,
    input.maxParallel,
    input.store,
  )
}
