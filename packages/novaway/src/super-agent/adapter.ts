export type AgentDescriptor = {
  id: string
  pluginID: string
  version: string
  displayName: string
  runtimeType: string
  role: string
  capabilities: readonly string[]
  tools: readonly string[]
  supports: {
    streaming: boolean
    pause: boolean
    resume: boolean
    cancellation: boolean
    delegation: boolean
    localExecution: boolean
  }
}

export type AgentRuntimeEvent =
  | { type: "started"; at: number }
  | { type: "progress"; at: number; message: string }
  | { type: "completed"; at: number; output: unknown }
  | { type: "failed"; at: number; code: string; message: string }
  | { type: "unknown"; at: number; reason: string }

export type AgentHandle = { id: string; runID: string; taskID: string }

export interface AgentRuntimeAdapter {
  readonly type: string
  readonly version: string
  discover(): Promise<AgentDescriptor[]>
  start(input: { runID: string; taskID: string; agentID: string; instruction: string }): Promise<AgentHandle>
  send(handle: AgentHandle, input: { instruction: string }): Promise<void>
  events(handle: AgentHandle): AsyncIterable<AgentRuntimeEvent>
  pause(handle: AgentHandle): Promise<{ checkpointID: string }>
  resume(handle: AgentHandle, checkpoint: { checkpointID: string }): Promise<void>
  cancel(handle: AgentHandle): Promise<void>
  dispose(handle: AgentHandle): Promise<void>
  heartbeat?(handle: AgentHandle): Promise<void>
}

export class AgentRuntimeAlreadyRegistered extends Error {}
export class AgentRuntimeNotFound extends Error {}

export class AgentRuntimeRegistry {
  private readonly adapters = new Map<string, AgentRuntimeAdapter>()

  register(adapter: AgentRuntimeAdapter) {
    if (this.adapters.has(adapter.type)) throw new AgentRuntimeAlreadyRegistered(adapter.type)
    this.adapters.set(adapter.type, adapter)
    return { dispose: () => this.adapters.delete(adapter.type) }
  }

  resolve(type: string) {
    return this.adapters.get(type)
  }

  list() {
    return [...this.adapters.values()]
  }

  async discover(type: string) {
    const adapter = this.resolve(type)
    if (!adapter) throw new AgentRuntimeNotFound(type)
    return adapter.discover()
  }
}

export type LocalAgentRuntimeInput = {
  descriptor: AgentDescriptor
  execute(input: { runID: string; taskID: string; agentID: string; instruction: string }): Promise<unknown>
}

/** Native/local adapter used by the first vertical slice; external runtimes must implement the same boundary. */
export class LocalAgentRuntimeAdapter implements AgentRuntimeAdapter {
  readonly type = "local-agent"
  readonly version = "1"
  private sequence = 0
  private readonly sessions = new Map<
    string,
    { queue: AgentRuntimeEvent[]; waiters: ((event: AgentRuntimeEvent) => void)[]; cancelled: boolean }
  >()

  constructor(private readonly input: LocalAgentRuntimeInput) {}

  async discover() {
    return [this.input.descriptor]
  }

  async start(input: { runID: string; taskID: string; agentID: string; instruction: string }) {
    const id = `${input.runID}:${input.taskID}:${Date.now()}:${++this.sequence}`
    const session = {
      queue: [] as AgentRuntimeEvent[],
      waiters: [] as ((event: AgentRuntimeEvent) => void)[],
      cancelled: false,
    }
    this.sessions.set(id, session)
    this.push(id, { type: "started", at: Date.now() })
    void this.input
      .execute(input)
      .then((output) => {
        if (!session.cancelled) this.push(id, { type: "completed", at: Date.now(), output })
      })
      .catch((error: unknown) => {
        if (!session.cancelled)
          this.push(id, {
            type: "failed",
            at: Date.now(),
            code: "agent_failed",
            message: error instanceof Error ? error.message : String(error),
          })
      })
    return { id, runID: input.runID, taskID: input.taskID }
  }

  async send(_handle: AgentHandle, _input: { instruction: string }) {}

  async *events(handle: AgentHandle) {
    const session = this.sessions.get(handle.id)
    if (!session) return
    while (this.sessions.has(handle.id)) {
      const event =
        session.queue.shift() ?? (await new Promise<AgentRuntimeEvent>((resolve) => session.waiters.push(resolve)))
      yield event
      if (event.type === "completed" || event.type === "failed" || event.type === "unknown") return
    }
  }

  async heartbeat(handle: AgentHandle) {
    if (!this.sessions.has(handle.id)) throw new Error("agent handle not found")
  }

  async pause(handle: AgentHandle) {
    if (!this.sessions.has(handle.id)) throw new Error("agent handle not found")
    return { checkpointID: `${handle.id}:checkpoint` }
  }

  async resume(_handle: AgentHandle, _checkpoint: { checkpointID: string }) {}

  async cancel(handle: AgentHandle) {
    const session = this.sessions.get(handle.id)
    if (session) session.cancelled = true
  }

  async dispose(handle: AgentHandle) {
    this.sessions.delete(handle.id)
  }

  private push(id: string, event: AgentRuntimeEvent) {
    const session = this.sessions.get(id)
    if (!session) return
    const waiter = session.waiters.shift()
    if (waiter) waiter(event)
    else session.queue.push(event)
  }
}

export type ProcessAgentRuntimeInput = {
  descriptor: AgentDescriptor
  command: string
  args?: readonly string[]
  cwd?: string
  env?: Record<string, string>
}

type ProcessSession = {
  process: ReturnType<typeof Bun.spawn>
  queue: AgentRuntimeEvent[]
  waiters: ((event: AgentRuntimeEvent) => void)[]
  done: boolean
}

/**
 * Adapter for an externally managed worker process using stdin/stdout as the
 * instruction/result boundary. The command is supplied by the host/plugin; no
 * executable is discovered or started implicitly.
 */
export class ProcessAgentRuntimeAdapter implements AgentRuntimeAdapter {
  readonly type = "process-agent"
  readonly version = "1"
  private sequence = 0
  private readonly sessions = new Map<string, ProcessSession>()

  constructor(private readonly input: ProcessAgentRuntimeInput) {}

  async discover() {
    return [this.input.descriptor]
  }

  async start(input: { runID: string; taskID: string; agentID: string; instruction: string }) {
    const id = `${input.runID}:${input.taskID}:${Date.now()}:${++this.sequence}`
    const child = Bun.spawn([this.input.command, ...(this.input.args ?? [])], {
      cwd: this.input.cwd,
      env: this.input.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    const session: ProcessSession = { process: child, queue: [], waiters: [], done: false }
    this.sessions.set(id, session)
    this.push(id, { type: "started", at: Date.now() })
    const stdin = child.stdin as any
    if (!stdin) throw new Error("agent process stdin is unavailable")
    stdin.write(input.instruction)
    stdin.end()
    void this.collect(id, child)
    return { id, runID: input.runID, taskID: input.taskID }
  }

  async send(handle: AgentHandle, input: { instruction: string }) {
    const session = this.sessions.get(handle.id)
    if (!session || session.done) throw new Error("agent handle is not writable")
    const stdin = session.process.stdin as any
    if (!stdin) throw new Error("agent process stdin is unavailable")
    stdin.write(input.instruction)
    stdin.end()
  }

  async *events(handle: AgentHandle) {
    const session = this.sessions.get(handle.id)
    if (!session) return
    while (this.sessions.has(handle.id)) {
      const event =
        session.queue.shift() ?? (await new Promise<AgentRuntimeEvent>((resolve) => session.waiters.push(resolve)))
      yield event
      if (event.type === "completed" || event.type === "failed" || event.type === "unknown") return
    }
  }

  async heartbeat(handle: AgentHandle) {
    const session = this.sessions.get(handle.id)
    if (!session) throw new Error("agent handle not found")
    if (session.done || session.process.exitCode !== null) throw new Error("agent process is not alive")
  }

  async pause(_handle: AgentHandle): Promise<{ checkpointID: string }> {
    throw new Error("process agent does not support pause")
  }

  async resume(_handle: AgentHandle, _checkpoint: { checkpointID: string }): Promise<void> {
    throw new Error("process agent does not support resume")
  }

  async cancel(handle: AgentHandle) {
    const session = this.sessions.get(handle.id)
    if (session && !session.done) session.process.kill()
  }

  async dispose(handle: AgentHandle) {
    const session = this.sessions.get(handle.id)
    if (session && !session.done) session.process.kill()
    this.sessions.delete(handle.id)
  }

  private async collect(id: string, child: ReturnType<typeof Bun.spawn>) {
    const session = this.sessions.get(id)
    if (!session) return
    try {
      const [output, exitCode] = await Promise.all([new Response(child.stdout as any).text(), child.exited])
      if (exitCode === 0) this.push(id, { type: "completed", at: Date.now(), output: output.trim() })
      else this.push(id, { type: "failed", at: Date.now(), code: `process_exit_${exitCode}`, message: output.trim() })
    } catch (error) {
      this.push(id, {
        type: "failed",
        at: Date.now(),
        code: "process_failed",
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      const current = this.sessions.get(id)
      if (current) current.done = true
    }
  }

  private push(id: string, event: AgentRuntimeEvent) {
    const session = this.sessions.get(id)
    if (!session) return
    const waiter = session.waiters.shift()
    if (waiter) waiter(event)
    else session.queue.push(event)
  }
}
