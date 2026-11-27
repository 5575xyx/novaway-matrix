import { createHash } from "node:crypto"
import type { RosterEntry } from "./profile"
import { instructions } from "./effective"

/**
 * The immutable coordinates of one employee dispatch.
 *
 * A TeamRun is the product-level run, while this identity is the execution-level
 * attempt. It is deliberately carried into the prompt and the operation scope so
 * a late worker report cannot be mistaken for a newer retry.
 */
export type AssignmentIdentity = {
  assignmentID: string
  dispatchID: string
  runID: string
  taskID: string
  attempt: number
  employeeID?: string
}

export type SkillSnapshot = {
  name: string
  version: string
  contentHash: string
  requiredTools?: string[]
  permissionRequirements?: string[]
  outputContract?: unknown
  compatibility?: string
}

export type EmployeePromptInput = {
  entry?: RosterEntry
  prompt: string
  assignment: AssignmentIdentity
  worktree?: string
  readOnly?: boolean
  permissionSnapshot?: unknown
  skillManifest?: readonly SkillSnapshot[]
}

export type EmployeePromptManifest = AssignmentIdentity & {
  agent: string
  promptHash: string
  skillManifestHash: string
  skillManifest: SkillSnapshot[]
  permissionHash: string
  worktree?: string
  readOnly: boolean
}

export type EmployeePrompt = {
  prompt: string
  manifest: EmployeePromptManifest
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]"
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => JSON.stringify(key) + ":" + stable(item))
      .join(",") +
    "}"
  )
}

function hash(value: unknown): string {
  return "sha256:" + createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex").slice(0, 32)
}

/**
 * Build the same dispatch contract for HTTP TeamRun, ordinary task workers and
 * workflow callers. The task text remains caller-owned; the identity and safety
 * rules are platform-owned and always present.
 */
export function build(input: EmployeePromptInput): EmployeePrompt {
  const entry = input.entry
  const employee = entry?.employee
  const skills =
    input.skillManifest?.map((skill) => ({ ...skill })) ??
    [...(employee?.skills ?? [])]
      .map((name) => name.trim())
      .filter(Boolean)
      .sort()
      .map((name) => ({ name, version: "unresolved", contentHash: hash(name) }))
  const readOnly = input.readOnly ?? true
  const role = entry ? instructions(entry) : undefined
  const prompt = [
    "You are a dispatched AI employee inside NovaWay.",
    "This is one bounded assignment. Do not silently take ownership of another assignment.",
    "",
    "## DISPATCH CONTRACT",
    `Assignment ID: ${input.assignment.assignmentID}`,
    `Dispatch ID: ${input.assignment.dispatchID}`,
    `Run ID: ${input.assignment.runID}`,
    `Task ID: ${input.assignment.taskID}`,
    `Attempt: ${input.assignment.attempt}`,
    ...(input.assignment.employeeID ? [`Employee ID: ${input.assignment.employeeID}`] : []),
    `Workspace: ${input.worktree ? "dedicated worktree" : "assigned workspace"}`,
    `Write policy: ${readOnly ? "read-only" : "write allowed within the assigned scope"}`,
    "Only act within this assignment. Do not spawn another worker unless the caller explicitly grants that capability.",
    "Do not declare success from intention or an unverified artifact. Report concrete evidence and blockers.",
    "",
    ...(role ? [role, ""] : []),
    "## ASSIGNMENT",
    input.prompt.trim(),
    "",
    "## COMPLETION",
    "When this assignment is complete, report once with the assignment and dispatch IDs, a concise outcome, evidence, and any remaining blocker. Do not continue polling after reporting.",
  ].join("\n")

  return {
    prompt,
    manifest: {
      ...input.assignment,
      agent: employee?.job ?? "default",
      promptHash: hash(prompt),
      skillManifestHash: hash(skills),
      skillManifest: skills,
      permissionHash: hash(input.permissionSnapshot ?? { readOnly }),
      ...(input.worktree ? { worktree: input.worktree } : {}),
      readOnly,
    },
  }
}

export function contentHash(value: unknown) {
  return hash(value)
}

export function assignmentID(input: { runID: string; taskID: string; attempt: number; discriminator: string }) {
  return [input.runID, input.taskID, input.attempt, input.discriminator].join(":")
}

export function dispatchID(assignment: string) {
  return "dispatch:" + assignment
}

export * as EmployeePromptAssembler from "./employee-prompt"
