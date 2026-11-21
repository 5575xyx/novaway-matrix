import { createHash } from "node:crypto"
import { generateObject } from "ai"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Schema } from "effect"
import type { GoalPlanTask, SuperAgentRun, TaskGraph } from "./types"
import { nextTaskGraph } from "./graph"

const ModelPlanTask = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  objective: Schema.String,
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  tool: Schema.optional(Schema.String),
  evidenceKind: Schema.optional(
    Schema.Literals(["test", "file", "http", "screenshot", "log", "artifact", "human", "external"]),
  ),
  input: Schema.optional(Schema.Unknown),
})

const ModelPlan = Schema.Struct({
  tasks: Schema.Array(ModelPlanTask),
})

type ModelPlanValue = Schema.Schema.Type<typeof ModelPlan>

function taskID(runID: string, index: number, key: string) {
  const safe = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return `${runID}:plan:${index}:${safe || "task"}`
}

/**
 * Model-backed planner for explicit unattended runs. The model may describe
 * work, but it can only request tools from the allow-list supplied by the
 * host. Tool execution still goes through Permission and the native executor.
 */
export async function planGoalWithModel(input: {
  model: LanguageModelV3
  run: SuperAgentRun
  availableTools: readonly string[]
  reason?: string
}): Promise<GoalPlanTask[]> {
  const response = await generateObject({
    model: input.model,
    temperature: 0,
    maxOutputTokens: 4_000,
    schema: Object.assign(Schema.toStandardSchemaV1(ModelPlan), Schema.toStandardJSONSchemaV1(ModelPlan)),
    prompt: [
      "You are the durable task planner for NovaWay.",
      "Convert the Goal into a small executable task graph.",
      "Every task must be independently reviewable and have a precise objective.",
      "Use dependencies only when a task truly needs another task's output.",
      "Every task must be executable with one of the available tools; do not return abstract or checkpoint-only tasks.",
      "For a verification task, set evidenceKind to test only when the selected tool returns a real exit code; never use evidenceKind to pretend an ordinary tool call passed.",
      "Assign the final verification work to the Goal acceptance criteria; if no executable verifier is available, leave the run for review rather than claiming completion.",
      "Never invent a tool. For executable work, tool must be one of the available tools.",
      `Available tools: ${input.availableTools.join(", ") || "none"}`,
      `Goal: ${input.run.goal.text}`,
      `Constraints: ${input.run.goal.constraints.join("; ") || "none"}`,
      `Acceptance criteria: ${input.run.goal.acceptanceCriteria.map((item) => `${item.id}: ${item.text}`).join("; ") || "none"}`,
      ...(input.reason ? [`Re-plan reason: ${input.reason}`] : []),
      "Return 1 to 32 tasks. Use key values that are unique within the plan.",
    ].join("\n"),
  })

  const seen = new Set<string>()
  const keyToID = new Map<string, string>()
  for (const [index, item] of response.object.tasks.entries()) {
    const key = item.key.trim()
    if (!key || seen.has(key)) throw new Error(`planner returned duplicate or empty task key: ${key || "<empty>"}`)
    seen.add(key)
    keyToID.set(key, taskID(input.run.id, index, key))
  }

  return response.object.tasks.map((item, index) => {
    const id = keyToID.get(item.key.trim())!
    const dependencies = (item.dependencies ?? []).map((dependency) => {
      const resolved = keyToID.get(dependency.trim())
      if (!resolved) throw new Error(`planner task ${item.key} depends on unknown task ${dependency}`)
      return resolved
    })
    const tool = item.tool?.trim()
    if (!tool) throw new Error(`planner returned a non-executable task: ${item.key}`)
    if (!input.availableTools.includes(tool)) throw new Error(`planner requested unavailable tool: ${tool}`)
    return {
      id,
      kind: "tool",
      title: item.title.trim(),
      objective: item.objective.trim(),
      dependencies,
      ...(tool
        ? {
            input: {
              tool,
              input: item.input,
              ...(item.evidenceKind ? { evidenceKind: item.evidenceKind } : {}),
            },
          }
        : {}),
      acceptanceCriteria: [],
      retryPolicy: { maxAttempts: 1, backoffMs: 0, retryable: false },
    }
  })
}

/** Materializes a validated model plan into the run's durable graph. */
export function materializeGoalPlan(run: SuperAgentRun, plan: readonly GoalPlanTask[]): TaskGraph {
  if (plan.length === 0 || plan.length > 32) throw new Error("planner must return between 1 and 32 tasks")
  const planHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex")
  const materialized = plan.map((item, index) => ({
    ...item,
    // If the planner did not assign criterion ownership, the final task is
    // the only safe default owner. This prevents an arbitrary intermediate
    // tool result from satisfying the whole Goal while still allowing a
    // planner to return finer-grained criterion assignments explicitly.
    acceptanceCriteria:
      item.acceptanceCriteria?.length || index !== plan.length - 1
        ? [...(item.acceptanceCriteria ?? [])]
        : [...run.goal.acceptanceCriteria],
  }))
  const replacement: TaskGraph = {
    ...run.graph,
    version: run.graph.version,
    nodes: materialized.map((item) => ({
      id: item.id,
      graphID: run.graph.id,
      kind: item.kind,
      title: item.title,
      objective: item.objective,
      status: "pending" as const,
      dependencies: [...(item.dependencies ?? [])],
      ...(item.input === undefined && item.evidenceKind === undefined
        ? {}
        : {
            input:
              item.evidenceKind === undefined
                ? item.input
                : {
                    ...(item.input && typeof item.input === "object" && !Array.isArray(item.input)
                      ? (item.input as Record<string, unknown>)
                      : item.input === undefined
                        ? {}
                        : { value: item.input }),
                    evidenceKind: item.evidenceKind,
                  },
          }),
      acceptanceCriteria: [...(item.acceptanceCriteria ?? [])],
      retryPolicy: item.retryPolicy ?? { maxAttempts: 1, backoffMs: 0, retryable: false },
      attempts: 0,
      evidenceIDs: [],
      verificationIDs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
    edges: plan.flatMap((item) =>
      (item.dependencies ?? []).map((dependency) => ({
        from: item.id,
        to: dependency,
        kind: "depends_on" as const,
      })),
    ),
    rootTaskID: plan[0]!.id,
    planHash,
  }
  return nextTaskGraph(run.graph, replacement, run.graph.version)
}
