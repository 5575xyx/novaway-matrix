import { For, Show, type Component } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Tag } from "@novaway/ui/tag"
import { useLanguage } from "@/context/language"
import { ExecutorAvatar } from "@/components/executor-avatar"
import { executorTheme } from "@/utils/executor-theme"

export type ExpertCardView = {
  id: string
  name: string
  role?: string
  category?: string
  description?: string
  capabilities?: string[]
  avatarUrl?: string
  available?: boolean
}

/** Compact catalog card: identity first, short pitch second, action last. */
export const ExpertCard: Component<{
  expert: ExpertCardView
  onClick?: () => void
  onStart?: () => void
  starting?: boolean
  startLabel?: string
  loadingLabel?: string
}> = (props) => {
  const language = useLanguage()
  const theme = () => executorTheme(props.expert.name)
  const content = () => (
    <>
      <div class="flex items-start gap-3">
        <div
          class="grid size-11 shrink-0 place-items-center rounded-full border-2 bg-surface shadow-sm"
          style={{ "border-color": theme().surface }}
        >
          <ExecutorAvatar
            kind="expert"
            name={props.expert.name}
            avatarUrl={props.expert.avatarUrl}
            class="size-9 rounded-full"
          />
        </div>
        <div class="min-w-0 flex-1 pt-0.5">
          <div class="flex items-center gap-1.5">
            <span class="truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">
              {props.expert.name}
            </span>
            <Show when={props.expert.available !== false}>
              <span
                class="size-1.5 shrink-0 rounded-full bg-surface-success-base"
                title={language.t("expertCenter.expert.available" as never)}
              />
            </Show>
          </div>
          <span class="mt-0.5 block truncate text-[11px] text-foreground-subtle">
            {props.expert.role || props.expert.category || language.t("expertCenter.expert.fallback" as never)}
          </span>
        </div>
        <Show when={props.expert.available === false}>
          <Tag>{language.t("expertCenter.expert.unavailable" as never)}</Tag>
        </Show>
      </div>
      <div class="mt-3 line-clamp-2 min-h-8 text-ui-xs leading-4 text-foreground-subtle">
        {props.expert.description || language.t("expertCenter.expert.ready" as never)}
      </div>
      <Show when={props.expert.capabilities?.length}>
        <div class="mt-3 flex min-h-6 flex-wrap items-center gap-1.5">
          <For each={props.expert.capabilities?.slice(0, 3)}>{(capability) => <Tag>{capability}</Tag>}</For>
        </div>
      </Show>
      <div class="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
        <span class="min-w-0 truncate text-[11px] text-foreground-subtlest">
          {props.expert.category || language.t("expertCenter.expert.ready" as never)}
        </span>
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
            disabled={props.expert.available === false || props.starting}
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
      style={{ "border-top-color": theme().accent }}
      data-executor-kind="expert"
      role={props.onClick ? "button" : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      onClick={props.onClick}
      onKeyDown={(event) => {
        // The card has a nested call-to-action. Keyboard activation on that button must not
        // also activate the card's details surface.
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
