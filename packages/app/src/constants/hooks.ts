/**
 * Hook events the kernel understands. Mirrors `src/hook/schema.ts` (EVENTS) so
 * the settings page can explain every event even when nobody listens to it —
 * a hook that silently never fires is worse than one that is visibly unused.
 * Keep the order identical to the kernel list.
 */
export const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "SessionDelete",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "Stop",
  "StopFailure",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "PermissionRequest",
  "PermissionDenied",
  "Elicitation",
  "ElicitationResult",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "Notification",
  "MessageDisplay",
  "TaskCreated",
  "TaskCompleted",
  "TodoCreated",
  "TodoCompleted",
  "TeammateIdle",
  "InstructionsLoaded",
  "FileChanged",
  "CwdChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "ConfigChange",
] as const
