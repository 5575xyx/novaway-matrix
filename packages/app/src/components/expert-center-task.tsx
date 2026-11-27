import { Show, type Component, type JSX } from "solid-js"
import type { RunView } from "@novaway/sdk/v2"
import { TaskReport } from "@/components/task-report"
import { TaskStageBar } from "@/components/task-stage-bar"
import { taskPhase } from "@/components/expert-center.logic"

/** User-facing task detail shell. Technical execution remains a child detail surface. */
export const ExpertCenterTask: Component<{
  run?: RunView
  report?: {
    summary?: string
    verification?: {
      status: "pending" | "verified" | "partial" | "failed"
      passed: number
      failed: number
      unverified: number
      stale: number
    }
    changeCount?: number
  }
  children: JSX.Element
}> = (props) => (
  <>
    <Show when={props.run}>
      {(run) => (
        <>
          <TaskStageBar phase={taskPhase(run())} />
          <TaskReport
            goal={run().goal}
            state={String(run().state)}
            phase={run().phase}
            summary={props.report?.summary}
            verification={props.report?.verification}
            changeCount={props.report?.changeCount}
          />
        </>
      )}
    </Show>
    {props.children}
  </>
)
