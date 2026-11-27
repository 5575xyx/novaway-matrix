import type {
  Config,
  NovawayClient,
  Path,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  Todo,
} from "@novaway/sdk/v2/client"
import { showToast } from "@novaway/ui/toast"
import {
  batch,
  createContext,
  createSignal,
  getOwner,
  onCleanup,
  onMount,
  type ParentProps,
  untrack,
  useContext,
} from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import { useServer } from "./server"
import { createBackgroundQueue, scheduleIdle } from "./global-sync/background"
import {
  bootstrapDirectory,
  bootstrapGlobal,
  loadAgentsQuery,
  loadGlobalConfigQuery,
  loadPathQuery,
  loadPluginContributionsQuery,
  loadProjectsQuery,
  loadProvidersQuery,
  loadSessionActivity,
  projectProviderOverride,
} from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./global-sync/event-reducer"
import { invalidateMemoryEvolutionQueries } from "./global-sync/memory-evolution-events"
import { clearSessionPrefetchDirectory } from "./global-sync/session-prefetch"
import { estimateRootSessionTotal, loadRootSessionsWithFallback, SessionListError } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
import { queryOptions, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createRefreshQueue } from "./global-sync/queue"
import { directoryKey } from "./global-sync/utils"
import { PathKey } from "@/utils/path-key"
import { createFrameBatch } from "@/utils/frame-batch"
import { sessionLibraryOf } from "@/utils/server-health"

type GlobalStore = {
  ready: boolean
  error?: InitError
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

export const loadMcpQuery = (directory: string, sdk: NovawayClient) =>
  queryOptions({
    queryKey: [directory, "mcp"] as const,
    queryFn: () => sdk.mcp.status().then((r) => r.data ?? {}),
  })

export const loadLspQuery = (directory: string, sdk: NovawayClient) =>
  queryOptions({
    queryKey: [directory, "lsp"] as const,
    queryFn: () => sdk.lsp.status().then((r) => r.data ?? []),
  })

function makeQueryOptionsApi(globalSDK: () => NovawayClient, sdkFor: (dir: PathKey) => NovawayClient) {
  return {
    globalConfig: () => loadGlobalConfigQuery(globalSDK()),
    projects: () => loadProjectsQuery(globalSDK()),
    providers: (directory: PathKey | null) =>
      loadProvidersQuery(directory, directory === null ? globalSDK() : sdkFor(directory)),
    path: (directory: PathKey | null) => loadPathQuery(directory, directory === null ? globalSDK() : sdkFor(directory)),
    agents: (directory: PathKey) => loadAgentsQuery(directory, sdkFor(directory)),
    contributions: (directory: PathKey) => loadPluginContributionsQuery(directory, sdkFor(directory)),
    mcp: (directory: PathKey) => loadMcpQuery(directory, sdkFor(directory)),
    lsp: (directory: PathKey) => loadLspQuery(directory, sdkFor(directory)),
    sessions: (directory: PathKey) => ({ queryKey: [directory, "loadSessions"] as const }),
  }
}
export type QueryOptionsApi = ReturnType<typeof makeQueryOptionsApi>

function createGlobalSync(sessionCacheIdentity?: string) {
  const globalSDK = useGlobalSDK()
  const server = useServer()
  const language = useLanguage()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSync must be created within owner")

  const sdkCache = new Map<string, NovawayClient>()
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const activityLoads = new Map<string, Promise<void>>()
  const activityLoaded = new Set<string>()
  const sessionMeta = new Map<string, { limit: number; loadedAt: number }>()
  // SSE 是实时更新的主路径，但不能成为会话列表一致性的唯一保障：
  // 连接重连、后台进程重启或事件丢失后，单纯按 limit 跳过刷新会让昨天新建的会话永远不出现在侧栏。
  const SESSION_REFRESH_TTL = 15_000
  const background = createBackgroundQueue({ concurrency: 2, schedule: scheduleIdle })
  onCleanup(background.dispose)
  const resourceLoads = new Map<string, { label: string; queued: boolean }>()
  const resourceCompleted = new Set<string>()
  const resourceFailed = new Map<string, string>()
  const warmups = new Map<string, Promise<unknown>>()
  const [resourceRevision, bumpResourceRevision] = createSignal(0)
  const [failedStartupMessage, setFailedStartupMessage] = createSignal<string>()
  const [visibleSessionView, setVisibleSessionView] = createSignal<string>()
  const sessionViewKey = (directory: string, id?: string) => JSON.stringify([directoryKey(directory), id ?? ""])


  const beginResourceLoad = (key: string, label: string, queued = false) => {
    resourceLoads.set(key, { label, queued })
    resourceCompleted.delete(key)
    resourceFailed.delete(key)
    bumpResourceRevision((revision) => revision + 1)
  }

  const finishResourceLoad = (key: string, success = true) => {
    const label = resourceLoads.get(key)
    if (!label) return
    resourceLoads.delete(key)
    if (success) resourceCompleted.add(key)
    else resourceFailed.set(key, label.label)
    bumpResourceRevision((revision) => revision + 1)
  }

  function warmResource(key: string, label: string, task: () => Promise<unknown>, priority?: number) {
    const pending = warmups.get(key)
    if (pending) return pending
    const request = background.run(async () => {
      beginResourceLoad(key, label)
      try {
        await task()
        return true
      } catch (error) {
        console.warn("Resource warmup failed", label, error)
        return false
      }
    }, priority).then((success) => {
      warmups.delete(key)
      finishResourceLoad(key, success === true)
      return success
    })
    warmups.set(key, request)
    beginResourceLoad(key, label, true)
    return request
  }
  // Solid child stores are normally sufficient to invalidate the mode memo. Keep
  // an explicit revision as well because Agent refreshes can happen from an SSE
  // callback outside the computation that first created a child store.
  const [agentRevision, bumpAgentRevision] = createSignal(0)

  const sdkFor = (directory: string) => {
    const key = directoryKey(directory)
    const cached = sdkCache.get(key)
    if (cached) return cached
    const sdk = globalSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(key, sdk)
    return sdk
  }

  const queryOptionsApi = makeQueryOptionsApi(() => globalSDK.client, sdkFor)

  const [configQuery, providerQuery, pathQuery] = useQueries(() => ({
    queries: [
      queryOptionsApi.globalConfig(),
      // The active workspace releases this fetch only once first-screen data is available.
      { ...queryOptionsApi.providers(null), enabled: false },
      queryOptionsApi.path(null),
    ],
  }))

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    get ready() {
      return !bootstrap.isPending
    },
    project: [],
    session_todo: {},
    provider_auth: {},
    get path() {
      const EMPTY = { state: "", config: "", worktree: "", directory: "", home: "" }
      if (pathQuery.isLoading) return EMPTY
      return pathQuery.data ?? EMPTY
    },
    get provider() {
      const EMPTY = { all: [], connected: [], default: {} }
      if (providerQuery.isLoading) return EMPTY
      return providerQuery.data ?? EMPTY
    },
    get config() {
      if (configQuery.isLoading) return {}
      return configQuery.data ?? {}
    },
    get reload() {
      return updateConfigMutation.isPending ? "pending" : undefined
    },
  })
  const queryClient = useQueryClient()

  let bootedAt = 0
  let bootingRoot = false
  let eventFrame: number | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (eventFrame !== undefined) cancelAnimationFrame(eventFrame)
    if (eventTimer !== undefined) clearTimeout(eventTimer)
  })

  const setProjects = (next: Project[] | ((draft: Project[]) => Project[])) => {
    setGlobalStore("project", next)
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjects(input[1] as Project[])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const bootstrap = useQuery(() => ({
    queryKey: ["bootstrap"],
    queryFn: async () => {
      beginResourceLoad("global:critical", "首页核心资源")
      let success = false
      try {
        success = await bootstrapGlobal({
          globalSDK: globalSDK.client,
          setGlobalStore: setBootStore,
          queryClient,
        })
        void warmResource("global:providers", "供应商与模型目录", () => loadProviders(), 0)
      } finally {
        finishResourceLoad("global:critical", success)
      }
      bootedAt = Date.now()
      return bootedAt
    },
  }))

  const loadProviders = () => queryClient.fetchQuery({ ...queryOptionsApi.providers(null), staleTime: 30_000 })

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => Project[]))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const setSessionTodo = (sessionID: string, todos: Todo[] | undefined) => {
    if (!sessionID) return
    if (!todos) {
      setGlobalStore(
        "session_todo",
        produce((draft) => {
          delete draft[sessionID]
        }),
      )
      return
    }
    setGlobalStore("session_todo", sessionID, reconcile(todos, { key: "id" }))
  }

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    key: directoryKey,
    bootstrap: () => queryClient.fetchQuery({ queryKey: ["bootstrap"] }),
    bootstrapInstance: refreshInstance,
  })

  const [cacheIdentity, setCacheIdentity] = createSignal(sessionCacheIdentity)
  if (!sessionCacheIdentity) {
    // Web embeds deliberately skip the blocking health gate. Discover the
    // namespace in parallel without delaying the real workspace list.
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 3_000)
    void globalSDK.client.global.health({ signal: abort.signal }).then((result) => {
      if (!abort.signal.aborted) setCacheIdentity(sessionLibraryOf(result.data))
    }).catch(() => undefined).finally(() => clearTimeout(timer))
    onCleanup(() => { clearTimeout(timer); abort.abort() })
  }

  const children = createChildStoreManager({
    owner,
    sessionCacheScope: () => {
      const identity = cacheIdentity()
      return identity ? JSON.stringify([server.key, identity]) : undefined
    },
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      const key = directoryKey(directory)
      queue.clear(key)
      sessionMeta.delete(key)
      activityLoaded.delete(key)
      sdkCache.delete(key)
      clearSessionPrefetchDirectory(key)
    },
    translate: language.t,
    queryOptions: queryOptionsApi,
    global: {
      provider: () => globalStore.provider,
    },
  })

  /**
   * 供应商目录刷新（`catalog.updated`）：全局目录由查询缓存统一失效；
   * 目录自己只在项目配置有覆盖时才需要重拉，否则读全局就够了。
   */
  async function refreshProjectProviders(directory: string) {
    const key = directoryKey(directory)
    const [store, setStore] = children.peek(directory, { bootstrap: false })
    if (!projectProviderOverride(store.config)) return
    const data = await queryClient.fetchQuery(queryOptionsApi.providers(key)).catch(() => undefined)
    if (!data) return
    setStore("provider_project", reconcile(data))
  }

  function loadSessions(directory: string) {
    const key = directoryKey(directory)
    if (!key) return Promise.resolve()
    const pending = sessionLoads.get(key)
    if (pending) return pending

    // Reserve before touching reactive state. Desktop IPC and the network race independently.
    let pinned = false
    const promise = Promise.resolve().then(async () => {
      children.pin(key)
      pinned = true
      const [store, setStore] = children.ensureChild(directory)
      const meta = sessionMeta.get(key)
      const visibleLimit = store.limit
      if (meta && meta.limit >= visibleLimit && Date.now() - meta.loadedAt < SESSION_REFRESH_TTL) {
        const next = trimSessions(store.session, { limit: visibleLimit, permission: store.permission })
        if (next.length !== store.session.length) {
          setStore("session", reconcile(next, { key: "id" }))
          cleanupDroppedSessionCaches(store, setStore, next, setSessionTodo, pinnedSessions)
        }
        return
      }

      setStore("sessionList", "loading")
      const limit = Math.max(visibleLimit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
      try {
        const result = await queryClient.fetchQuery({
          ...queryOptionsApi.sessions(key),
          retry: false,
          queryFn: () => loadRootSessionsWithFallback({
            directory,
            limit,
            list: async (query) => {
              const result = await globalSDK.client.session.list(query, {
                throwOnError: false,
                signal: AbortSignal.timeout(15_000),
              })
              if (!result.response.ok) throw new SessionListError(result.response.status)
              return result
            },
          }),
        })
        const nonArchived = (result.data ?? [])
          .filter((s) => s?.id && !s.time?.archived)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        const childSessions = store.session.filter((s) => !!s.parentID)
        const sessions = trimSessions([...nonArchived, ...childSessions], {
          limit: store.limit,
          permission: store.permission,
        })
        sessionMeta.set(key, { limit: visibleLimit, loadedAt: Date.now() })
        batch(() => {
          setStore("sessionList", "ready")
          setStore("sessionListAvailable", true)
          setStore("sessionTotal", estimateRootSessionTotal({
            count: nonArchived.length,
            limit: result.limit,
            limited: result.limited,
          }))
          setStore("session", reconcile(sessions, { key: "id" }))
          cleanupDroppedSessionCaches(store, setStore, sessions, setSessionTodo, pinnedSessions)
        })
        children.setSessions(directory, sessions)
      } catch (error) {
        setStore("sessionList", "error")
        console.warn("Failed to refresh sessions", directory, error)
      }
    }).finally(() => {
      sessionLoads.delete(key)
      if (pinned) children.unpin(key)
    })
    sessionLoads.set(key, promise)
    return promise
  }

  /**
   * Reconcile one directory after a plugin installation or activation.
   *
   * Marketplace installs can finish before the session's initial bootstrap has
   * populated its child store.  In that window the workbench picker may already
   * be visible (from the mode discovery request), while PromptInput still sees
   * the old agent list and incorrectly tells the user to install the plugin.
   * Keep this repair path in the shared sync layer so every consumer updates the
   * same child store instead of maintaining a second, stale agent snapshot.
   */
  async function refreshDirectory(directory: string) {
    const key = directoryKey(directory)
    if (!key) return
    const [store, setStore] = children.child(directory, { bootstrap: false })
    await sdkFor(directory)
      .extension.reload({ directory })
      .catch(() => undefined)
    const [agents, contributions, commands] = await Promise.all([
      queryClient
        .invalidateQueries({ queryKey: queryOptionsApi.agents(key).queryKey })
        .then(() => queryClient.fetchQuery(queryOptionsApi.agents(key)))
        .catch(() => undefined),
      queryClient
        .invalidateQueries({ queryKey: queryOptionsApi.contributions(key).queryKey })
        .then(() => queryClient.fetchQuery(queryOptionsApi.contributions(key)))
        .catch(() => undefined),
      sdkFor(directory)
        .command.list()
        .then((response) => response.data ?? [])
        .catch(() => undefined),
    ])
    batch(() => {
      if (agents) setStore("agent", agents)
      if (contributions) setStore("plugin_contributions", contributions)
      if (commands) setStore("command", commands)
      if (agents) bumpAgentRevision((revision) => revision + 1)
    })
  }

  function loadActivity(directory: string) {
    const key = directoryKey(directory)
    const pending = activityLoads.get(key)
    if (pending) return pending
    if (activityLoaded.has(key)) return Promise.resolve()
    const request = Promise.resolve().then(async () => {
      const [store, setStore] = children.ensureChild(directory)
      const sdk = sdkFor(directory)
      if (key === "global-chat") {
        setStore("session_status", reconcile((await sdk.session.status()).data ?? {}))
      } else {
        await loadSessionActivity({ sdk, store, setStore })
      }
      activityLoaded.add(key)
    }).finally(() => {
      activityLoads.delete(key)
      children.unpin(key)
    })
    children.pin(key)
    activityLoads.set(key, request)
    return request
  }

  function refreshInstance(directory: string) {
    const key = directoryKey(directory)
    sessionMeta.delete(key)
    activityLoaded.delete(key)
    if (children.children[key]?.[0].status !== "loading") return bootstrapInstance(directory)
    return background.run(async () => {
      await loadSessions(directory)
      await loadActivity(directory)
    }, 1).then(() => undefined, (error) => { console.warn("Failed to refresh task status", error) })
  }

  async function warmAgents(directory: string) {
    const key = directoryKey(directory)
    if (!key) return
    const data = await queryClient.ensureQueryData(queryOptionsApi.agents(key))
    const [store, setStore] = children.ensureChild(directory)
    if (store.agent === data) return
    setStore("agent", data)
  }

  async function bootstrapInstance(directory: string) {
    const key = directoryKey(directory)
    if (!key) return
    const pending = booting.get(key)
    if (pending) return pending

    children.pin(key)
    beginResourceLoad(
      `directory:${key}`,
      key === "global-chat"
        ? "全局会话资源"
        : `工作区：${directory.split(/[\\/]/).filter(Boolean).pop() ?? "当前项目"}`,
    )
    let success = false
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(key)
      if (!cache) return
      const sdk = sdkFor(directory)
      if (directory === "global-chat") {
        await loadSessions(directory)
        success = (await background.run(async () => {
          const data = await queryClient.ensureQueryData(loadAgentsQuery(directory, sdk))
          child[1]("agent", data)
          bumpAgentRevision((revision) => revision + 1)
          await loadActivity(directory)
          return true
        }, 0)) === true && child[0].sessionList !== "error"
        child[1]("status", "complete")
        return
      }
      success = await bootstrapDirectory({
        directory,
        global: {
          config: globalStore.config,
          project: globalStore.project,
        },
        sdk,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        loadSessions,
        loadActivity,
        background: background.run,
        translate: language.t,
        queryClient,
      })
      bumpAgentRevision((revision) => revision + 1)
    }).catch((error) => {
      console.warn("Failed to refresh workspace", directory, error)
    }).finally(() => {
      finishResourceLoad(`directory:${key}`, success)
      booting.delete(key)
      children.unpin(key)
    })
    booting.set(key, promise)
    return promise
  }

  const processEvent = (directory: string, event: { type: string; properties?: unknown }) => {
    const key = directoryKey(directory)
    const recent = bootingRoot || Date.now() - bootedAt < 1500

    invalidateMemoryEvolutionQueries(queryClient, event)

    if (event.type === "evolution.autoApplyFileFailed") {
      const props = event.properties as { candidateID: string; message?: string }
      showToast({
        variant: "error",
        icon: "warning",
        title: language.t("evolution.autoApplyFileFailed.title" as never),
        description: language.t("evolution.autoApplyFileFailed.description" as never, {
          candidate: props.candidateID,
          message: props.message ?? "",
        }),
      })
    }

    if (directory === "global") {
      if (event.type === "plugin.changed") {
        // 插件安装/启停/卸载通常通过 global 目录广播。它没有对应的项目
        // child event，因此必须主动刷新所有已知项目的 Agent、命令和 Surface，
        // 否则左上角工作台和左侧插件入口会等到下次打开项目才更新。
        const directories = new Set(globalStore.project.map((project) => project.worktree))
        for (const projectDirectory of directories) {
          const projectKey = directoryKey(projectDirectory)
          const existing = children.children[projectKey]
          if (!existing) {
            void bootstrapInstance(projectDirectory)
            continue
          }

          const [store, setStore] = existing
          const props = event.properties as { pluginID?: string; enabled?: boolean }
          if (props.pluginID && props.enabled === false) {
            setStore(
              "plugin_contributions",
              store.plugin_contributions.filter((item) => item.pluginID !== props.pluginID),
            )
          }
          void sdkFor(projectDirectory)
            .extension.reload({ directory: projectDirectory })
            .catch(() => undefined)
            .then(() =>
              queryClient
                .invalidateQueries({ queryKey: queryOptionsApi.agents(projectKey).queryKey })
                .then(() => queryClient.fetchQuery(queryOptionsApi.agents(projectKey)))
                .then((data) => {
                  setStore("agent", data)
                  bumpAgentRevision((revision) => revision + 1)
                }),
            )
          void sdkFor(projectDirectory)
            .extension.contributions({ directory: projectDirectory })
            .catch(() => undefined)
            .then(() =>
              queryClient
                .invalidateQueries({ queryKey: queryOptionsApi.contributions(projectKey).queryKey })
                .then(() => queryClient.fetchQuery(queryOptionsApi.contributions(projectKey)))
                .then((data) => setStore("plugin_contributions", data)),
            )
          void sdkFor(projectDirectory)
            .command.list()
            .then((response) => setStore("command", response.data ?? []))
        }
      }

      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          // 重连需要整体对账（断线期间的事件全丢了）；而 global.disposed 只是服务端
          // 销毁了实例，项目元数据没变 —— 设置页每次自动保存都会发这条事件，
          // 跟着重拉整个 bootstrap 会让侧栏项目/任务列表反复重建。这里只重拉配置。
          if (event.type === "server.connected") {
            bootstrap.refetch()
            return
          }
          void queryClient.invalidateQueries({ queryKey: ["config"] })
        },
        setGlobalProject: setProjects,
      })
      if (event.type === "server.connected" || event.type === "global.disposed") {
        if (recent) return
        // 供应商（含 connected 列表）是按目录缓存的查询，实例销毁后必须失效：
        // 否则"断开连接"成功后，设置页读到的仍是旧缓存，卡片继续显示已连接。
        void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === "providers" })
        for (const directory of Object.keys(children.children)) {
          queue.push(directory)
        }
      }
      return
    }

    const existing = children.children[key]
    if (!existing) return
    children.mark(key)
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: queue.push,
      setSessionTodo,
      pinnedSessions,
      vcsCache: children.vcsCache.get(key),
      loadLsp: () => {
        void queryClient.fetchQuery(queryOptionsApi.lsp(key))
      },
      loadAgents: () => {
        void queryClient
          .invalidateQueries({ queryKey: queryOptionsApi.agents(key).queryKey })
          .then(() => queryClient.fetchQuery(queryOptionsApi.agents(key)))
          .then((data) => {
            setStore("agent", data)
            bumpAgentRevision((revision) => revision + 1)
          })
      },
      loadCommands: () => {
        void sdkFor(directory)
          .command.list()
          .then((response) => setStore("command", response.data ?? []))
      },
      loadContributions: () => {
        void queryClient
          .invalidateQueries({ queryKey: queryOptionsApi.contributions(key).queryKey })
          .then(() => queryClient.fetchQuery(queryOptionsApi.contributions(key)))
          .then((data) => setStore("plugin_contributions", data))
      },
      loadProviders: () => {
        // 目录级事件里说的"目录变了"其实来自全局模型目录（免费模型 live 发现），
        // 全局那份查询失效即可让所有目录跟着更新；项目有覆盖时再单独重拉。
        void queryClient.invalidateQueries({ queryKey: [null, "providers"] })
        void refreshProjectProviders(directory)
      },
    })
  }

  // Keep event bursts frame-batched while preserving event order.
  const eventBatch = createFrameBatch<{ directory: string; event: { type: string; properties?: unknown } }>((items) => {
    batch(() => {
      for (const item of items) processEvent(item.directory, item.event)
    })
  })
  const unsub = globalSDK.event.listen((event) => {
    eventBatch.push({ directory: event.name, event: event.details })
  })

  onCleanup(eventBatch.cancel)
  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directoryKey(directory))
    }
  })

  onMount(() => {
    if (typeof requestAnimationFrame === "function") {
      eventFrame = requestAnimationFrame(() => {
        eventFrame = undefined
        eventTimer = setTimeout(() => {
          eventTimer = undefined
          void globalSDK.event.start()
        }, 0)
      })
    } else {
      eventTimer = setTimeout(() => {
        eventTimer = undefined
        void globalSDK.event.start()
      }, 0)
    }
  })

  // 用户正在查看的会话。服务端 session.updated 心跳到达时,event-reducer 会按 store.limit(初始仅 5)
  // 裁剪会话列表,再把不在裁剪结果里的会话缓存整个删掉(session-cache.ts 的 delete store.message[id]);
  // 若被删的正是正在看的那个,消息区会清空再拉回,表现为每隔几秒闪一下。这里登记"正在看"以豁免清理。
  const pinnedSessions = new Set<string>()

  const projectApi = {
    loadSessions,
    loadActivity,
    /**
     * 重新拉一次项目元数据（`bootstrap` 是 `data.project` 的唯一来源）。
     *
     * Git 初始化之类的操作会改掉 project.vcs，但服务端只广播 `project.updated` 里那一条
     * 项目记录 —— 侧栏读的是「按目录匹配到的项目元数据」，需要整体刷新才会跟着变。
     */
    refresh() {
      bootstrap.refetch()
    },
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const updateConfigMutation = useMutation(() => ({
    mutationFn: (config: Config) => globalSDK.client.global.config.update({ config }),
    onSuccess: () => {
      // 只重拉全局配置本身。以前这里 refetch 整个 bootstrap，会把 project 列表、
      // path、provider 全部重下一次 —— 设置页每次自动保存都触发一遍，侧栏任务列表
      // 跟着整块重建（用户看到的「一操作就闪」）。目录侧的重载由服务端的
      // global.disposed 事件负责，这里不需要重复。
      void queryClient.invalidateQueries({ queryKey: ["config"] })
      // Invalidate all provider queries so newly configured custom providers
      // appear immediately in the available provider list across all directories.
      queryClient.invalidateQueries({ queryKey: [null, "providers"] })
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[1] === "providers",
      })
      // 服务端写配置后会销毁全部实例并广播 global.disposed；那条事件到达时
      // 本 mutation 还在 pending，刷新队列是暂停的，推入的目录会被压着不跑。
      // 保存完成后再推一次，让各目录按新配置重新 bootstrap。
      for (const directory of Object.keys(children.children)) queue.push(directory)
    },
  }))

  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    warmResource,
    warmAgents,
    background,
    messageLoadFailed(directory: string, id: string) {
      return failedStartupMessage() === sessionViewKey(directory, id)
    },
    setMessageLoadFailed(directory: string, id: string, failed: boolean) {
      const key = sessionViewKey(directory, id)
      setFailedStartupMessage((previous) => failed ? key : previous === key ? undefined : previous)
    },
    isSessionViewVisible(directory: string, id?: string) {
      return visibleSessionView() === sessionViewKey(directory, id)
    },
    markSessionViewVisible(directory: string, id?: string) {
      const key = sessionViewKey(directory, id)
      setVisibleSessionView(key)
      return () => setVisibleSessionView((visible) => visible === key ? undefined : visible)
    },
    loadProviders,
    get resourceStatus() {
      resourceRevision()
      const active = [...resourceLoads.values()].filter((item) => !item.queued).map((item) => item.label)
      const queued = resourceLoads.size - active.length
      return {
        loading: !globalStore.ready || resourceLoads.size > 0,
        queued,
        failed: [...resourceFailed.values()],
        active,
        completed: resourceCompleted.size,
        total: resourceLoads.size + resourceCompleted.size + resourceFailed.size,
      }
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    readDirectory(directory: string) {
      return children.children[directoryKey(directory)]?.[0]
    },
    directories: children.directories,
    agentRevision,
    peek: children.peek,
    bootstrapInstance,
    refreshDirectory,
    queryOptions: queryOptionsApi,
    sdkForDirectory: sdkFor,
    // bootstrap,
    updateConfig: updateConfigMutation.mutateAsync,
    project: projectApi,
    session: {
      pin(id: string) {
        if (id) pinnedSessions.add(id)
      },
      unpin(id: string) {
        pinnedSessions.delete(id)
      },
    },
    todo: {
      set: setSessionTodo,
    },
  }
}

const GlobalSyncContext = createContext<ReturnType<typeof createGlobalSync>>()

export function GlobalSyncProvider(props: ParentProps<{ sessionCacheIdentity?: string }>) {
  const value = createGlobalSync(props.sessionCacheIdentity)
  return <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}

export function useQueryOptions() {
  return useGlobalSync().queryOptions
}
