import { For, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import type { ExpertCenterTaskPhase } from "./expert-center.logic"
import { taskPhaseLabelKey } from "./expert-center.logic"

const phases: ExpertCenterTaskPhase[] = ["understanding", "planning", "working", "reviewing", "delivering"]

export const TaskStageBar: Component<{ phase: ExpertCenterTaskPhase }> = (props) => {
  const language = useLanguage()
  const current = () => phases.indexOf(props.phase)

  return (
    <div class="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2 text-ui-xs" aria-label={language.t(taskPhaseLabelKey(props.phase) as never)}>
      <For each={phases}>
        {(phase, index) => (
          <>
            <div
              class="flex items-center gap-1 rounded-md px-1.5 py-1"
              classList={{
                "bg-surface text-foreground": index() === current(),
                "text-success-base": index() < current(),
                "text-foreground-subtlest": index() > current(),
              }}
            >
              <span class="flex size-4 items-center justify-center rounded-full border border-current text-[10px]">
                {index() < current() ? "✓" : index() + 1}
              </span>
              <span class="hidden md:inline">{language.t(taskPhaseLabelKey(phase) as never)}</span>
            </div>
            {index() < phases.length - 1 ? <span class="text-foreground-subtlest">›</span> : null}
          </>
        )}
      </For>
    </div>
  )
}
