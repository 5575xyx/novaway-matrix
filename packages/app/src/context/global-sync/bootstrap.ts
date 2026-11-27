import type {
  Config,
  NovawayClient,
  Path,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  QuestionRequest,
  Session,
  Todo,
} from "@novaway/sdk/v2/client"
import { showToast } from "@novaway/ui/toast"
import { getFilename } from "@novaway/core/util/path"
import { retry } from "@novaway/core/util/retry"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache } from "./types"
import { cmp, normalizeAgentList, normalizeProviderList } from "./utils"
import { formatServerError } from "@/utils/server-errors"
import { QueryClient, queryOptions } from "@tanstack/solid-query"
import { loadLspQuery, loadMcpQuery } from "../global-sync"

type GlobalStore = {
  ready: boolean
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

function errors(list: PromiseSettledResult<unknown>[]) {
  return list.filter((item): item is PromiseRejectedResult => item.status === "rejected").map((item) => item.reason)
}

const requestDeadline = (ms = 15_000) => ({ signal: AbortSignal.timeout(ms) })

function runAll(list: Array<() => Promise<unknown>>) {
  return Promise.allSettled(list.map((item) => item()))
}

function showErrors(input: {
  errors: unknown[]
  title: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
}) {
  if (input.errors.length === 0) return
  const message = formatServerError(input.errors[0], input.translate)
  const more = input.errors.length > 1 ? input.formatMoreCount(input.errors.length - 1) : ""
  showToast({
    variant: "error",
    title: input.title,
    description: message + more,
  })
}

export const loadGlobalConfigQuery = (sdk: NovawayClient) =>
  queryOptions({
    queryKey: ["config"],
    queryFn: () => retry(() => sdk.global.config.get(requestDeadline()).then((x) => x.data!)),
  })

export const loadProjectsQuery = (sdk: NovawayClient) =>
  queryOptions({
    queryKey: ["project"],
    queryFn: () =>
      retry(() =>
        sdk.project.list(undefined, requestDeadline()).then((x) => {
          return (x.data ?? [])
            .filter((p) => !!p?.id)
            .filter((p) => !!p.worktree && !p.worktree.includes("NovaWay-test"))
            .slice()
            .sort((a, b) => cmp(a.id, b.id))
        }),
      ),
  })

export async function bootstrapGlobal(input: {
  globalSDK: NovawayClient
  setGlobalStore: SetStoreFunction<GlobalStore>
  queryClient: QueryClient
}) {
  const critical = [
    () => input.queryClient.fetchQuery(loadGlobalConfigQuery(input.globalSDK)),
    () => input.queryClient.fetchQuery(loadPathQuery(null, input.globalSDK)),
    () =>
      input.queryClient
        .fetchQuery(loadProjectsQuery(input.globalSDK))
        // 按 id 复用已有对象：整体替换数组会让侧栏的项目分组连同任务列表全部重建
        // （每次设置自动保存都会触发一次 bootstrap，表现为任务列表持续闪烁）。
        .then((data) => input.setGlobalStore("project", reconcile(data, { key: "id" }))),
  ]
  return (await runAll(critical)).every((result) => result.status === "fulfilled")
}

function groupBySession<T extends { id: string; sessionID: string }>(input: T[]) {
  return input.reduce<Record<string, T[]>>((acc, item) => {
    if (!item?.id || !item.sessionID) return acc
    const list = acc[item.sessionID]
    if (list) list.push(item)
    if (!list) acc[item.sessionID] = [item]
    return acc
  }, {})
}

function projectID(directory: string, projects: Project[]) {
  return projects.find((project) => project.worktree === directory || project.sandboxes?.includes(directory))?.id
}

function mergeSession(setStore: SetStoreFunction<State>, session: Session) {
  setStore("session", (list) => {
    const next = list.slice()
    const idx = next.findIndex((item) => item.id >= session.id)
    if (idx === -1) return [...next, session]
    if (next[idx]?.id === session.id) {
      next[idx] = session
      return next
    }
    next.splice(idx, 0, session)
    return next
  })
}

function warmSessions(input: {
  ids: string[]
  store: Store<State>
  setStore: SetStoreFunction<State>
  sdk: NovawayClient
}) {
  const known = new Set(input.store.session.map((item) => item.id))
  const ids = [...new Set(input.ids)].filter((id) => !!id && !known.has(id))
  if (ids.length === 0) return Promise.resolve()
  return ids.reduce<Promise<void>>(
    (previous, sessionID) => previous.then(async () => {
      const session = (await retry(() => input.sdk.session.get({ sessionID }))).data
      if (session?.id) mergeSession(input.setStore, session)
    }),
    Promise.resolve(),
  )
}

export async function loadSessionActivity(input: {
  sdk: NovawayClient
  store: Store<State>
  setStore: SetStoreFunction<State>
}) {
  const status = await retry(() => input.sdk.session.status().then((x) => x.data ?? {}))
  input.setStore("session_status", reconcile(status))
  const permissions = await retry(() => input.sdk.permission.list().then((x) => x.data ?? []))
  const grouped = groupBySession(permissions.filter((p): p is PermissionRequest => !!p?.id && !!p.sessionID))
  batch(() => {
    for (const id of Object.keys(input.store.permission)) {
      if (!grouped[id]) input.setStore("permission", id, [])
    }
    for (const [id, items] of Object.entries(grouped)) {
      input.setStore("permission", id, reconcile(items.sort((a, b) => cmp(a.id, b.id)), { key: "id" }))
    }
  })
  await warmSessions({ ...input, ids: Object.keys(grouped) })
}

export const loadPluginContributionsQuery = (directory: string, sdk: NovawayClient) =>
  queryOptions({
    queryKey: [directory, "plugin-contributions"],
    queryFn: () => retry(() => sdk.plugin.contributions().then((x) => x.data ?? [])),
  })

export const loadProvidersQuery = (directory: string | null, sdk: NovawayClient) =>
  queryOptions({
    queryKey: [directory, "providers"],
    queryFn: () => retry(() => sdk.provider.list(undefined, requestDeadline(45_000)).then((x) => normalizeProviderList(x.data!))),
  })

/**
 * 供应商目录是全局的（models.dev + 本机 auth），只有项目配置显式改了供应商相关
 * 字段时才需要按目录再拉一次。没有覆盖就不拉 —— 那份列表带全部模型元数据，
 * 一次好几 MB，每个项目各拉一遍是切项目卡顿的主要来源之一。
 */
export function projectProviderOverride(config: Config | undefined) {
  if (!config) return false
  return (
    config.provider !== undefined || config.enabled_providers !== undefined || config.disabled_providers !== undefined
  )
}

export const loadAgentsQuery = (directory: string | null, sdk: NovawayClient) =>
  queryOptions({
    queryKey: [directory, "agents"],
    queryFn: () => retry(() => sdk.app.agents(undefined, requestDeadline()).then((x) => normalizeAgentList(x.data))),
  })

export const loadPathQuery = (directory: string | null, sdk: NovawayClient) =>
  queryOptions<Path>({
    queryKey: [directory, "path"],
    queryFn: () => retry(() => sdk.path.get(undefined, requestDeadline()).then((x) => x.data!)),
  })

export async function bootstrapDirectory(input: {
  directory: string
  sdk: NovawayClient
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  loadSessions: (directory: string) => Promise<void>
  loadActivity: (directory: string) => Promise<void>
  background: (task: () => Promise<unknown>, priority: number) => Promise<unknown>
  translate: (key: string, vars?: Record<string, string | number>) => string
  global: {
    config: Config
    project: Project[]
  }
  queryClient: QueryClient
}) {
  const loading = input.store.status !== "complete"
  const seededProject = projectID(input.directory, input.global.project)
  if (seededProject) input.setStore("project", seededProject)
  if (Object.keys(input.store.config).length === 0 && Object.keys(input.global.config).length > 0) {
    input.setStore("config", reconcile(input.global.config, { merge: false }))
  }
  if (loading) input.setStore("status", "partial")

  return (async () => {
    // 会话列表是首页首屏数据，必须在任何后台资源之前启动。即使后续的
    // agents/MCP/LSP/插件请求很慢，左侧会话仍应先进入 child store。
    const sessionLoad = Promise.resolve().then(() => input.loadSessions(input.directory))

    const slow = [
      () =>
        input.queryClient
          .ensureQueryData(loadAgentsQuery(input.directory, input.sdk))
          .then((data) => input.setStore("agent", data)),
      () =>
        input.queryClient
          .ensureQueryData(loadPluginContributionsQuery(input.directory, input.sdk))
          .then((data) => input.setStore("plugin_contributions", data)),
      () =>
        retry(() => input.sdk.config.get()).then((x) => {
          const config = x.data ?? {}
          input.setStore("config", reconcile(config, { merge: false }))
          if (!projectProviderOverride(config)) {
            if (input.store.provider_project) input.setStore("provider_project", undefined)
            return Promise.resolve()
          }
          return input.queryClient
            .fetchQuery(loadProvidersQuery(input.directory, input.sdk))
            .then((data) => input.setStore("provider_project", reconcile(data)))
        }),
      () => input.loadActivity(input.directory),
      !seededProject &&
        (() => retry(() => input.sdk.project.current()).then((x) => input.setStore("project", x.data!.id))),
      () =>
        input.queryClient.ensureQueryData(loadPathQuery(input.directory, input.sdk)).then((data) => {
          const next = projectID(data.directory ?? input.directory, input.global.project)
          if (next) input.setStore("project", next)
        }),
      () =>
        retry(() =>
          input.sdk.vcs.get().then((x) => {
            const next = x.data ?? input.store.vcs
            input.setStore("vcs", next)
            if (next) input.vcsCache.setStore("value", next)
          }),
        ),
      () => retry(() => input.sdk.command.list().then((x) => input.setStore("command", x.data ?? []))),
      () =>
        retry(() =>
          input.sdk.question.list().then((x) => {
            const ids = (x.data ?? []).map((question) => question?.sessionID).filter((id): id is string => !!id)
            const grouped = groupBySession((x.data ?? []).filter((q): q is QuestionRequest => !!q?.id && !!q.sessionID))
            return warmSessions({ ids, store: input.store, setStore: input.setStore, sdk: input.sdk }).then(() =>
              batch(() => {
                for (const sessionID of Object.keys(input.store.question)) {
                  if (grouped[sessionID]) continue
                  input.setStore("question", sessionID, [])
                }
                for (const [sessionID, questions] of Object.entries(grouped)) {
                  input.setStore(
                    "question",
                    sessionID,
                    reconcile(
                      questions.filter((q) => !!q?.id).sort((a, b) => cmp(a.id, b.id)),
                      { key: "id" },
                    ),
                  )
                }
              }),
            )
          }),
        ),
      () => input.queryClient.fetchQuery(loadMcpQuery(input.directory, input.sdk)),
      () => input.queryClient.fetchQuery(loadLspQuery(input.directory, input.sdk)),
    ].filter(Boolean) as (() => Promise<any>)[]

    const [slowResults, sessionResult] = await Promise.all([
      runAll(slow.map((task) => () => input.background(task, 0))),
      sessionLoad.then<PromiseSettledResult<unknown>, PromiseSettledResult<unknown>>(
        () => ({ status: "fulfilled", value: undefined }),
        (reason) => ({ status: "rejected", reason }),
      ),
    ])
    const slowErrs = errors([...slowResults, sessionResult])
    if (slowErrs.length > 0) {
      console.error("Failed to finish bootstrap instance", slowErrs[0])

      const project = getFilename(input.directory)
      showToast({
        variant: "error",
        title: input.translate("toast.project.reloadFailed.title", { project }),
        description: formatServerError(slowErrs[0], input.translate),
      })
    }

    if (loading) input.setStore("status", "complete")
    return input.store.sessionList !== "error" && slowErrs.length === 0
  })()
}
