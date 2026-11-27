import { Show, type Component } from "solid-js"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"

export const TaskReport: Component<{
  goal: string
  state: string
  phase?: string | null
  artifactCount?: number
  summary?: string
  verification?: {
    status: "pending" | "verified" | "partial" | "failed"
    passed: number
    failed: number
    unverified: number
    stale: number
  }
  changeCount?: number
}> = (props) => {
  const language = useLanguage()
  const finished = () => ["done", "partial", "failed", "exceeded", "cancelled"].includes(props.state)
  const verified = () => props.verification?.status === "verified" || props.state === "done"
  const stateLabel = () => language.t(`run.state.${props.state}` as never)
  const verificationLabel = () => {
    if (props.verification?.status === "verified") return language.t("taskReport.verified" as never)
    if (props.verification?.status === "failed") return language.t("taskReport.verificationFailed" as never)
    if (props.verification?.status === "partial") return language.t("taskReport.verificationPartial" as never)
    return language.t("taskReport.pending" as never)
  }

  return (
    <Show when={finished()}>
      <section class="shrink-0 border-b border-border bg-background px-4 py-3" aria-label={language.t("taskReport.title" as never)}>
        <div class="mb-2 flex items-center gap-2">
          <span class="text-ui-sm font-medium text-foreground">{language.t("taskReport.title" as never)}</span>
          <Tag class={verified() ? "text-success-base" : "text-warning-base"}>{stateLabel()}</Tag>
        </div>
        <div class="grid gap-2 md:grid-cols-3">
          <div class="rounded-lg border border-border px-3 py-2">
            <div class="text-ui-xs text-foreground-subtle">{language.t("taskReport.summary" as never)}</div>
            <div class="mt-1 line-clamp-2 text-ui-xs text-foreground">{props.summary || props.goal}</div>
          </div>
          <div class="rounded-lg border border-border px-3 py-2">
            <div class="text-ui-xs text-foreground-subtle">{language.t("taskReport.verification" as never)}</div>
            <div class="mt-1 text-ui-xs" classList={{ "text-success-base": verified(), "text-warning-base": !verified() }}>
              {verificationLabel()}
              <Show when={props.verification}>
                {(verification) => (
                  <span class="ml-1 text-foreground-subtlest">
                    ({verification().passed}/{verification().passed + verification().failed + verification().unverified + verification().stale})
                  </span>
                )}
              </Show>
            </div>
          </div>
          <div class="rounded-lg border border-border px-3 py-2">
            <div class="text-ui-xs text-foreground-subtle">{language.t("taskReport.changes" as never)}</div>
            <div class="mt-1 text-ui-xs text-foreground">
              {language.t("taskReport.artifacts", { count: String(props.changeCount ?? props.artifactCount ?? 0) } as never)}
            </div>
          </div>
        </div>
      </section>
    </Show>
  )
}
