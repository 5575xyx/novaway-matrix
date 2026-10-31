import type {
  Config,
  OpencodeClient,
  Path,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  Todo,
} from "@novaway/sdk/v2/client"
import { showToast } from "@novaway/ui/toast"
import { batch, createContext, getOwner, onCleanup, onMount, type ParentProps, untrack, useContext } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import {
  bootstrapDirectory,
  bootstrapGlobal,
  clearProviderRev,
  loadAgentsQuery,
  loadGlobalConfigQuery,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
} from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./global-sync/event-reducer"
import { invalidateMemoryEvolutionQueries } from "./global-sync/memory-evolution-events"
import { clearSessionPrefetchDirectory } from "./global-sync/session-prefetch"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
import { queryOptions, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createRefreshQueue } from "./global-sync/queue"
import { directoryKey } from "./global-sync/utils"
import { PathKey } from "@/utils/path-key"

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

export const loadMcpQuery = (directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "mcp"] as const,
    queryFn: () => sdk.mcp.status().then((r) => r.data ?? {}),
  })

export const loadLspQuery = (directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "lsp"] as const,
    queryFn: () => sdk.lsp.status().then((r) => r.data ?? []),
  })

function makeQueryOptionsApi(globalSDK: () => OpencodeClient, sdkFor: (dir: PathKey) => OpencodeClient) {
  return {
    globalConfig: () => loadGlobalConfigQuery(globalSDK()),
    projects: () => loadProjectsQuery(globalSDK()),
    providers: (directory: PathKey | null) =>
      loadProvidersQuery(directory, directory === null ? globalSDK() : sdkFor(directory)),
    path: (directory: PathKey | null) => loadPathQuery(directory, directory === null ? globalSDK() : sdkFor(directory)),
    agents: (directory: PathKey) => loadAgentsQuery(directory, sdkFor(directory)),
    mcp: (directory: PathKey) => loadMcpQuery(directory, sdkFor(directory)),
    lsp: (directory: PathKey) => loadLspQuery(directory, sdkFor(directory)),
    sessions: (directory: PathKey) => ({ queryKey: [directory, "loadSessions"] as const }),
  }
}
export type QueryOptionsApi = ReturnType<typeof makeQueryOptionsApi>

function createGlobalSync() {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSync must be created within owner")

  const sdkCache = new Map<string, OpencodeClient>()
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number }>()

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
    queries: [queryOptionsApi.globalConfig(), queryOptionsApi.providers(null), queryOptionsApi.path(null)],
  }))

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    get ready() {
      return bootstrap.isPending
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
      await bootstrapGlobal({
        globalSDK: globalSDK.client,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
        queryClient,
      })
      bootedAt = Date.now()
      return bootedAt
    },
  }))

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
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      const key = directoryKey(directory)
      queue.clear(key)
      sessionMeta.delete(key)
      sdkCache.delete(key)
      clearProviderRev(key)
      clearSessionPrefetchDirectory(key)
    },
    translate: language.t,
    queryOptions: queryOptionsApi,
    global: {
      provider: globalStore.provider,
    },
  })

  async function loadSessions(directory: string) {
    const key = directoryKey(directory)
    const pending = sessionLoads.get(key)
    if (pending) return pending

    children.pin(key)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    const meta = sessionMeta.get(key)
    if (meta && meta.limit >= store.limit) {
      const next = trimSessions(store.session, {
        limit: store.limit,
        permission: store.permission,
      })
      if (next.length !== store.session.length) {
        setStore("session", reconcile(next, { key: "id" }))
        cleanupDroppedSessionCaches(store, setStore, next, setSessionTodo)
      }
      children.unpin(key)
      return
    }

    const limit = Math.max(store.limit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
    const promise = queryClient
      .fetchQuery({
        ...queryOptionsApi.sessions(key),
        queryFn: () =>
          loadRootSessionsWithFallback({
            directory,
            limit,
            list: (query) => globalSDK.client.session.list(query),
          })
            .then((x) => {
              const nonArchived = (x.data ?? [])
                .filter((s) => !!s?.id)
                .filter((s) => !s.time?.archived)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              const limit = store.limit
              const childSessions = store.session.filter((s) => !!s.parentID)
              const sessions = trimSessions([...nonArchived, ...childSessions], {
                limit,
                permission: store.permission,
              })
              batch(() => {
                setStore(
                  "sessionTotal",
                  estimateRootSessionTotal({
                    count: nonArchived.length,
                    limit: x.limit,
                    limited: x.limited,
                  }),
                )
                setStore("session", reconcile(sessions, { key: "id" }))
                cleanupDroppedSessionCaches(store, setStore, sessions, setSessionTodo)
              })
              sessionMeta.set(key, { limit })
            })
            .catch((err) => {
              // 侧栏会话列表是后台刷新,失败只落日志不弹 toast:服务重启/网络抖动的
              // 瞬时失败会按项目各弹一条,打断正在看聊天的用户;真正不可用时全局
              // 连接状态已另有提示。
              console.error("Failed to load sessions", directory, err)
            })
            .then(() => null),
      })
      .then(() => {})

    sessionLoads.set(key, promise)
    void promise.finally(() => {
      sessionLoads.delete(key)
      children.unpin(key)
    })
    return promise
  }

  async function bootstrapInstance(directory: string) {
    const key = directoryKey(directory)
    if (!key) return
    const pending = booting.get(key)
    if (pending) return pending

    children.pin(key)
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(key)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        global: {
          config: globalStore.config,
          path: globalStore.path,
          project: globalStore.project,
          provider: globalStore.provider,
        },
        sdk,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        loadSessions,
        translate: language.t,
        queryClient,
      })
    })

    booting.set(key, promise)
    void promise.finally(() => {
      booting.delete(key)
      children.unpin(key)
    })
    return promise
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name
    const key = directoryKey(directory)
    const event = e.details
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
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          bootstrap.refetch()
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
      loadProviders: () => {
        void queryClient.fetchQuery(queryOptionsApi.providers(key))
      },
    })
  })

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
      bootstrap.refetch()
      // Invalidate all provider queries so newly configured custom providers
      // appear immediately in the available provider list across all directories.
      queryClient.invalidateQueries({ queryKey: [null, "providers"] })
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[1] === "providers",
      })
    },
  }))

  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    peek: children.peek,
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

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
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
