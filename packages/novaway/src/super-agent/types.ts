/** Typed contracts for the Super-Agent kernel. The kernel owns lifecycle and policy;
 * model-backed supervisors only produce values from these unions. */

export type SuperAgentRunStatus =
  | "draft"
  | "planning"
  | "ready"
  | "running"
  | "waiting_approval"
  | "waiting_input"
  | "waiting_external"
  | "paused"
  | "needs_review"
  | "verifying"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "completed"

export type TaskNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "retrying"
  | "succeeded"
  | "verifying"
  | "completed"
  | "failed"
  | "blocked"
  | "needs_review"

export type OperationStatus = "started" | "progress" | "waiting" | "succeeded" | "failed" | "cancelled" | "unknown"
export type VerificationOutcome = "pass" | "fail" | "unverified" | "stale" | "needs_review"
export type EvidenceKind = "test" | "file" | "http" | "screenshot" | "log" | "artifact" | "human" | "external"

export type ID = string

/** Versioned wire contracts. Persisted records and events must retain this value. */
export const SUPER_AGENT_PROTOCOL_VERSION = 1 as const
export const SUPER_AGENT_EVENT_VERSION = "sa.event.v1" as const

export type Budget = {
  tokens?: number
  usd?: number
  wallTimeMs?: number
  steps?: number
  toolCalls?: number
  childAgents?: number
  parallelism?: number
}

export type Usage = {
  tokens: number
  usd: number
  wallTimeMs: number
  steps: number
  toolCalls: number
  childAgents: number
}

export type AcceptanceCriterion = {
  id: ID
  text: string
  required: boolean
}

export type GoalPlanTask = {
  id: ID
  kind: string
  title: string
  objective: string
  dependencies?: readonly ID[]
  input?: unknown
  acceptanceCriteria?: readonly AcceptanceCriterion[]
  retryPolicy?: RetryPolicy
}

export type Goal = {
  text: string
  constraints: readonly string[]
  acceptanceCriteria: AcceptanceCriterion[]
  /**
   * A versioned, user/model-produced plan. Keeping the plan in the Goal makes
   * planning restart-safe: the worker never has to infer a missing task graph
   * after a process restart.
   */
  plan?: readonly GoalPlanTask[]
  planningMode?: "deterministic" | "model"
  source: "user" | "trigger" | "plugin" | "api" | "agent"
  requestedBy: string
  /** The NovaWay Goal this durable run owns, when started from Goal mode. */
  goalId?: string
  /** Session that owns goalId; retained for audit and cross-process recovery. */
  sessionId?: string
}

export type RetryPolicy = {
  maxAttempts: number
  backoffMs: number
  retryable: boolean
}

export type TaskNode = {
  id: ID
  graphID: ID
  kind: string
  title: string
  objective: string
  status: TaskNodeStatus
  dependencies: ID[]
  assignedAgent?: string
  assignedWorker?: string
  input?: unknown
  output?: unknown
  acceptanceCriteria: AcceptanceCriterion[]
  retryPolicy: RetryPolicy
  attempts: number
  retryAt?: number
  evidenceIDs: readonly ID[]
  verificationIDs: ID[]
  createdAt: number
  updatedAt: number
}

export type TaskGraph = {
  id: ID
  version: number
  nodes: TaskNode[]
  edges: {
    from: ID
    to: ID
    kind: "depends_on" | "blocks" | "repairs" | "verifies" | "delegates_to" | "derived_from"
  }[]
  rootTaskID: ID
  planHash: string
}

export type SuperAgentRun = {
  id: ID
  goal: Goal
  status: SuperAgentRunStatus
  graph: TaskGraph
  budget: Budget
  usage: Usage
  currentTaskID?: ID
  checkpointID?: ID
  failure?: { code: string; message: string }
  completion?: { summary: string; verificationIDs: ID[] }
  createdAt: number
  updatedAt: number
}

export type Evidence = {
  id: ID
  runID: ID
  taskID: ID
  kind: EvidenceKind
  source: string
  contentHash?: string
  measured?: string
  expiresAt?: number
  capturedAt: number
}

export type Verification = {
  id: ID
  runID: ID
  taskID?: ID
  acceptanceID: ID
  verifierID: string
  verifierVersion: string
  outcome: VerificationOutcome
  measured?: string
  evidenceIDs: readonly ID[]
  reason: string
  createdAt: number
}

export type SuperAgentCheckpoint = {
  id: ID
  runID: ID
  reason: string
  eventSequence: number
  stateVersion: number
  run: SuperAgentRun
  createdAt: number
}

export type SuperAgentOperation = {
  id: ID
  runID: ID
  instructionID: ID
  idempotencyKey: string
  status: OperationStatus
  leaseUntil: number
  startedAt: number
  updatedAt: number
  result?: ExecutorResult
  reason?: string
}

export type BudgetReservation = {
  id: ID
  runID: ID
  requested: Budget
  settled?: Budget
  status: "reserved" | "settled" | "released" | "overrun"
  createdAt: number
  updatedAt: number
}

export type ApprovalRequest = {
  id: ID
  runID: ID
  taskID: ID
  reason: string
  scope: string
  status: "pending" | "approved" | "rejected" | "expired"
  decidedBy?: string
  decisionReason?: string
  expiresAt?: number
  createdAt: number
  updatedAt: number
}

export type InputRequest = {
  id: ID
  runID: ID
  taskID: ID
  prompt: string
  status: "pending" | "answered" | "expired"
  answer?: string
  createdAt: number
  updatedAt: number
}

export type AgentInstructionMetadata = {
  instructionID: ID
  runID: ID
  parentEventID?: ID
  issuedAt: number
  policyContextHash: string
  capability: string
  idempotencyKey: string
}

export type AgentInstruction = AgentInstructionMetadata &
  (
    | { type: "call_agent"; taskID: ID; agentID: string; instruction: string }
    | { type: "parallel_call_agents"; taskID: ID; calls: { agentID: string; instruction: string }[] }
    | { type: "spawn_task"; parentTaskID: ID; task: Pick<TaskNode, "kind" | "title" | "objective" | "dependencies"> }
    | { type: "delegate"; taskID: ID; target: string; reason?: string }
    | { type: "run_tool"; taskID: ID; tool: string; input: unknown }
    | { type: "request_approval"; taskID: ID; reason: string; scope: string }
    | { type: "request_input"; taskID: ID; prompt: string }
    | { type: "checkpoint"; runID: ID; reason: string }
    | { type: "verify"; taskID: ID; criteria: ID[] }
    | { type: "repair"; taskID: ID; failures: ID[] }
    | { type: "finish"; runID: ID; reason: string }
  )

export type ExecutorResult =
  | { type: "agent_completed"; agentID: string; output: unknown; evidenceIDs?: ID[] }
  | {
      type: "agent_failed"
      agentID: string
      code: string
      message: string
      outcomes?: readonly {
        status: "completed" | "failed"
        agentID: string
        output?: unknown
        code?: string
        message?: string
      }[]
    }
  | { type: "tool_completed"; tool: string; output: unknown; evidenceIDs?: ID[] }
  | { type: "approval_required"; requestID: ID }
  | { type: "input_required"; requestID: ID }
  | { type: "verification_completed"; verificationIDs: ID[] }
  | { type: "repair_required"; taskID: ID; failures: ID[] }
  | { type: "unknown"; operationID: ID; reason: string }

export type SuperAgentEvent = {
  eventID: ID
  protocolVersion: typeof SUPER_AGENT_EVENT_VERSION
  idempotencyKey: string
  runID: ID
  sequence: number
  type: string
  at: number
  payload: Record<string, unknown>
}

export type SuperAgentEventInput = Omit<
  SuperAgentEvent,
  "eventID" | "protocolVersion" | "sequence" | "idempotencyKey"
> &
  Partial<Pick<SuperAgentEvent, "eventID" | "idempotencyKey">>

export const TERMINAL_RUN_STATUSES: readonly SuperAgentRunStatus[] = ["cancelled", "failed", "completed"]

const transitions: Record<SuperAgentRunStatus, readonly SuperAgentRunStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["ready", "failed", "cancelled"],
  ready: ["running", "cancelled"],
  running: [
    "waiting_approval",
    "waiting_input",
    "waiting_external",
    "paused",
    "needs_review",
    "verifying",
    "cancelling",
    "failed",
  ],
  waiting_approval: ["running", "paused", "cancelled", "failed"],
  waiting_input: ["running", "paused", "cancelled", "failed"],
  waiting_external: ["running", "paused", "needs_review", "failed"],
  paused: ["running", "cancelled", "failed"],
  needs_review: ["running", "paused", "verifying", "failed", "cancelled"],
  verifying: ["completed", "failed", "needs_review"],
  cancelling: ["cancelled", "failed"],
  cancelled: [],
  failed: ["needs_review"],
  completed: [],
}

export function canTransitionRun(from: SuperAgentRunStatus, to: SuperAgentRunStatus) {
  return transitions[from].includes(to)
}

export function isTerminalRunStatus(status: SuperAgentRunStatus) {
  return TERMINAL_RUN_STATUSES.includes(status)
}
