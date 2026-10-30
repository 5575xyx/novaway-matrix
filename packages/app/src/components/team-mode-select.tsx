import type { TeamSummaryView } from "@novaway/sdk/v2"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { Icon } from "@novaway/ui/icon"
import { createEffect, createMemo, createSignal, For, onMount, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { TeamSelection, TEAM_MODE_OFF, type TeamMode, type TeamSelectionValue } from "@/context/team-selection"

const sameIDs = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",")

/**
 * 输入框里的团队选择器（§4.2–4.3 的团队侧）。
 *
 * 写的是会话字段 `teamMode` / `teamIDs`，内核据此决定注入哪份团队目录、
 * `team_run` 接受谁；界面不另存一份「用户选了什么」，避免两侧漂移。
 *
 * 三个状态：
 * - 不选：不注入目录，`team_run` 拒绝派发；
 * - 指定：点名的团队可以直接派发；
 * - Auto：模型从 `autoEligible` 团队里自己挑，但**每次派发都要用户批准** ——
 *   这也是为什么 Auto 不是「自动执行」，而是「自动选人 + 人工放行」。
 *
 * 没有团队可选的目录不显示这个入口，footer 不该出现一个永远点不出东西的按钮。
 */
export const TeamModeSelect: Component<{ sessionID?: string }> = (props) => {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()

  const [teams, setTeams] = createSignal<TeamSummaryView[]>([])
  // 总控开关（§13.1）：关闭时入口整个隐藏，而不是点进去才发现派发不了。
  const [switchedOn, setSwitchedOn] = createSignal(true)
  const [optimistic, setOptimistic] = createSignal<TeamSelectionValue | undefined>(undefined)

  const info = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))

  /** 会话上真实的团队选择；新会话读待定槽位。 */
  const stored = createMemo<TeamSelectionValue>(() => {
    if (!props.sessionID) return TeamSelection.pending(sdk.directory) ?? TEAM_MODE_OFF
    const mode = (info()?.teamMode ?? "off") as TeamMode
    return { mode, teamIDs: [...(info()?.teamIDs ?? [])] }
  })

  // 内核值追上刚点的那一档后就把乐观值撤掉，避免它一直盖住真实值。
  createEffect(() => {
    const next = optimistic()
    const live = stored()
    if (next && next.mode === live.mode && sameIDs(next.teamIDs, live.teamIDs)) setOptimistic(undefined)
  })

  const current = () => optimistic() ?? stored()
  const selectedTeams = () => teams().filter((team) => current().teamIDs.includes(team.id))
  const autoTeams = () => teams().filter((team) => team.autoEligible)

  const label = () => {
    const value = current()
    if (value.mode === "auto") return language.t("team.mode.auto")
    if (value.mode === "selected") {
      const picked = selectedTeams()
      if (picked.length === 1) return picked[0].name
      if (picked.length > 1) return language.t("team.mode.selectedCount", { count: picked.length })
      return language.t("team.mode.selected")
    }
    return language.t("team.mode.off")
  }

  const active = () => current().mode !== "off"

  const apply = (next: TeamSelectionValue) => {
    if (!props.sessionID) {
      TeamSelection.setPending(sdk.directory, next)
      setOptimistic(undefined)
      return
    }
    setOptimistic(next)
    void sdk.client.session
      .update({
        directory: sdk.directory,
        sessionID: props.sessionID,
        teamMode: next.mode,
        // `off` / `auto` 不携带名单：内核会清空，避免切回来时带回已删团队。
        ...(next.mode === "selected" ? { teamIDs: next.teamIDs } : {}),
      })
      .catch(() => setOptimistic(undefined))
  }

  const toggleTeam = (team: TeamSummaryView) => {
    const picked = current().teamIDs
    const next = picked.includes(team.id) ? picked.filter((id) => id !== team.id) : [...picked, team.id]
    apply(next.length ? { mode: "selected", teamIDs: next } : TEAM_MODE_OFF)
  }

  onMount(() => {
    void sdk.client.team
      .list({ directory: sdk.directory })
      .then((result) => setTeams(result.data ?? []))
      .catch(() => setTeams([]))
    void sdk.client.kernel
      .capabilities({ directory: sdk.directory })
      .then((result) => {
        const feature = (result.data?.features ?? []).find((item) => item.id === "team_orchestration")
        // 老版本内核不报这一项：按开启处理，不因为版本落后就把入口藏掉。
        setSwitchedOn(feature ? feature.enabled : true)
      })
      .catch(() => setSwitchedOn(true))
  })

  return (
    <Show when={switchedOn() && (teams().length > 0 || active())}>
      <div data-component="team-mode-select" class="flex items-center gap-1.5">
        <DropdownMenu gutter={4} placement="top-end">
          <DropdownMenu.Trigger
            as="button"
            type="button"
            data-action="prompt-team-mode"
            class="flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-12-medium transition-colors hover:bg-hover"
            aria-label={language.t("team.mode.label")}
          >
            <Icon
              name="lu-users"
              size="small"
              class={`shrink-0 ${active() ? "text-icon-blue" : "text-foreground-subtle"}`}
            />
            <span
              data-slot="team-mode-label"
              class={`max-w-40 truncate ${active() ? "text-foreground" : "text-foreground-subtle"}`}
              style={{ "font-weight": "var(--font-weight-semibold)" }}
            >
              {label()}
            </span>
            <Icon name="chevron-down" size="small" class="shrink-0 text-foreground-subtle" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content style={{ "min-width": "288px" }}>
              <DropdownMenu.Item onSelect={() => apply(TEAM_MODE_OFF)}>
                <div class="flex w-full items-start gap-2.5">
                  <Icon name="lu-users" size="small" class="mt-0.5 shrink-0 text-foreground-subtle" />
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="text-13-medium text-foreground">{language.t("team.mode.off")}</span>
                    <span class="text-11-regular leading-4 text-foreground-subtle">
                      {language.t("team.mode.offDescription")}
                    </span>
                  </div>
                  <Show when={current().mode === "off"}>
                    <Icon name="check" size="small" class="mt-0.5 shrink-0 text-foreground" />
                  </Show>
                </div>
              </DropdownMenu.Item>
              <Show when={autoTeams().length > 0}>
                <DropdownMenu.Item onSelect={() => apply({ mode: "auto", teamIDs: [] })}>
                  <div class="flex w-full items-start gap-2.5">
                    <Icon name="lu-zap" size="small" class="mt-0.5 shrink-0 text-icon-blue" />
                    <div class="flex min-w-0 flex-1 flex-col">
                      <span class="text-13-medium text-foreground">{language.t("team.mode.auto")}</span>
                      <span class="text-11-regular leading-4 text-foreground-subtle">
                        {language.t("team.mode.autoDescription", { count: autoTeams().length })}
                      </span>
                    </div>
                    <Show when={current().mode === "auto"}>
                      <Icon name="check" size="small" class="mt-0.5 shrink-0 text-foreground" />
                    </Show>
                  </div>
                </DropdownMenu.Item>
              </Show>
              <div class="px-2 pt-1.5 pb-1 text-11-regular leading-4 text-foreground-subtlest">
                {language.t("team.mode.selectedHint")}
              </div>
              <For each={teams()}>
                {(team) => (
                  <DropdownMenu.Item onSelect={() => toggleTeam(team)}>
                    <div class="flex w-full items-start gap-2.5">
                      <Icon
                        name={current().teamIDs.includes(team.id) ? "check" : "lu-users"}
                        size="small"
                        class="mt-0.5 shrink-0 text-foreground-subtle"
                      />
                      <div class="flex min-w-0 flex-1 flex-col">
                        <span class="flex items-center gap-1.5 truncate text-13-medium text-foreground">
                          {team.name}
                          <Show when={team.autoEligible}>
                            <span class="rounded bg-surface px-1 py-px text-10-medium text-foreground-subtlest">
                              {language.t("team.mode.autoTag")}
                            </span>
                          </Show>
                        </span>
                        <span class="truncate text-11-regular leading-4 text-foreground-subtle">
                          {language.t("team.memberCount", { count: team.memberCount })}
                        </span>
                      </div>
                    </div>
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </Show>
  )
}
