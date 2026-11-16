import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"

export type OperationType = "install" | "update" | "rollback" | "enable" | "disable" | "uninstall" | "migrate"
export type OperationPhase =
  | "queued"
  | "downloading"
  | "staging"
  | "validating"
  | "replacing"
  | "activating"
  | "draining"
  | "cleanup-pending"
  | "completed"
  | "failed"

export type InstallationStatus = "absent" | "staging" | "validating" | "installed" | "updating" | "uninstalling" | "failed"
export type ActivationStatus =
  | "disabled"
  | "activating"
  | "active"
  | "draining"
  | "deactivating"
  | "disabled-pending-restart"
  | "failed"
  | "cleanup-pending"
export type ConsumerStatus = "undiscovered" | "discovered" | "registered" | "partially-registered" | "usable" | "unavailable"
export type CleanupStatus = "not-required" | "pending" | "completed" | "failed"
export type DisposeStatus = "not-required" | "pending" | "completed" | "failed"

export type Operation = {
  operationId: string
  operationType: OperationType
  packageId: string
  version?: string
  runtime?: string
  scope?: "global" | "project" | "session"
  phase: OperationPhase
  installationStatus: InstallationStatus
  activationStatus: ActivationStatus
  consumerStatus: ConsumerStatus
  cleanupStatus: CleanupStatus
  disposeStatus: DisposeStatus
  requiresRestart: boolean
  startedAt: number
  finishedAt?: number
  progress: number
  errorCode?: string
  recoveryHint?: string
}

type Stored = { version: 1; operations: Operation[] }
const FILE = "marketplace-operations.json"
const MAX_OPERATIONS = 100

function file(data = Global.Path.data) {
  return path.join(data, FILE)
}

async function read(data = Global.Path.data): Promise<Operation[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file(data), "utf8")) as Stored
    if (parsed?.version !== 1 || !Array.isArray(parsed.operations)) return []
    return parsed.operations
      .filter((item): item is Operation => !!item && typeof item.operationId === "string")
      .map((item) => ({
        ...item,
        requiresRestart: item.requiresRestart ?? false,
        ...stateFor({
          operationType: item.operationType,
          phase: item.phase,
          requiresRestart: item.requiresRestart ?? false,
        }),
      }))
  } catch {
    return []
  }
}

async function write(operations: Operation[], data = Global.Path.data) {
  await fs.mkdir(data, { recursive: true })
  const target = file(data)
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(temporary, JSON.stringify({ version: 1, operations } satisfies Stored, null, 2), "utf8")
  await fs.rename(temporary, target).catch(async (error) => {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
}

export type StartInput = Pick<Operation, "operationType" | "packageId"> &
  Partial<Pick<Operation, "version" | "runtime" | "scope" | "requiresRestart">>

function stateFor(operation: Pick<Operation, "operationType" | "phase" | "requiresRestart">) {
  if (operation.phase === "failed") {
    return {
      installationStatus: (operation.operationType === "uninstall" ? "installed" : "failed") as InstallationStatus,
      activationStatus: "failed" as ActivationStatus,
      consumerStatus: "unavailable" as ConsumerStatus,
      cleanupStatus: "failed" as CleanupStatus,
      disposeStatus: "failed" as DisposeStatus,
    }
  }
  if (operation.phase === "completed") {
    const removed = operation.operationType === "uninstall"
    const disabled = operation.operationType === "disable"
    return {
      installationStatus: (removed ? "absent" : "installed") as InstallationStatus,
      activationStatus: (operation.requiresRestart ? "disabled-pending-restart" : disabled || removed ? "disabled" : "active") as ActivationStatus,
      consumerStatus: (disabled || removed || operation.requiresRestart ? "undiscovered" : "usable") as ConsumerStatus,
      cleanupStatus: "completed" as CleanupStatus,
      disposeStatus: "completed" as DisposeStatus,
    }
  }
  if (operation.phase === "draining") {
    return {
      installationStatus: (operation.operationType === "uninstall" ? "uninstalling" : "updating") as InstallationStatus,
      activationStatus: "draining" as ActivationStatus,
      consumerStatus: "registered" as ConsumerStatus,
      cleanupStatus: "pending" as CleanupStatus,
      disposeStatus: "pending" as DisposeStatus,
    }
  }
  if (operation.phase === "cleanup-pending") {
    return {
      installationStatus: (operation.operationType === "uninstall" ? "uninstalling" : "updating") as InstallationStatus,
      activationStatus: "cleanup-pending" as ActivationStatus,
      consumerStatus: "discovered" as ConsumerStatus,
      cleanupStatus: "pending" as CleanupStatus,
      disposeStatus: "pending" as DisposeStatus,
    }
  }
  if (operation.phase === "activating") {
    return {
      installationStatus: (operation.operationType === "uninstall" ? "uninstalling" : "installed") as InstallationStatus,
      activationStatus: "activating" as ActivationStatus,
      consumerStatus: "discovered" as ConsumerStatus,
      cleanupStatus: "not-required" as CleanupStatus,
      disposeStatus: "not-required" as DisposeStatus,
    }
  }
  if (operation.phase === "replacing") {
    return {
      installationStatus: (operation.operationType === "uninstall" ? "uninstalling" : "updating") as InstallationStatus,
      activationStatus: "deactivating" as ActivationStatus,
      consumerStatus: "partially-registered" as ConsumerStatus,
      cleanupStatus: "pending" as CleanupStatus,
      disposeStatus: "pending" as DisposeStatus,
    }
  }
  if (operation.phase === "validating") {
    return {
      installationStatus: "validating" as InstallationStatus,
      activationStatus: "deactivating" as ActivationStatus,
      consumerStatus: "undiscovered" as ConsumerStatus,
      cleanupStatus: "not-required" as CleanupStatus,
      disposeStatus: "not-required" as DisposeStatus,
    }
  }
  return {
    installationStatus: (operation.phase === "queued" ? "absent" : "staging") as InstallationStatus,
    activationStatus: "disabled" as ActivationStatus,
    consumerStatus: "undiscovered" as ConsumerStatus,
    cleanupStatus: "not-required" as CleanupStatus,
    disposeStatus: "not-required" as DisposeStatus,
  }
}

export async function start(input: StartInput, data = Global.Path.data): Promise<Operation> {
  const operation: Operation = {
    operationId: randomUUID(),
    ...input,
    phase: "queued",
    ...stateFor({ operationType: input.operationType, phase: "queued", requiresRestart: input.requiresRestart ?? false }),
    requiresRestart: input.requiresRestart ?? false,
    startedAt: Date.now(),
    progress: 0,
  }
  const operations = await read(data)
  await write([...operations, operation].slice(-MAX_OPERATIONS), data)
  return operation
}

export async function update(
  operationId: string,
  patch: Partial<Pick<Operation, "phase" | "progress" | "finishedAt" | "errorCode" | "recoveryHint" | "installationStatus" | "activationStatus" | "consumerStatus" | "cleanupStatus" | "disposeStatus" | "requiresRestart">>,
  data = Global.Path.data,
): Promise<Operation | undefined> {
  const operations = await read(data)
  const index = operations.findIndex((item) => item.operationId === operationId)
  if (index < 0) return undefined
  const current = operations[index]!
  const nextPhase = patch.phase ?? current.phase
  const next: Operation = {
    ...current,
    phase: nextPhase,
    ...stateFor({
      operationType: current.operationType,
      phase: nextPhase,
      requiresRestart: patch.requiresRestart ?? current.requiresRestart,
    }),
    ...patch,
  }
  if ((next.phase === "completed" || next.phase === "failed") && next.finishedAt === undefined) {
    next.finishedAt = Date.now()
  }
  operations[index] = next
  await write(operations, data)
  return next
}

export async function get(operationId: string, data = Global.Path.data) {
  return (await read(data)).find((item) => item.operationId === operationId)
}

export async function list(data = Global.Path.data) {
  return read(data)
}

/** Mark operations left mid-flight by a process crash as failed and recoverable. */
export async function recover(data = Global.Path.data) {
  const operations = await read(data)
  let changed = false
  const next = operations.map((operation) => {
    if (operation.phase === "completed" || operation.phase === "failed") return operation
    changed = true
    return {
      ...operation,
      phase: "failed" as const,
      finishedAt: Date.now(),
      progress: Math.min(operation.progress, 99),
      errorCode: "MARKETPLACE_OPERATION_INTERRUPTED",
      recoveryHint: "操作在进程退出时中断；请检查当前安装并重试，历史备份不会自动删除。",
    }
  })
  if (changed) await write(next, data)
  return next
}
