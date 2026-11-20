import type { AgentInstruction, ExecutorResult, SuperAgentRun } from "./types"

export type SuperAgentExecutorHandler = (instruction: AgentInstruction, run: SuperAgentRun) => Promise<ExecutorResult>

export type SuperAgentExecutorDescriptor = {
  id: string
  version: string
  capabilities: readonly string[]
  execute: SuperAgentExecutorHandler
}

export class ExecutorAlreadyRegistered extends Error {}
export class ExecutorNotFound extends Error {}

export class SuperAgentExecutorRegistry {
  private readonly entries = new Map<string, SuperAgentExecutorDescriptor>()
  private readonly disabled = new Set<string>()

  register(descriptor: SuperAgentExecutorDescriptor) {
    if (this.entries.has(descriptor.id)) throw new ExecutorAlreadyRegistered(descriptor.id)
    this.entries.set(descriptor.id, descriptor)
    this.disabled.delete(descriptor.id)
    return { dispose: () => this.disable(descriptor.id) }
  }

  disable(id: string) {
    if (!this.entries.has(id)) return false
    this.disabled.add(id)
    return true
  }

  enable(id: string) {
    if (!this.entries.has(id)) return false
    this.disabled.delete(id)
    return true
  }

  resolve(id: string) {
    const descriptor = this.entries.get(id)
    if (!descriptor || this.disabled.has(id)) return undefined
    return descriptor
  }

  list() {
    return [...this.entries.values()].filter((entry) => !this.disabled.has(entry.id))
  }

  async execute(id: string, instruction: AgentInstruction, run: SuperAgentRun) {
    const descriptor = this.resolve(id)
    if (!descriptor) throw new ExecutorNotFound(id)
    return descriptor.execute(instruction, run)
  }
}
