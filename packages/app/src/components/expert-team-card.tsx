import { For, Show, type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"
import { ExecutorAvatar } from "@/components/executor-avatar"
import { executorTheme } from "@/utils/executor-theme"

export type ExpertTeamCardView = {
  id: string
  name: string
  description?: string
  capabilities: string[]
  memberCount: number
  memberPreview: Array<{ name: string; role: string }>
  autoEligible?: boolean
}

/** Compact expert-team card modeled after a capability marketplace rather than an admin table. */
export const ExpertTeamCard: Component<{
  team: ExpertTeamCardView
  selected?: boolean
  onClick?: () => void
  onStart?: () => void
  starting?: boolean
  startLabel?: string
  loadingLabel?: string
}> = (props) => {
  const language = useLanguage()
  const theme = () => executorTheme(props.team.name)
  const content = () => (
    <>
      <div class="flex items-start gap-3">
        <div
          class="grid size-11 shrink-0 place-items-center rounded-full border-2 bg-surface shadow-sm"
          style={{ "border-color": theme().surface }}
        >
          <ExecutorAvatar kind="team" name={props.team.name} class="size-9 rounded-full" />
        </div>
        <div class="min-w-0 flex-1 pt-0.5">
          <div class="flex items-center gap-1.5">
            <span class="truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">{props.team.name}</span>
            <Show when={props.team.autoEligible}>
              <span class="size-1.5 shrink-0 rounded-full" style={{ background: theme().accent }} />
            </Show>
          </div>
          <span class="mt-0.5 block truncate text-[11px] text-foreground-subtle">
            {language.t("expertCenter.team.memberCount" as never, { count: props.team.memberCount } as never)}
          </span>
        </div>
        <Show when={props.team.autoEligible}>
          <Tag>{language.t("expertCenter.team.auto" as never)}</Tag>
        </Show>
      </div>
      <div class="mt-3 line-clamp-2 min-h-8 text-ui-xs leading-4 text-foreground-subtle">
        {props.team.description || language.t("expertCenter.team.fallback" as never)}
      </div>
      <div class="mt-3 flex min-h-6 flex-wrap items-center gap-1.5">
        <For each={props.team.capabilities.slice(0, 3)}>{(capability) => <Tag>{capability}</Tag>}</For>
      </div>
      <div class="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
        <div class="flex min-w-0 items-center">
          <For each={props.team.memberPreview.slice(0, 3)}>
            {(member, index) => (
              <ExecutorAvatar
                kind="expert"
                name={member.name}
                alt=""
                title={member.role ? `${member.name} · ${member.role}` : member.name}
                class="size-6 rounded-full border-2 border-background"
                style={{ "margin-left": index() === 0 ? "0" : "-7px", "z-index": String(3 - index()) }}
              />
            )}
          </For>
          <span class="ml-2 truncate text-[11px] text-foreground-subtlest">
            {language.t("expertCenter.team.viewTeam" as never)}
          </span>
        </div>
        <Show
          when={props.onStart}
          fallback={
            <span class="shrink-0 text-[11px] font-medium" style={{ color: theme().accentStrong }}>
              {language.t("expertCenter.directory.start" as never)} →
            </span>
          }
        >
          <Button
            variant="primary"
            size="small"
            class="h-7 shrink-0 rounded-lg px-2.5 text-[11px]"
            disabled={props.starting}
            onClick={(event: MouseEvent) => {
              event.stopPropagation()
              props.onStart?.()
            }}
          >
            {props.starting ? props.loadingLabel : props.startLabel}
          </Button>
        </Show>
      </div>
    </>
  )

  const classes =
    "group w-full overflow-hidden rounded-2xl border border-border/80 border-t-2 bg-background/90 p-3 text-left shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-border-focus hover:shadow-md"
  return (
    <div
      class={classes}
      classList={{ "border-border-focus bg-surface shadow-lg": props.selected }}
      style={{ "border-top-color": theme().accent }}
      data-executor-kind="team"
      role={props.onClick ? "button" : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      onClick={props.onClick}
      onKeyDown={(event) => {
        // Keep keyboard activation of the nested start button from opening team details too.
        if (event.target !== event.currentTarget) return
        if (props.onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault()
          props.onClick()
        }
      }}
    >
      {content()}
    </div>
  )
}
