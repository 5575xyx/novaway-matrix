import type { TeamEmployeeView, TeamProfileView, TeamSummaryView } from "@novaway/sdk/v2"
import { DropdownMenu } from "@novaway/ui/dropdown-menu"
import { HoverCard } from "@novaway/ui/hover-card"
import { Icon } from "@novaway/ui/icon"
import { createEffect, createMemo, createSignal, For, onMount, Show, type Component, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { TeamSelection, TEAM_MODE_OFF, type TeamMode, type TeamSelectionValue } from "@/context/team-selection"
import { ExecutorAvatar } from "@/components/executor-avatar"

const sameIDs = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",")

/**
 * 输入框里的团队选择器（§4.2–4.3 的团队侧）。
 *
 * 写的是会话字段 `teamMode` / `teamIDs`，内核据此决定注入哪份团队目录、
 * `team_run` 接受谁；界面不另存一份「用户选了什么」，避免两侧漂移。
 *
 * 三个状态：
 * - 不选：用户明确要求主助手直接处理；
 * - 指定：点名的团队或专家可以直接派发；
 * - Auto：主助手按任务需要自行选择专家团队，低风险只读派发自动继续，涉及写入或
 *   外部副作用时才要求用户批准。
 * 没有团队可选的目录不显示这个入口，footer 不该出现一个永远点不出东西的按钮。
 */
export const TeamModeSelect: Component<{ sessionID?: string }> = (props) => {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()

  const [teams, setTeams] = createSignal<TeamSummaryView[]>([])
  const [employees, setEmployees] = createSignal<TeamEmployeeView[]>([])
  const [profiles, setProfiles] = createSignal<TeamProfileView[]>([])
  // 总控开关（§13.1）：关闭时入口整个隐藏，而不是点进去才发现派发不了。
  const [switchedOn, setSwitchedOn] = createSignal(true)
  const [query, setQuery] = createSignal("")
  const [optimistic, setOptimistic] = createSignal<TeamSelectionValue | undefined>(undefined)

  const info = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
  const autoTeams = () => teams().filter((team) => team.autoEligible)
  const autoProfiles = () => profiles().filter((profile) => profile.autoEligible)
  const autoCandidateCount = () => autoTeams().length + autoProfiles().length

  /**
   * 会话上真实的团队选择；新会话默认走 Auto，符合 Claude Code 的「先说目标，
   * 系统决定是否需要委派」模型。用户如果主动选了「仅主助手」，待定槽位会覆盖这个默认值。
   */
  const stored = createMemo<TeamSelectionValue>(() => {
    if (!props.sessionID) {
      const pending = TeamSelection.pending(sdk.directory)
      if (pending) return pending
      return autoCandidateCount() > 0 ? { mode: "auto", teamIDs: [] } : TEAM_MODE_OFF
    }
    const mode = (info()?.teamMode ?? "off") as TeamMode
    return {
      mode,
      teamIDs: [...(info()?.teamIDs ?? [])],
      ...(info()?.employeeID ? { employeeID: info()!.employeeID } : {}),
    }
  })

  // 内核值追上刚点的那一档后就把乐观值撤掉，避免它一直盖住真实值。
  createEffect(() => {
    const next = optimistic()
    const live = stored()
    if (next && next.mode === live.mode && next.employeeID === live.employeeID && sameIDs(next.teamIDs, live.teamIDs))
      setOptimistic(undefined)
  })

  const current = () => optimistic() ?? stored()
  const selectedTeams = () => teams().filter((team) => current().teamIDs.includes(team.id))
  const selectedProfiles = () => profiles().filter((profile) => current().teamIDs.includes(profile.id))
  const selectedEmployee = () => employees().find((employee) => employee.id === current().employeeID)
  const filteredTeams = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase()
    if (!needle) return teams()
    return teams().filter((team) => team.name.toLocaleLowerCase().includes(needle))
  })
  const filteredProfiles = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase()
    if (!needle) return profiles()
    return profiles().filter((profile) => profile.name.toLocaleLowerCase().includes(needle))
  })
  const filteredEmployees = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase()
    if (!needle) return employees()
    return employees().filter((employee) => `${employee.name} ${employee.job}`.toLocaleLowerCase().includes(needle))
  })

  // 显示为 Auto 还不够：首条消息创建会话时也必须把这个默认授权写进去。
  // 这样用户无需先点一次下拉框，直接输入目标就能使用 Claude Code 风格的自动编排。
  createEffect(() => {
    if (!props.sessionID && !TeamSelection.pending(sdk.directory) && autoCandidateCount() > 0) {
      TeamSelection.setPending(sdk.directory, { mode: "auto", teamIDs: [] })
    }
  })

  const label = () => {
    const value = current()
    if (value.mode === "auto") return language.t("team.mode.auto")
    if (value.employeeID) return selectedEmployee()?.name ?? language.t("team.mode.expert")
    if (value.mode === "selected") {
      const picked = [...selectedTeams(), ...selectedProfiles()]
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
        ...(next.mode === "selected" ? { teamIDs: next.teamIDs } : {}),
        ...(next.employeeID ? { employeeID: next.employeeID } : { employeeID: undefined }),
      })
      .catch(() => setOptimistic(undefined))
  }

  const toggleTeam = (team: TeamSummaryView) => {
    const picked = current().teamIDs
    const next = picked.includes(team.id) ? picked.filter((id) => id !== team.id) : [...picked, team.id]
    apply(next.length ? { mode: "selected", teamIDs: next } : TEAM_MODE_OFF)
  }

  const toggleProfile = (profile: TeamProfileView) => {
    const picked = current().teamIDs
    const next = picked.includes(profile.id) ? picked.filter((id) => id !== profile.id) : [...picked, profile.id]
    apply(next.length ? { mode: "selected", teamIDs: next } : TEAM_MODE_OFF)
  }

  const selectEmployee = (employee: TeamEmployeeView) => {
    apply({ mode: "selected", teamIDs: [], employeeID: employee.id })
  }

  onMount(() => {
    void sdk.client.team
      .list({ directory: sdk.directory })
      .then((result) => setTeams(result.data ?? []))
      .catch(() => setTeams([]))
    void sdk.client.employee
      .list({ directory: sdk.directory })
      .then((result) => setEmployees((result.data ?? []).filter((employee) => !employee.archived)))
      .catch(() => setEmployees([]))
    void sdk.client.profile
      .list({ directory: sdk.directory })
      .then((result) => setProfiles(result.data ?? []))
      .catch(() => setProfiles([]))
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
    <Show when={switchedOn() && (teams().length > 0 || profiles().length > 0 || employees().length > 0 || active())}>
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
              class={`shrink-0 ${active() ? "text-icon-interactive-base" : "text-foreground-subtle"}`}
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
            <DropdownMenu.Content style={{ "min-width": "288px", "max-height": "min(480px, 70vh)", overflow: "auto" }}>
              <div class="px-2 pb-1.5">
                <input
                  value={query()}
                  placeholder={language.t("team.mode.search")}
                  aria-label={language.t("team.mode.search")}
                  class="h-8 w-full rounded-md border border-border bg-background px-2 text-12-regular text-foreground outline-none placeholder:text-foreground-subtlest focus:border-border-focus"
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
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
              <Show when={autoCandidateCount() > 0}>
                <DropdownMenu.Item onSelect={() => apply({ mode: "auto", teamIDs: [] })}>
                  <div class="flex w-full items-start gap-2.5">
                    <Icon name="lu-zap" size="small" class="mt-0.5 shrink-0 text-icon-interactive-base" />
                    <div class="flex min-w-0 flex-1 flex-col">
                      <span class="text-13-medium text-foreground">{language.t("team.mode.auto")}</span>
                      <span class="text-11-regular leading-4 text-foreground-subtle">
                        {language.t("team.mode.autoDescription", { count: autoCandidateCount() })}
                      </span>
                    </div>
                    <Show when={current().mode === "auto"}>
                      <Icon name="check" size="small" class="mt-0.5 shrink-0 text-foreground" />
                    </Show>
                  </div>
                </DropdownMenu.Item>
              </Show>
              <Show when={filteredEmployees().length > 0}>
                <div class="px-2 pt-1.5 pb-1 text-11-regular leading-4 text-foreground-subtlest">
                  {language.t("team.mode.experts")}
                </div>
                <For each={filteredEmployees()}>
                  {(employee) => (
                    <DropdownMenu.Item onSelect={() => selectEmployee(employee)}>
                      <div class="flex w-full items-start gap-2.5">
                        <ExecutorAvatar kind="expert" name={employee.name} class="mt-0.5 size-6 shrink-0 rounded-md" />
                        <div class="flex min-w-0 flex-1 flex-col">
                          <span class="truncate text-13-medium text-foreground">{employee.name}</span>
                          <span class="truncate text-11-regular leading-4 text-foreground-subtle">{employee.job}</span>
                        </div>
                        <Show when={current().employeeID === employee.id}>
                          <Icon name="check" size="small" class="mt-0.5 shrink-0" />
                        </Show>
                      </div>
                    </DropdownMenu.Item>
                  )}
                </For>
              </Show>
              <Show when={filteredProfiles().length > 0}>
                <div class="px-2 pt-1.5 pb-1 text-11-regular leading-4 text-foreground-subtlest">
                  {language.t("team.mode.teams")}
                </div>
                <For each={filteredProfiles()}>
                  {(profile) => (
                    <DropdownMenu.Item onSelect={() => toggleProfile(profile)}>
                      <div class="flex w-full items-start gap-2.5">
                        <ExecutorAvatar kind="team" name={profile.name} class="mt-0.5 size-6 shrink-0 rounded-md" />
                        <div class="min-w-0 flex-1">
                          <span class="flex items-center gap-1.5 truncate text-13-medium text-foreground">
                            {profile.name}
                            <Show when={profile.autoEligible}>
                              <span class="rounded bg-surface px-1 py-px text-10-medium text-foreground-subtlest">
                                {language.t("team.mode.autoTag")}
                              </span>
                            </Show>
                          </span>
                          <span class="truncate text-11-regular text-foreground-subtle">
                            {language.t("team.memberCount", { count: profile.memberCount })}
                          </span>
                        </div>
                        <Show when={current().teamIDs.includes(profile.id)}>
                          <Icon name="check" size="small" class="mt-0.5 shrink-0" />
                        </Show>
                      </div>
                    </DropdownMenu.Item>
                  )}
                </For>
              </Show>
              <div class="px-2 pt-1.5 pb-1 text-11-regular leading-4 text-foreground-subtlest">
                {language.t("team.mode.selectedHint")}
              </div>
              <For each={filteredTeams()}>
                {(team) => (
                  <DropdownMenu.Item onSelect={() => toggleTeam(team)}>
                    <div class="flex w-full items-start gap-2.5">
                      <ExecutorAvatar kind="team" name={team.name} class="mt-0.5 size-6 shrink-0 rounded-md" />
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
                      <Show when={current().teamIDs.includes(team.id)}>
                        <Icon name="check" size="small" class="mt-0.5 shrink-0" />
                      </Show>
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

/** Compact hover picker used from the prompt add menu. */
export const TeamModeHoverSelect: Component<{
  sessionID?: string
  trigger: JSX.Element
  contentRef?: (el: HTMLElement) => void
}> = (props) => {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const [teams, setTeams] = createSignal<TeamSummaryView[]>([])
  const [employees, setEmployees] = createSignal<TeamEmployeeView[]>([])
  const [profiles, setProfiles] = createSignal<TeamProfileView[]>([])
  const [query, setQuery] = createSignal("")
  const [optimistic, setOptimistic] = createSignal<TeamSelectionValue>()
  const [switchedOn, setSwitchedOn] = createSignal(true)
  const info = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
  const autoTeams = () => teams().filter((team) => team.autoEligible)
  const autoProfiles = () => profiles().filter((profile) => profile.autoEligible)
  const autoCandidateCount = () => autoTeams().length + autoProfiles().length
  const stored = createMemo<TeamSelectionValue>(() => {
    if (!props.sessionID) {
      const pending = TeamSelection.pending(sdk.directory)
      if (pending) return pending
      return autoCandidateCount() > 0 ? { mode: "auto", teamIDs: [] } : TEAM_MODE_OFF
    }
    const mode = (info()?.teamMode ?? "off") as TeamMode
    return {
      mode,
      teamIDs: [...(info()?.teamIDs ?? [])],
      ...(info()?.employeeID ? { employeeID: info()!.employeeID } : {}),
    }
  })
  const current = () => optimistic() ?? stored()
  const needle = () => query().trim().toLocaleLowerCase()
  const filteredEmployees = createMemo(() => {
    const value = needle()
    return value
      ? employees().filter((employee) => `${employee.name} ${employee.job}`.toLocaleLowerCase().includes(value))
      : employees()
  })
  const filteredTeams = createMemo(() => {
    const value = needle()
    return value ? teams().filter((team) => team.name.toLocaleLowerCase().includes(value)) : teams()
  })
  const filteredProfiles = createMemo(() => {
    const value = needle()
    return value ? profiles().filter((profile) => profile.name.toLocaleLowerCase().includes(value)) : profiles()
  })

  // Keep the visible Auto default in sync with new-session submission. Without a
  // session id there is no row to update yet, so submit.ts reads this pending value.
  createEffect(() => {
    if (!props.sessionID && !TeamSelection.pending(sdk.directory) && autoCandidateCount() > 0) {
      TeamSelection.setPending(sdk.directory, { mode: "auto", teamIDs: [] })
    }
  })

  createEffect(() => {
    const next = optimistic()
    const live = stored()
    if (next && next.mode === live.mode && next.employeeID === live.employeeID && sameIDs(next.teamIDs, live.teamIDs)) {
      setOptimistic(undefined)
    }
  })

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
        teamIDs: next.mode === "selected" ? next.teamIDs : [],
        ...(next.employeeID ? { employeeID: next.employeeID } : { employeeID: undefined }),
      })
      .catch(() => setOptimistic(undefined))
  }

  onMount(() => {
    void sdk.client.team
      .list({ directory: sdk.directory })
      .then((result) => setTeams(result.data ?? []))
      .catch(() => setTeams([]))
    void sdk.client.employee
      .list({ directory: sdk.directory })
      .then((result) => setEmployees((result.data ?? []).filter((employee) => !employee.archived)))
      .catch(() => setEmployees([]))
    void sdk.client.profile
      .list({ directory: sdk.directory })
      .then((result) => setProfiles(result.data ?? []))
      .catch(() => setProfiles([]))
    void sdk.client.kernel
      .capabilities({ directory: sdk.directory })
      .then((result) => {
        const feature = (result.data?.features ?? []).find((item) => item.id === "team_orchestration")
        setSwitchedOn(feature ? feature.enabled : true)
      })
      .catch(() => setSwitchedOn(true))
  })

  const toggleTeam = (team: TeamSummaryView) => {
    const ids = current().teamIDs
    const next = ids.includes(team.id) ? ids.filter((id) => id !== team.id) : [...ids, team.id]
    apply(next.length > 0 ? { mode: "selected", teamIDs: next } : TEAM_MODE_OFF)
  }
  const toggleProfile = (profile: TeamProfileView) => {
    const ids = current().teamIDs
    const next = ids.includes(profile.id) ? ids.filter((id) => id !== profile.id) : [...ids, profile.id]
    apply(next.length > 0 ? { mode: "selected", teamIDs: next } : TEAM_MODE_OFF)
  }
  const itemClass = "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"

  return (
    <Show when={switchedOn()}>
      <HoverCard
        trigger={props.trigger}
        placement="right-start"
        gutter={8}
        openDelay={120}
        closeDelay={180}
        contentRef={props.contentRef}
        class="w-72"
      >
        <div class="flex max-h-[min(480px,70vh)] flex-col overflow-hidden rounded-lg bg-background p-1.5 shadow-lg">
          <div class="px-1 pb-1.5 text-11-regular text-foreground-subtle">{language.t("team.mode.experts")}</div>
          <input
            value={query()}
            placeholder={language.t("team.mode.searchExpert")}
            aria-label={language.t("team.mode.searchExpert")}
            class="h-8 w-full rounded-md border border-border bg-surface px-2 text-12-regular text-foreground outline-none placeholder:text-foreground-subtlest focus:border-border-focus"
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <div class="mt-1 max-h-[360px] overflow-y-auto">
            <button
              type="button"
              class={itemClass}
              data-action="team-mode-off"
              data-selected={current().mode === "off" ? "true" : undefined}
              onClick={() => apply(TEAM_MODE_OFF)}
            >
              <Icon name="lu-users" size="small" class="mt-0.5 shrink-0 text-foreground-subtle" />
              <span class="min-w-0 flex-1">
                <span class="block text-13-medium text-foreground">{language.t("team.mode.off")}</span>
                <span class="block text-11-regular text-foreground-subtle">
                  {language.t("team.mode.offDescription")}
                </span>
              </span>
              <Show when={current().mode === "off"}>
                <Icon name="check" size="small" />
              </Show>
            </button>
            <Show when={autoCandidateCount() > 0}>
              <button type="button" class={itemClass} onClick={() => apply({ mode: "auto", teamIDs: [] })}>
                <Icon name="lu-zap" size="small" class="mt-0.5 shrink-0 text-icon-interactive-base" />
                <span class="min-w-0 flex-1">
                  <span class="block text-13-medium text-foreground">{language.t("team.mode.auto")}</span>
                  <span class="block text-11-regular text-foreground-subtle">
                    {language.t("team.mode.autoDescription", { count: autoCandidateCount() })}
                  </span>
                </span>
                <Show when={current().mode === "auto"}>
                  <Icon name="check" size="small" />
                </Show>
              </button>
            </Show>
            <Show when={filteredEmployees().length > 0}>
              <div class="px-2 pt-2 pb-1 text-11-regular text-foreground-subtlest">
                {language.t("team.mode.experts")}
              </div>
              <For each={filteredEmployees()}>
                {(employee) => (
                  <button
                    type="button"
                    class={itemClass}
                    onClick={() => apply({ mode: "selected", teamIDs: [], employeeID: employee.id })}
                  >
                    <ExecutorAvatar kind="expert" name={employee.name} class="mt-0.5 size-6 shrink-0 rounded-md" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-13-medium text-foreground">{employee.name}</span>
                      <span class="block truncate text-11-regular text-foreground-subtle">{employee.job}</span>
                    </span>
                    <Show when={current().employeeID === employee.id}>
                      <Icon name="check" size="small" class="mt-0.5 shrink-0" />
                    </Show>
                  </button>
                )}
              </For>
            </Show>
            <Show when={filteredProfiles().length > 0}>
              <div class="px-2 pt-2 pb-1 text-11-regular text-foreground-subtlest">{language.t("team.mode.teams")}</div>
              <For each={filteredProfiles()}>
                {(profile) => (
                  <button type="button" class={itemClass} onClick={() => toggleProfile(profile)}>
                    <ExecutorAvatar kind="team" name={profile.name} class="mt-0.5 size-6 shrink-0 rounded-md" />
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-1.5 truncate text-13-medium text-foreground">
                        {profile.name}
                        <Show when={profile.autoEligible}>
                          <span class="rounded bg-surface px-1 py-px text-10-medium text-foreground-subtlest">
                            {language.t("team.mode.autoTag")}
                          </span>
                        </Show>
                      </span>
                      <span class="block truncate text-11-regular text-foreground-subtle">
                        {language.t("team.memberCount", { count: profile.memberCount })}
                      </span>
                    </span>
                    <Show when={current().teamIDs.includes(profile.id)}>
                      <Icon name="check" size="small" class="mt-0.5 shrink-0" />
                    </Show>
                  </button>
                )}
              </For>
            </Show>
            <Show when={filteredTeams().length > 0}>
              <div class="px-2 pt-2 pb-1 text-11-regular text-foreground-subtlest">
                {language.t("team.mode.selectedHint")}
              </div>
              <For each={filteredTeams()}>
                {(team) => (
                  <button type="button" class={itemClass} onClick={() => toggleTeam(team)}>
                    <ExecutorAvatar kind="team" name={team.name} class="mt-0.5 size-6 shrink-0 rounded-md" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-13-medium text-foreground">{team.name}</span>
                      <span class="block truncate text-11-regular text-foreground-subtle">
                        {language.t("team.memberCount", { count: team.memberCount })}
                      </span>
                    </span>
                    <Show when={current().teamIDs.includes(team.id)}>
                      <Icon name="check" size="small" class="mt-0.5 shrink-0" />
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </HoverCard>
    </Show>
  )
}
