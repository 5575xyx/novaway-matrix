import { lazy } from "solid-js"

export {
  mergeWorkflowState,
  patchFrom,
  readWorkflowState,
  updateWorkflowState,
  type WorkflowConflict,
  type WorkflowState,
  type WorkflowStatePatch,
} from "./workflow-status-state"

// Keep the state helpers importable in the SSR/unit-test environment. The header UI
// uses client-only router/popover primitives, so load that view only when rendered.
export const WorkflowStatus = lazy(() => import("./workflow-status-view").then(({ WorkflowStatus }) => ({ default: WorkflowStatus })))
