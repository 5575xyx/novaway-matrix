import type { ArtifactSnapshot } from "./bridge-schema"
import type {
  WorkflowAction,
  WorkflowEvent,
  WorkflowLevel,
  WorkflowPhase,
  WorkflowSnapshot,
  WorkflowStatus,
} from "./workflow-schema"

const artifactPhase: Record<ArtifactSnapshot["phase"], WorkflowPhase> = {
  needs_proposal: "needs_specification",
  needs_spec: "needs_specification",
  needs_design: "needs_design",
  needs_plan: "needs_plan",
  implementing: "implementing",
  needs_traceability: "needs_traceability",
  needs_delivery_config: "needs_delivery_config",
  ready_to_verify: "ready_to_verify",
  ready_to_archive: "ready_to_archive",
  completed: "completed",
}

const labels: Record<string, string> = {
  classify: "确认需求等级",
  clarify: "补充必要信息",
  create_artifacts: "创建规格工件",
  approve_design: "确认设计",
  create_plan: "创建实施计划",
  start_implementation: "开始实施",
  reconcile_tasks: "同步任务状态",
  configure_delivery: "配置交付验证",
  verify: "运行本地验证",
  repair: "修复失败步骤",
  archive: "归档交付成果",
  resume: "继续工作流",
}

const userAuthority = new Set(["approve_design", "start_implementation", "configure_delivery", "archive"])

export function nextAction(action: string | null): WorkflowAction | undefined {
  if (!action) return undefined
  const requiresAuthority = userAuthority.has(action) ? ("user" as const) : undefined
  return {
    action,
    label: labels[action] ?? action,
    automatic: !requiresAuthority,
    ...(requiresAuthority ? { requiresAuthority } : {}),
  }
}

export function aggregateArtifact(
  artifact: ArtifactSnapshot,
  binding: {
    id: string
    projectID: string
    projectRoot: string
    worktree: string
    powersnexusDigest: string
    level?: WorkflowLevel
    profile?: "application" | "library" | "web"
  },
): WorkflowSnapshot {
  const classifiedLevel = artifact.level ?? binding.level
  const level = classifiedLevel ?? "L2"
  const blocked = artifact.blockers.length > 0 || artifact.status === "blocked"
  const phase = blocked ? "blocked" : classifiedLevel ? artifactPhase[artifact.phase] : "needs_classification"
  const status: WorkflowStatus = blocked
    ? "blocked"
    : artifact.status === "completed"
      ? "completed"
      : artifact.status === "running"
        ? "running"
        : "idle"
  return {
    protocolVersion: "1.0",
    powersnexusVersion: artifact.powersnexusVersion,
    powersnexusDigest: binding.powersnexusDigest,
    bindingID: binding.id,
    projectID: binding.projectID,
    projectRoot: binding.projectRoot,
    worktree: binding.worktree,
    changeName: artifact.changeName,
    ...(binding.profile ? { profile: binding.profile } : {}),
    level,
    phase,
    status,
    revision: artifact.revision,
    artifactDigest: artifact.artifactDigest,
    requirements: artifact.requirements.map((requirement) => ({
      ...requirement,
      status: artifact.phase === "completed" ? "verified" : "planned",
      implementationFiles: [],
      testFiles: [],
    })),
    tasks: artifact.tasks.map((task) => ({
      ...task,
      requirementIDs: [],
      status: task.status,
      dependsOn: [],
    })),
    ...(artifact.delivery
      ? {
          delivery: {
            profile:
              typeof artifact.delivery.profile === "string"
                ? artifact.delivery.profile
                : (binding.profile ?? "application"),
            status: artifact.phase === "ready_to_archive" || artifact.phase === "completed" ? "passed" : "ready",
            ...(typeof artifact.delivery.verifiedAt === "string"
              ? { verifiedAt: artifact.delivery.verifiedAt }
              : {}),
            ...(typeof artifact.delivery.fingerprint === "string"
              ? { fingerprint: artifact.delivery.fingerprint }
              : {}),
          } as const,
        }
      : {}),
    ...(nextAction(artifact.nextAction) ? { nextAction: nextAction(artifact.nextAction) } : {}),
    blockers: artifact.blockers,
    updatedAt: artifact.updatedAt,
  }
}

export function transition(phase: WorkflowPhase, event: WorkflowEvent, level: WorkflowLevel = "L2"): WorkflowPhase {
  if (event === "unrecoverable.error") return "blocked"
  if (phase === "uninitialized" && event === "user.requirement") return "needs_classification"
  if (phase === "needs_classification" && event === "clarification.required") return "needs_clarification"
  if (phase === "needs_clarification" && event === "clarification.completed") return "needs_classification"
  if (phase === "needs_classification" && event === "classification.completed") {
    return level === "L0" || level === "L1" ? "ready_to_implement" : "needs_specification"
  }
  if (phase === "needs_specification" && event === "artifacts.valid") return "needs_design"
  if (phase === "needs_design" && event === "design.valid") return "needs_plan"
  if (phase === "needs_plan" && event === "plan.valid") return "ready_to_implement"
  if (phase === "ready_to_implement" && event === "authorization.local") return "implementing"
  if (phase === "implementing" && event === "tasks.completed") return "needs_traceability"
  if (phase === "needs_traceability" && event === "trace.valid") return "needs_delivery_config"
  if (phase === "needs_delivery_config" && event === "delivery.configured") return "ready_to_verify"
  if (phase === "ready_to_verify" && event === "verify.started") return "verifying"
  if (phase === "verifying" && event === "step.failed") return "repairing"
  if (phase === "repairing" && event === "patch.completed") return "ready_to_verify"
  if (phase === "verifying" && event === "delivery.passed") return "ready_to_archive"
  if (phase === "ready_to_archive" && event === "archive.approved") return "archiving"
  if (phase === "archiving" && event === "archive.completed") return "completed"
  return phase
}

export * as PowersNexusState from "./state"
