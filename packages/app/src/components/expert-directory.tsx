import { Button } from "@novaway/ui/button"
import { Icon, type IconProps } from "@novaway/ui/icon"
import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { ExpertCard, type ExpertCardView } from "@/components/expert-card"
import { ExpertTeamCard, type ExpertTeamCardView } from "@/components/expert-team-card"
import { ExecutorAvatar } from "@/components/executor-avatar"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

type DirectorySection = "all" | "teams" | "experts"
type ExecutorKind = "teams" | "experts"
type DirectoryCategory = "all" | "development" | "research" | "product" | "office" | "content" | "data"
type Selected = {
  kind: ExecutorKind
  id: string
  name: string
  team?: ExpertTeamCardView
  expert?: ExpertCardView
}

type RecentRef = { kind: ExecutorKind; id: string }

type ShowcaseItem = {
  category: Exclude<DirectoryCategory, "all">
  icon: IconProps["name"]
  title: string
  hint: string
}

const showcaseItems: ShowcaseItem[] = [
  {
    category: "development",
    icon: "code",
    title: "expertCenter.directory.showcase.development",
    hint: "expertCenter.directory.showcase.developmentHint",
  },
  {
    category: "content",
    icon: "lu-image",
    title: "expertCenter.directory.showcase.content",
    hint: "expertCenter.directory.showcase.contentHint",
  },
  {
    category: "research",
    icon: "chart",
    title: "expertCenter.directory.showcase.research",
    hint: "expertCenter.directory.showcase.researchHint",
  },
  {
    category: "product",
    icon: "lu-brain",
    title: "expertCenter.directory.showcase.product",
    hint: "expertCenter.directory.showcase.productHint",
  },
]

/** User-facing catalog for choosing a capability before starting a conversation. */
export const ExpertDirectory: Component<{
  directory: string
  initialSection?: DirectorySection
  onBack: () => void
  onManage: () => void
  onCreateExpert?: (onChanged: () => void) => void
  onCreateTeam?: (onChanged: () => void) => void
  onOpenSession?: (sessionID: string) => void
}> = (props) => {
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const t = (key: string, vars?: Record<string, unknown>) => language.t(key as never, vars as never)
  const [section, setSection] = createSignal<DirectorySection>(props.initialSection ?? "all")
  const [teams, setTeams] = createSignal<ExpertTeamCardView[]>([])
  const [experts, setExperts] = createSignal<ExpertCardView[]>([])
  const [query, setQuery] = createSignal("")
  const [category, setCategory] = createSignal<DirectoryCategory>("all")
  const [loading, setLoading] = createSignal(true)
  const [starting, setStarting] = createSignal<string>()
  const [selected, setSelected] = createSignal<Selected>()
  const [recent, setRecent] = createSignal<RecentRef[]>([])
  const [loadFailures, setLoadFailures] = createSignal<ExecutorKind[]>([])
  const [launchFailed, setLaunchFailed] = createSignal(false)
  let loadRevision = 0
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const load = async () => {
    if (disposed) return
    const revision = ++loadRevision
    setLoading(true)
    try {
      const [teamResult, expertResult] = await Promise.allSettled([
        sdk.client.expertCenter.teams({ directory: props.directory }, { throwOnError: true }),
        sdk.client.expertCenter.experts({ directory: props.directory }, { throwOnError: true }),
      ])
      if (disposed || revision !== loadRevision) return
      const failures: ExecutorKind[] = []
      if (teamResult.status === "fulfilled" && teamResult.value.data) {
        setTeams(
          teamResult.value.data.map((team) => ({
            ...team,
            memberCount: typeof team.memberCount === "number" ? team.memberCount : team.memberPreview.length,
          })),
        )
      } else failures.push("teams")
      if (expertResult.status === "fulfilled" && expertResult.value.data) setExperts(expertResult.value.data)
      else failures.push("experts")
      setLoadFailures(failures)
    } finally {
      if (!disposed && revision === loadRevision) setLoading(false)
    }
  }

  const finishCreation = (kind: ExecutorKind) => {
    if (disposed) return
    if (section() !== "all") setSection(kind)
    setCategory("all")
    setQuery("")
    void load()
  }

  const categoryOf = (value: string): Exclude<DirectoryCategory, "all"> => {
    const text = value.toLocaleLowerCase()
    if (/(excel|word|powerpoint|ppt|office|办公|文档|表格)/.test(text)) return "office"
    if (/(sql|数据|data|统计|分析|analytics|spreadsheet)/.test(text)) return "data"
    if (/(research|研究|调研|竞品|fact|事实|搜索)/.test(text)) return "research"
    if (/(product|产品|设计|design|ux|体验)/.test(text)) return "product"
    if (/(content|内容|写作|文案|marketing|营销|媒体|运营|增长|campaign)/.test(text)) return "content"
    return "development"
  }

  const relevance = (needle: string, text: string, itemCategory: DirectoryCategory) => {
    if (!needle) return 1
    const normalized = text.toLocaleLowerCase()
    const terms = [
      ...needle.split(/[\s,，。！？；;、/]+/).filter((term) => term.length > 1),
      ...[
        "竞品",
        "研究",
        "分析",
        "报告",
        "开发",
        "代码",
        "设计",
        "产品",
        "办公",
        "文档",
        "内容",
        "数据",
        "自动化",
      ].filter((term) => needle.includes(term)),
    ]
    const uniqueTerms = [...new Set(terms)]
    let score = normalized.includes(needle) ? 10 : 0
    for (const term of uniqueTerms) if (normalized.includes(term)) score += 2
    const hasCategorySignal =
      /(excel|word|powerpoint|ppt|office|办公|文档|表格|sql|数据|统计|分析|analytics|spreadsheet|research|研究|调研|竞品|fact|事实|搜索|product|产品|设计|design|ux|体验|content|内容|写作|文案|marketing|营销|媒体|运营|增长|campaign|react|typescript|前端|后端|开发|研发|编码|代码)/.test(
        needle,
      )
    if (uniqueTerms.length > 0 && hasCategorySignal && categoryOf(needle) === itemCategory) score += 1
    return score
  }

  const categoryOfTeam = (team: ExpertTeamCardView) =>
    categoryOf([team.name, team.description ?? "", ...team.capabilities].join(" "))
  const categoryOfExpert = (expert: ExpertCardView) =>
    categoryOf([expert.name, expert.role ?? "", expert.category ?? "", expert.description ?? ""].join(" "))
  const categoryLabel = (value: DirectoryCategory) => t(`expertCenter.directory.category.${value}`)
  const categoryOptions = createMemo(() => {
    const source =
      section() === "teams"
        ? teams().map(categoryOfTeam)
        : section() === "experts"
          ? experts().map(categoryOfExpert)
          : [...teams().map(categoryOfTeam), ...experts().map(categoryOfExpert)]
    return [
      "all",
      ...["development", "research", "product", "office", "content", "data"].filter((item) =>
        source.includes(item as Exclude<DirectoryCategory, "all">),
      ),
    ] as DirectoryCategory[]
  })

  const filteredTeams = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase()
    return teams()
      .filter((team) => category() === "all" || categoryOfTeam(team) === category())
      .map((team) => ({
        team,
        score: relevance(
          needle,
          [team.name, team.description ?? "", ...team.capabilities].join(" "),
          categoryOfTeam(team),
        ),
      }))
      .filter((item) => !needle || item.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((item) => item.team)
  })

  const filteredExperts = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase()
    return experts()
      .filter((expert) => category() === "all" || categoryOfExpert(expert) === category())
      .map((expert) => ({
        expert,
        score: relevance(
          needle,
          [
            expert.name,
            expert.role ?? "",
            expert.category ?? "",
            expert.description ?? "",
            ...(expert.capabilities ?? []),
          ].join(" "),
          categoryOfExpert(expert),
        ),
      }))
      .filter((item) => !needle || item.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((item) => item.expert)
  })

  const recommendedTeams = createMemo(() => {
    if (section() === "experts" || query().trim()) return []
    return filteredTeams()
      .filter((team) => team.autoEligible)
      .slice(0, 2)
  })
  const browseTeams = createMemo(() => {
    const featured = new Set(recommendedTeams().map((team) => team.id))
    return filteredTeams().filter((team) => !featured.has(team.id))
  })
  const recentItems = createMemo(() => {
    const current = section()
    const teamMap = new Map(teams().map((team) => [team.id, team]))
    const expertMap = new Map(experts().map((expert) => [expert.id, expert]))
    return recent()
      .filter((item) => current === "all" || item.kind === current)
      .map((item) => ({
        ...item,
        team: item.kind === "teams" ? teamMap.get(item.id) : undefined,
        expert: item.kind === "experts" ? expertMap.get(item.id) : undefined,
      }))
      .filter((item) => item.team || (item.expert && item.expert.available !== false))
  })
  const remember = (kind: ExecutorKind, id: string) => {
    const next = [{ kind, id }, ...recent().filter((item) => item.kind !== kind || item.id !== id)].slice(0, 6)
    setRecent(next)
    try {
      window.localStorage.setItem(`novaway.expert-center.recent:${props.directory}`, JSON.stringify(next))
    } catch {
      // Private browsing and restricted storage should not block starting a conversation.
    }
  }
  const startConversation = async (kind: ExecutorKind, id: string, name: string) => {
    if (!props.onOpenSession || starting()) return
    if (kind === "experts" && !experts().some((expert) => expert.id === id && expert.available !== false)) return
    setStarting(id)
    setLaunchFailed(false)
    try {
      const created = await sdk.client.session.create(
        {
          directory: props.directory,
          title: t("expertCenter.directory.conversationTitle", { name }),
          ...(kind === "teams" ? { teamMode: "selected", teamIDs: [id] } : { expertID: id }),
        },
        { throwOnError: true },
      )
      const sessionID = created.data?.id
      if (!sessionID) throw new Error(t("workbench.sessionCreateFailed"))
      if (disposed) return
      remember(kind, id)
      setSelected(undefined)
      props.onOpenSession(sessionID)
    } catch {
      if (!disposed) setLaunchFailed(true)
    } finally {
      setStarting(undefined)
    }
  }

  onMount(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`novaway.expert-center.recent:${props.directory}`) ?? "[]")
      if (Array.isArray(saved)) {
        setRecent(
          saved.filter(
            (item): item is RecentRef =>
              item && (item.kind === "teams" || item.kind === "experts") && typeof item.id === "string",
          ),
        )
      }
    } catch {
      setRecent([])
    }
    void load()
  })

  const count = () =>
    section() === "teams"
      ? filteredTeams().length
      : section() === "experts"
        ? filteredExperts().length
        : filteredTeams().length + filteredExperts().length

  const launchError = () => (
    <Show when={launchFailed()}>
      <div role="alert" class="mb-3 rounded-lg border border-border bg-surface px-3 py-2 text-ui-xs text-critical-base">
        {t("workbench.sessionCreateFailed")}
      </div>
    </Show>
  )

  return (
    <div
      data-component="expert-directory"
      class="@container relative flex h-full min-h-0 min-w-0 flex-col bg-background"
    >
      <header class="shrink-0 border-b border-border px-4 py-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="small" aria-label={t("common.goBack")} onClick={props.onBack}>
              <Icon name="arrow-left" size="small" />
            </Button>
            <h1 class="min-w-0 text-14-medium text-foreground">{t("expertCenter.directory.title")}</h1>
          </div>
          <div class="flex items-center gap-1">
            <Button
              variant="secondary"
              size="small"
              data-action="expert-directory-add-expert"
              title={t("expertCenter.directory.addExpert")}
              aria-label={t("expertCenter.directory.addExpert")}
              onClick={() => props.onCreateExpert?.(() => finishCreation("experts"))}
            >
              <Icon name="plus-small" size="small" />
              <span class="hidden @3xl:inline">{t("expertCenter.directory.addExpert")}</span>
            </Button>
            <Button
              variant="primary"
              size="small"
              data-action="expert-directory-create-team"
              title={t("expertCenter.directory.createTeam")}
              aria-label={t("expertCenter.directory.createTeam")}
              onClick={() => props.onCreateTeam?.(() => finishCreation("teams"))}
            >
              <Icon name="lu-users" size="small" />
              <span class="hidden @3xl:inline">{t("expertCenter.directory.createTeam")}</span>
            </Button>
            <Button
              variant="ghost"
              size="small"
              title={t("expertCenter.directory.refresh")}
              aria-label={t("expertCenter.directory.refresh")}
              disabled={loading()}
              onClick={() => void load()}
            >
              <Icon name="refresh" size="small" class={loading() ? "animate-spin" : undefined} />
            </Button>
            <Button
              variant="ghost"
              size="small"
              data-action="expert-directory-manage"
              title={t("expertCenter.directory.manage")}
              aria-label={t("expertCenter.directory.manage")}
              onClick={props.onManage}
            >
              <Icon name="settings-gear" size="small" />
              <span class="hidden @3xl:inline">{t("expertCenter.directory.manage")}</span>
            </Button>
          </div>
        </div>
        <p class="mt-1.5 text-12-regular text-foreground-subtle">{t("expertCenter.directory.hint")}</p>
      </header>
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <div
          class="flex items-center gap-0.5 rounded-xl border border-border/80 bg-surface/60 p-0.5 shadow-sm max-w-full overflow-x-auto"
          role="tablist"
        >
          <For
            each={
              [
                ["all", "expertCenter.directory.all", teams().length + experts().length],
                ["teams", "expertCenter.directory.teams", teams().length],
                ["experts", "expertCenter.directory.experts", experts().length],
              ] as const
            }
          >
            {([value, label, total]) => (
              <button
                type="button"
                role="tab"
                aria-selected={section() === value}
                class="relative shrink-0 rounded-[10px] px-3 py-1.5 text-ui-xs transition-all duration-200"
                classList={{
                  "bg-background text-foreground shadow-sm ring-1 ring-border/80": section() === value,
                  "text-foreground-subtle hover:bg-hover hover:text-foreground": section() !== value,
                }}
                onClick={() => {
                  setSection(value)
                  setCategory("all")
                }}
              >
                <span>{t(label)}</span>
                <span
                  class="ml-1.5 tabular-nums"
                  classList={{
                    "text-icon-interactive-base": section() === value,
                    "text-foreground-subtlest": section() !== value,
                  }}
                >
                  {total}
                </span>
              </button>
            )}
          </For>
        </div>
        <div class="relative w-full @2xl:ml-auto @2xl:w-64">
          <span class="pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2" aria-hidden="true">
            <Icon name="magnifying-glass" size="small" />
          </span>
          <input
            value={query()}
            placeholder={t("expertCenter.directory.goalSearch")}
            aria-label={t("expertCenter.directory.goalSearch")}
            class="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest focus:border-border-focus"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-2">
        <span class="mr-1 shrink-0 text-[11px] font-medium text-foreground-subtlest">
          {t("expertCenter.directory.filterBy")}
        </span>
        <For each={categoryOptions()}>
          {(value) => (
            <button
              type="button"
              class="shrink-0 rounded-full px-2.5 py-1 text-[11px] transition-colors"
              classList={{
                "bg-surface text-foreground": category() === value,
                "text-foreground-subtle hover:bg-hover": category() !== value,
              }}
              onClick={() => setCategory(value)}
            >
              {categoryLabel(value)}
            </button>
          )}
        </For>
      </div>
      <Show when={section() === "all" && !query().trim()}>
        <div
          data-slot="executor-directory-hero"
          class="mx-4 mt-3 rounded-2xl border border-border/80 bg-surface/70 px-4 py-3 shadow-sm"
        >
          <div class="flex flex-wrap items-center gap-3">
            <div class="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-background text-icon-interactive-base">
              <Icon name="lu-zap" size="small" />
            </div>
            <div class="min-w-40 flex-1">
              <div class="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
                {t("expertCenter.directory.all")}
              </div>
              <div class="mt-0.5 text-[11px] text-foreground-subtle">{t("expertCenter.directory.allHint")}</div>
            </div>
            <div class="flex items-center gap-2 text-center">
              <div class="min-w-16 rounded-xl border border-border/70 bg-background/60 px-2.5 py-1.5">
                <div class="text-sm font-semibold tabular-nums text-foreground">{teams().length}</div>
                <div class="text-[10px] text-foreground-subtlest">{t("expertCenter.directory.teams")}</div>
              </div>
              <div class="min-w-16 rounded-xl border border-border/70 bg-background/60 px-2.5 py-1.5">
                <div class="text-sm font-semibold tabular-nums text-foreground">{experts().length}</div>
                <div class="text-[10px] text-foreground-subtlest">{t("expertCenter.directory.experts")}</div>
              </div>
            </div>
          </div>
        </div>
      </Show>
      <Show when={section() === "all" && !query().trim()}>
        <section class="mx-4 mt-3" data-slot="executor-directory-showcase">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-1">
            <span class="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtlest">
              {t("expertCenter.directory.recommendedEyebrow")}
            </span>
            <span class="text-[11px] text-foreground-subtlest">{t("expertCenter.directory.allHint")}</span>
          </div>
          <div class="flex gap-2.5 overflow-x-auto pb-1">
            <For each={showcaseItems}>
              {(item) => (
                <button
                  type="button"
                  class="group flex min-w-44 flex-1 items-center gap-2.5 rounded-2xl border border-border/80 bg-background/90 p-2.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-border-focus hover:shadow-md"
                  classList={{ "border-border-focus bg-surface": category() === item.category }}
                  onClick={() => setCategory(item.category)}
                >
                  <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-icon-interactive-base transition-colors group-hover:bg-hover">
                    <Icon name={item.icon} size="small" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[12px] font-semibold text-foreground">{t(item.title)}</span>
                    <span class="mt-0.5 block truncate text-[10px] text-foreground-subtle">{t(item.hint)}</span>
                  </span>
                  <Icon name="chevron-right" size="small" class="shrink-0 text-foreground-subtlest" />
                </button>
              )}
            </For>
          </div>
        </section>
      </Show>
      <Show when={query().trim() && count() > 0}>
        <div class="mx-4 mt-3 flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2 text-ui-xs shadow-sm">
          <Icon name="lu-zap" size="small" class="shrink-0 text-icon-interactive-base" />
          <span class="min-w-0 flex-1 truncate text-foreground-subtle">
            {t("expertCenter.directory.matching", { goal: query().trim(), count: count() })}
          </span>
          <button
            type="button"
            class="shrink-0 text-foreground-subtlest hover:text-foreground"
            onClick={() => setQuery("")}
          >
            {t("expertCenter.directory.clearGoal")}
          </button>
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <Show when={loadFailures().length > 0}>
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <span role="alert" class="text-ui-xs text-critical-base">
              {t("expertCenter.directory.loadFailed", {
                resources: loadFailures()
                  .map((kind) => t(`expertCenter.directory.${kind}`))
                  .join(" / "),
              })}
            </span>
            <Button variant="secondary" size="small" disabled={loading()} onClick={() => void load()}>
              {t("expertCenter.directory.retry")}
            </Button>
          </div>
        </Show>
        <Show when={!selected()}>{launchError()}</Show>
        <Show
          when={!loading() || count() > 0}
          fallback={<div class="py-8 text-center text-ui-xs text-foreground-subtle">{t("workbench.loading")}</div>}
        >
          <Show when={!query().trim() && recentItems().length > 0}>
            <section class="mb-6">
              <div class="mb-3 flex items-end justify-between">
                <div>
                  <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtlest">
                    {t("expertCenter.directory.recentEyebrow")}
                  </div>
                  <h2 class="mt-1 text-lg font-semibold tracking-[-0.02em] text-foreground">
                    {t("expertCenter.directory.recent")}
                  </h2>
                </div>
                <span class="text-ui-xs text-foreground-subtlest">{t("expertCenter.directory.recentHint")}</span>
              </div>
              <div class="flex gap-3 overflow-x-auto pb-1">
                <For each={recentItems()}>
                  {(item) => (
                    <div class="flex min-w-64 shrink-0 items-center gap-3 rounded-2xl border border-border bg-surface/70 p-3 shadow-sm transition-colors hover:border-border-focus">
                      <Show when={item.team}>
                        {(team) => <ExecutorAvatar kind="team" name={team().name} class="size-10 rounded-full" />}
                      </Show>
                      <Show when={item.expert}>
                        {(expert) => (
                          <ExecutorAvatar
                            kind="expert"
                            name={expert().name}
                            avatarUrl={expert().avatarUrl}
                            class="size-10 rounded-full"
                          />
                        )}
                      </Show>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-ui-xs font-semibold text-foreground">
                          {item.team?.name || item.expert?.name}
                        </div>
                        <div class="mt-0.5 truncate text-[11px] text-foreground-subtle">
                          {item.team?.description || item.expert?.role || t("expertCenter.expert.fallback")}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="small"
                        title={t("expertCenter.directory.start")}
                        aria-label={t("expertCenter.directory.start")}
                        disabled={Boolean(starting())}
                        onClick={() =>
                          void startConversation(item.kind, item.id, item.team?.name || item.expert?.name || item.id)
                        }
                      >
                        <Icon name="arrow-right" size="small" />
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </Show>
          <Show when={recommendedTeams().length > 0}>
            <section class="mb-6">
              <div class="mb-3 flex items-end justify-between">
                <div>
                  <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtlest">
                    {t("expertCenter.directory.recommendedEyebrow")}
                  </div>
                  <h2 class="mt-1 text-lg font-semibold tracking-[-0.02em] text-foreground">
                    {t("expertCenter.directory.recommended")}
                  </h2>
                </div>
                <span class="text-ui-xs text-foreground-subtlest">{t("expertCenter.directory.recommendedHint")}</span>
              </div>
              <div class="grid gap-3 lg:grid-cols-2">
                <For each={recommendedTeams()}>
                  {(team) => (
                    <ExpertTeamCard
                      team={team}
                      onClick={() => setSelected({ kind: "teams", id: team.id, name: team.name, team })}
                      onStart={() => void startConversation("teams", team.id, team.name)}
                      starting={starting() === team.id}
                      startLabel={t("expertCenter.directory.invoke")}
                      loadingLabel={t("workbench.loading")}
                    />
                  )}
                </For>
              </div>
            </section>
          </Show>
          <Show
            when={count() > 0}
            fallback={
              <Show when={loadFailures().length === 0}>
                <div class="flex flex-col items-center gap-2 py-8 text-center text-ui-xs text-foreground-subtle">
                  {t("expertCenter.directory.empty")}
                  <Show when={query().trim() || category() !== "all"}>
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        setQuery("")
                        setCategory("all")
                      }}
                    >
                      {t("expertCenter.directory.resetFilters")}
                    </Button>
                  </Show>
                </div>
              </Show>
            }
          >
            <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Show when={section() !== "experts"}>
                <Show when={section() === "all"}>
                  <div class="col-span-full mt-1 flex items-center gap-3">
                    <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtlest">
                      {t("expertCenter.directory.teams")}
                    </span>
                    <span class="h-px flex-1 bg-border" />
                  </div>
                </Show>
                <For each={browseTeams()}>
                  {(team) => (
                    <ExpertTeamCard
                      team={team}
                      onClick={() => setSelected({ kind: "teams", id: team.id, name: team.name, team })}
                      onStart={() => void startConversation("teams", team.id, team.name)}
                      starting={starting() === team.id}
                      startLabel={t("expertCenter.directory.invoke")}
                      loadingLabel={t("workbench.loading")}
                    />
                  )}
                </For>
              </Show>
              <Show when={section() !== "teams"}>
                <div class="col-span-full mt-4 flex items-center gap-3">
                  <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtlest">
                    {t("expertCenter.directory.experts")}
                  </span>
                  <span class="h-px flex-1 bg-border" />
                </div>
                <For each={filteredExperts()}>
                  {(expert) => (
                    <ExpertCard
                      expert={expert}
                      onClick={() => setSelected({ kind: "experts", id: expert.id, name: expert.name, expert })}
                      onStart={() => void startConversation("experts", expert.id, expert.name)}
                      starting={starting() === expert.id}
                      startLabel={t("expertCenter.directory.invoke")}
                      loadingLabel={t("workbench.loading")}
                    />
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
      <Show when={selected()}>
        {(item) => (
          <div
            class="absolute inset-0 z-20 flex justify-end bg-black/20 backdrop-blur-[2px]"
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelected(undefined)
            }}
          >
            <aside class="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-background p-5 shadow-2xl">
              <div class="flex items-center justify-between">
                <span class="text-ui-xs font-medium uppercase tracking-[0.12em] text-foreground-subtlest">
                  {t("expertCenter.directory.details")}
                </span>
                <Button
                  variant="ghost"
                  size="small"
                  aria-label={t("expertCenter.directory.close")}
                  title={t("expertCenter.directory.close")}
                  onClick={() => setSelected(undefined)}
                >
                  <Icon name="close" size="small" />
                </Button>
              </div>
              {launchError()}
              <Show when={item().team}>
                {(team) => (
                  <div class="mt-6">
                    <div class="flex items-center gap-3">
                      <ExecutorAvatar kind="team" name={team().name} class="size-16 rounded-full text-lg shadow-lg" />
                      <div class="min-w-0">
                        <h2 class="truncate text-xl font-semibold tracking-[-0.02em] text-foreground">{team().name}</h2>
                        <p class="mt-1 text-ui-xs text-foreground-subtle">
                          {t("expertCenter.team.memberCount", { count: team().memberCount })}
                        </p>
                      </div>
                    </div>
                    <p class="mt-5 text-ui-sm leading-6 text-foreground-subtle">
                      {team().description || t("expertCenter.team.fallback")}
                    </p>
                    <Button
                      variant="primary"
                      class="mt-4"
                      disabled={Boolean(starting())}
                      onClick={() => void startConversation("teams", team().id, team().name)}
                    >
                      <Icon name="arrow-right" size="small" />
                      {starting() === team().id ? t("workbench.loading") : t("expertCenter.directory.invoke")}
                    </Button>
                    <div class="mt-5 grid grid-cols-2 gap-2">
                      <div class="rounded-xl border border-border bg-surface/70 px-3 py-2">
                        <div class="text-[10px] text-foreground-subtlest">{t("expertCenter.detail.members")}</div>
                        <div class="mt-1 text-sm font-semibold text-foreground">{team().memberCount}</div>
                      </div>
                      <div class="rounded-xl border border-border bg-surface/70 px-3 py-2">
                        <div class="text-[10px] text-foreground-subtlest">{t("expertCenter.detail.mode")}</div>
                        <div class="mt-1 text-sm font-semibold text-foreground">
                          {team().autoEligible ? t("expertCenter.team.auto") : t("expertCenter.detail.manual")}
                        </div>
                      </div>
                    </div>
                    <h3 class="mt-6 text-ui-xs font-semibold text-foreground">
                      {t("expertCenter.directory.capabilities")}
                    </h3>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      <For each={team().capabilities}>
                        {(capability) => (
                          <span class="rounded-full bg-surface px-2.5 py-1 text-ui-xs text-foreground-subtle">
                            {capability}
                          </span>
                        )}
                      </For>
                    </div>
                    <h3 class="mt-6 text-ui-xs font-semibold text-foreground">{t("expertCenter.detail.quickStart")}</h3>
                    <div class="mt-3 flex flex-col gap-2">
                      <For
                        each={[
                          "expertCenter.detail.prompt.plan",
                          "expertCenter.detail.prompt.review",
                          "expertCenter.detail.prompt.deliver",
                        ]}
                      >
                        {(prompt) => (
                          <div class="flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5 text-ui-xs text-foreground-subtle">
                            <Icon name="prompt" size="small" class="shrink-0 text-foreground-subtlest" />
                            <span>{t(prompt)}</span>
                          </div>
                        )}
                      </For>
                    </div>
                    <h3 class="mt-6 text-ui-xs font-semibold text-foreground">{t("expertCenter.directory.members")}</h3>
                    <div class="mt-3 flex flex-col gap-2">
                      <For each={team().memberPreview}>
                        {(member) => (
                          <div class="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2">
                            <ExecutorAvatar kind="expert" name={member.name} class="size-8 rounded-full" />
                            <div class="min-w-0">
                              <div class="truncate text-ui-xs font-medium text-foreground">{member.name}</div>
                              <div class="truncate text-[11px] text-foreground-subtle">{member.role}</div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </Show>
              <Show when={item().expert}>
                {(expert) => (
                  <div class="mt-6">
                    <div class="flex items-center gap-3">
                      <ExecutorAvatar
                        kind="expert"
                        name={expert().name}
                        avatarUrl={expert().avatarUrl}
                        class="size-16 rounded-full shadow-lg"
                      />
                      <div class="min-w-0">
                        <h2 class="truncate text-xl font-semibold tracking-[-0.02em] text-foreground">
                          {expert().name}
                        </h2>
                        <p class="mt-1 truncate text-ui-xs text-foreground-subtle">
                          {expert().role || expert().category || t("expertCenter.expert.fallback")}
                        </p>
                      </div>
                    </div>
                    <p class="mt-5 text-ui-sm leading-6 text-foreground-subtle">
                      {expert().description || t("expertCenter.expert.ready")}
                    </p>
                    <Button
                      variant="primary"
                      class="mt-4"
                      disabled={expert().available === false || Boolean(starting())}
                      onClick={() => void startConversation("experts", expert().id, expert().name)}
                    >
                      <Icon name="arrow-right" size="small" />
                      {starting() === expert().id ? t("workbench.loading") : t("expertCenter.directory.invoke")}
                    </Button>
                    <div class="mt-6 rounded-2xl border border-border bg-surface p-4">
                      <div class="flex items-center gap-2 text-ui-xs font-medium text-foreground">
                        <span
                          class="size-2 rounded-full"
                          classList={{
                            "bg-surface-success-base": expert().available !== false,
                            "bg-foreground-subtlest": expert().available === false,
                          }}
                        />
                        {expert().available === false
                          ? t("expertCenter.expert.unavailable")
                          : t("expertCenter.expert.available")}
                      </div>
                      <div class="mt-2 text-ui-xs leading-5 text-foreground-subtle">
                        {t("expertCenter.expert.ready")}
                      </div>
                      <div class="mt-3 flex items-center justify-between border-t border-border/70 pt-3 text-[11px]">
                        <span class="text-foreground-subtlest">{t("expertCenter.detail.category")}</span>
                        <span class="font-medium text-foreground">
                          {expert().category || t("expertCenter.expert.fallback")}
                        </span>
                      </div>
                    </div>
                    <h3 class="mt-6 text-ui-xs font-semibold text-foreground">{t("expertCenter.detail.quickStart")}</h3>
                    <div class="mt-3 flex flex-col gap-2">
                      <For
                        each={[
                          "expertCenter.detail.prompt.plan",
                          "expertCenter.detail.prompt.review",
                          "expertCenter.detail.prompt.deliver",
                        ]}
                      >
                        {(prompt) => (
                          <div class="flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5 text-ui-xs text-foreground-subtle">
                            <Icon name="prompt" size="small" class="shrink-0 text-foreground-subtlest" />
                            <span>{t(prompt)}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </Show>
            </aside>
          </div>
        )}
      </Show>
    </div>
  )
}
