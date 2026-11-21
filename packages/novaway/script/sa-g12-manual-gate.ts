import { readFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const recordPath = path.resolve(root, process.env.SA_G12_RECORD ?? "test-results/sa-g12-manual-release.json")
const requiredScenarios = [
  "goal_and_acceptance_criteria",
  "dangerous_operation_approval",
  "timeline_and_task_graph_order",
  "pause_refresh_resume",
  "offline_online_recovery",
  "backend_restart_recovery",
  "parallel_agent_partial_failure",
  "plugin_disable_blocks_calls",
  "verification_repair_evidence_completion",
  "secret_token_redaction",
  "timer_listener_child_process_cleanup",
  "provider_judge_and_agent_verifier",
] as const

type Scenario = { observed?: boolean; notes?: string; evidence?: string[] }
type RecordShape = {
  version?: string
  releaseCandidate?: { binary?: string; sha256?: string }
  environment?: { operator?: string; browser?: string; backendPort?: number; uiPort?: number; database?: string; workspace?: string }
  scenarios?: Partial<Record<(typeof requiredScenarios)[number], Scenario>>
  operator?: { name?: string; signature?: string; signedAt?: string; conclusion?: string }
  reviewer?: { name?: string; signature?: string; signedAt?: string; conclusion?: string }
}

const fail = (messages: string[]): never => {
  console.error("SA-G12_MANUAL_ACCEPTANCE=FAIL")
  for (const message of messages) console.error(`- ${message}`)
  process.exit(1)
}

let record: RecordShape | undefined
try {
  record = JSON.parse(await readFile(recordPath, "utf8")) as RecordShape
} catch {
  fail([`manual record not found or invalid JSON: ${path.relative(root, recordPath)}`])
}
if (!record) fail([`manual record not found or invalid JSON: ${path.relative(root, recordPath)}`])
const parsedRecord = record!

const errors: string[] = []
if (!parsedRecord.version) errors.push("release candidate version is required")
if (!parsedRecord.releaseCandidate?.binary) errors.push("release candidate binary is required")
if (!parsedRecord.releaseCandidate?.sha256) errors.push("release candidate SHA-256 is required")
if (!parsedRecord.environment?.operator) errors.push("environment.operator is required")
if (!parsedRecord.environment?.browser) errors.push("environment.browser is required")
if (!parsedRecord.environment?.database) errors.push("environment.database is required")
for (const scenario of requiredScenarios) {
  const item = parsedRecord.scenarios?.[scenario]
  if (!item?.observed) errors.push(`${scenario}: observed=true is required`)
  if (!item?.notes?.trim()) errors.push(`${scenario}: real observation notes are required`)
  if (!item?.evidence?.length) errors.push(`${scenario}: screenshot, recording, or log evidence is required`)
}
for (const [role, value] of [["operator", parsedRecord.operator], ["reviewer", parsedRecord.reviewer]] as const) {
  if (!value?.name?.trim()) errors.push(`${role}.name is required`)
  if (!value?.signature?.trim()) errors.push(`${role}.signature is required`)
  if (!value?.signedAt?.trim()) errors.push(`${role}.signedAt is required`)
  if (value?.conclusion !== "pass") errors.push(`${role}.conclusion must be pass`)
}
if (errors.length > 0) fail(errors)
console.log("SA-G12_MANUAL_ACCEPTANCE=PASS")
console.log(`SA_G12_RECORD=${path.relative(root, recordPath).replaceAll("\\", "/")}`)
