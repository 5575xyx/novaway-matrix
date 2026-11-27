import { batch, createEffect, createRoot, getOwner, onCleanup, runWithOwner, untrack, type Owner } from "solid-js"
import { createStore, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import type { ProviderListResponse, Session, VcsInfo } from "@novaway/sdk/v2/client"
import {
  DIR_IDLE_TTL_MS,
  MAX_DIR_STORES,
  SESSION_LIST_LIMIT,
  type ChildOptions,
  type DirState,
  type IconCache,
  type MetaCache,
  type ProjectMeta,
  type State,
  type VcsCache,
} from "./types"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./eviction"
import { useQueries } from "@tanstack/solid-query"
import { QueryOptionsApi } from "../global-sync"
import { directoryKey, type DirectoryKey } from "./utils"
import { hydrateStartupSessionRows } from "./session-load"

type SessionCache = SetStoreFunction<{ value: Session[] }>

export function createChildStoreManager(input: {
  owner: Owner
  sessionCacheScope?: () => string | undefined
  isBooting: (directory: string) => boolean
  isLoadingSessions: (directory: string) => boolean
  onBootstrap: (directory: string) => void
  onDispose: (directory: string) => void
  translate: (key: string, vars?: Record<string, string | number>) => string
  queryOptions: QueryOptionsApi
  global: {
    /** 全局供应商目录（bootstrap 一次拉全量，目录只是它的一个可能覆盖）。 */
    provider: () => ProviderListResponse
  }
}) {
  const children: Record<string, [Store<State>, SetStoreFunction<State>]> = {}
  const vcsCache = new Map<string, VcsCache>()
  const metaCache = new Map<string, MetaCache>()
  const iconCache = new Map<string, IconCache>()
  const sessionCache = new Map<string, SessionCache>()
  const verifiedSessions = new Set<string>()
  const lifecycle = new Map<string, DirState>()
  const pins = new Map<string, number>()
  const ownerPins = new WeakMap<object, Set<string>>()
  const disposers = new Map<string, () => void>()

  const markKey = (key: DirectoryKey) => {
    if (!key) return
    lifecycle.set(key, { lastAccessAt: Date.now() })
    runEviction(key)
  }

  const mark = (directory: string) => {
    const key = directoryKey(directory)
    markKey(key)
  }

  const pin = (directory: string) => {
    const key = directoryKey(directory)
    if (!key) return
    pins.set(key, (pins.get(key) ?? 0) + 1)
    markKey(key)
  }

  const unpin = (directory: string) => {
    const key = directoryKey(directory)
    if (!key) return
    const next = (pins.get(key) ?? 0) - 1
    if (next > 0) {
      pins.set(key, next)
      return
    }
    pins.delete(key)
    runEviction()
  }

  const pinned = (directory: string) => (pins.get(directoryKey(directory)) ?? 0) > 0

  const pinForOwner = (directory: string) => {
    const current = getOwner()
    if (!current) return
    if (current === input.owner) return
    const key = current as object
    const set = ownerPins.get(key)
    if (set?.has(directory)) return
    if (set) set.add(directory)
    if (!set) ownerPins.set(key, new Set([directory]))
    pin(directory)
    onCleanup(() => {
      const set = ownerPins.get(key)
      if (set) {
        set.delete(directory)
        if (set.size === 0) ownerPins.delete(key)
      }
      unpin(directory)
    })
  }

  function disposeDirectory(directory: DirectoryKey) {
    const key = directory
    if (
      !canDisposeDirectory({
        directory: key,
        hasStore: !!children[key],
        pinned: pinned(key),
        booting: input.isBooting(key),
        loadingSessions: input.isLoadingSessions(key),
      })
    ) {
      return false
    }

    vcsCache.delete(key)
    metaCache.delete(key)
    iconCache.delete(key)
    sessionCache.delete(key)
    verifiedSessions.delete(key)
    lifecycle.delete(key)
    const dispose = disposers.get(key)
    if (dispose) {
      dispose()
      disposers.delete(key)
    }
    delete children[key]
    input.onDispose(key)
    return true
  }

  function runEviction(skip?: string) {
    const stores = Object.keys(children)
    if (stores.length === 0) return
    const list = pickDirectoriesToEvict({
      stores,
      state: lifecycle,
      pins: new Set(stores.filter(pinned)),
      max: MAX_DIR_STORES,
      ttl: DIR_IDLE_TTL_MS,
      now: Date.now(),
    }).filter((directory) => directory !== skip)
    if (list.length === 0) return
    for (const directory of list) {
      if (!disposeDirectory(directoryKey(directory))) continue
    }
  }

  function ensureChild(directory: string) {
    const key = directoryKey(directory)
    if (!key) console.error("No directory provided")
    if (!children[key]) {
      const vcs = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "vcs", ["vcs.v1"]),
          createStore({ value: undefined as VcsInfo | undefined }),
        ),
      )
      if (!vcs) throw new Error(input.translate("error.childStore.persistedCacheCreateFailed"))
      const vcsStore = vcs[0]
      vcsCache.set(key, { store: vcsStore, setStore: vcs[1], ready: vcs[3] })

      const meta = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "project", ["project.v1"]),
          createStore({ value: undefined as ProjectMeta | undefined }),
        ),
      )
      if (!meta) throw new Error(input.translate("error.childStore.persistedProjectMetadataCreateFailed"))
      metaCache.set(key, { store: meta[0], setStore: meta[1], ready: meta[3] })

      const icon = runWithOwner(input.owner, () =>
        persisted(
          Persist.workspace(directory, "icon", ["icon.v1"]),
          createStore({ value: undefined as string | undefined }),
        ),
      )
      if (!icon) throw new Error(input.translate("error.childStore.persistedProjectIconCreateFailed"))
      iconCache.set(key, { store: icon[0], setStore: icon[1], ready: icon[3] })

      // Keep a small directory-scoped session summary cache. It contains only
      // sidebar rows, never messages or tool parts, so a hard refresh can paint
      // the workspace immediately while the server performs its consistency refresh.
      const makeSessionCache = (scope: string) => runWithOwner(input.owner, () =>
        persisted(Persist.workspace(directory, `sessions.v2:${scope}`), createStore({ value: [] as Session[] })),
      )
      const scope = untrack(() => input.sessionCacheScope?.())
      const sessions = scope ? makeSessionCache(scope) : undefined
      if (sessions) sessionCache.set(key, sessions[1])

      const init = () =>
        createRoot((dispose) => {
          const initialMeta = meta[0].value
          const initialIcon = icon[0].value
          const initialSessions = sessions?.[0].value ?? []

          const globalChat = key === "global-chat"
          const [pathQuery, mcpQuery, lspQuery] = useQueries(() => ({
            queries: [
              { ...input.queryOptions.path(key), enabled: false },
              globalChat
                ? { queryKey: [key, "mcp"], queryFn: async () => ({}), enabled: false }
                : { ...input.queryOptions.mcp(key), enabled: false },
              globalChat
                ? { queryKey: [key, "lsp"], queryFn: async () => [], enabled: false }
                : { ...input.queryOptions.lsp(key), enabled: false },
            ],
          }))

          const child = createStore<State>({
            project: "",
            projectMeta: initialMeta,
            icon: initialIcon,
            get provider_ready() {
              return true
            },
            get provider() {
              return this.provider_project ?? input.global.provider()
            },
            config: {},
            get path() {
              return pathQuery.data ?? { state: "", config: "", worktree: "", directory, home: "" }
            },
            status: "loading" as const,
            agent: [],
            command: [],
            plugin_contributions: [],
            sessionList: "idle",
            sessionListAvailable: initialSessions.length > 0,
            session: initialSessions,
            sessionTotal: initialSessions.length,
            session_status: {},
            session_working(id: string) {
              const type = this.session_status[id]?.type
              return (type ?? "idle") !== "idle"
            },
            session_diff: {},
            todo: {},
            permission: {},
            question: {},
            get mcp_ready() {
              return !mcpQuery.isLoading
            },
            get mcp() {
              return mcpQuery.isLoading ? {} : (mcpQuery.data ?? {})
            },
            get lsp_ready() {
              return !lspQuery.isLoading
            },
            get lsp() {
              return lspQuery.isLoading ? [] : (lspQuery.data ?? [])
            },
            vcs: vcsStore.value,
            limit: SESSION_LIST_LIMIT,
            message: {},
            backgroundJob: {},
            part: {},
          })
          children[key] = child
          disposers.set(key, dispose)

          const onPersistedInit = (init: Promise<string> | string | null, run: () => void) => {
            if (!(init instanceof Promise)) return
            void init.then(() => {
              if (children[key] !== child) return
              run()
            }).catch(() => undefined)
          }

          onPersistedInit(vcs[2], () => {
            const cached = vcsStore.value
            if (!cached?.branch) return
            child[1]("vcs", (value) => value ?? cached)
          })

          onPersistedInit(meta[2], () => {
            if (child[0].projectMeta !== initialMeta) return
            child[1]("projectMeta", meta[0].value)
          })

          onPersistedInit(icon[2], () => {
            if (child[0].icon !== initialIcon) return
            child[1]("icon", icon[0].value)
          })

          const hydrateSessions = (cache: NonNullable<typeof sessions>) => {
            const apply = () => {
              const rows = hydrateStartupSessionRows(cache[0].value, child[0].session, verifiedSessions.has(key))
              if (!rows) return
              batch(() => {
                child[1]("session", reconcile(rows, { key: "id" }))
                child[1]("sessionTotal", rows.filter((row) => !row.parentID).length)
                child[1]("sessionListAvailable", true)
              })
            }
            if (cache[2] instanceof Promise) onPersistedInit(cache[2], apply)
            else apply()
          }
          if (sessions) {
            if (sessions[2] instanceof Promise) hydrateSessions(sessions)
          } else {
            createEffect(() => {
              const scope = input.sessionCacheScope?.()
              if (!scope || sessionCache.has(key)) return
              const cache = makeSessionCache(scope)
              if (!cache) return
              sessionCache.set(key, cache[1])
              untrack(() => {
                if (verifiedSessions.has(key)) cache[1]("value", [...child[0].session])
                else hydrateSessions(cache)
              })
            })
          }
        })

      runWithOwner(input.owner, init)
    }
    markKey(key)
    const childStore = children[key]
    if (!childStore) throw new Error(input.translate("error.childStore.storeCreateFailed"))
    return childStore
  }

  function child(directory: string, options: ChildOptions = {}) {
    const key = directoryKey(directory)
    const childStore = ensureChild(directory)
    pinForOwner(key)
    const shouldBootstrap = options.bootstrap ?? true
    if (shouldBootstrap && childStore[0].status === "loading") {
      input.onBootstrap(directory)
    }
    return childStore
  }

  function peek(directory: string, options: ChildOptions = {}) {
    const key = directoryKey(directory)
    const childStore = ensureChild(directory)
    const shouldBootstrap = options.bootstrap ?? true
    if (shouldBootstrap && childStore[0].status === "loading") {
      input.onBootstrap(directory)
    }
    return childStore
  }

  function projectMeta(directory: string, patch: ProjectMeta) {
    const key = directoryKey(directory)
    const [store, setStore] = ensureChild(directory)
    const cached = metaCache.get(key)
    if (!cached) return
    const previous = store.projectMeta ?? {}
    const icon = patch.icon ? { ...previous.icon, ...patch.icon } : previous.icon
    const commands = patch.commands ? { ...previous.commands, ...patch.commands } : previous.commands
    const next = {
      ...previous,
      ...patch,
      icon,
      commands,
    }
    cached.setStore("value", next)
    setStore("projectMeta", next)
  }

  function projectIcon(directory: string, value: string | undefined) {
    const key = directoryKey(directory)
    const [store, setStore] = ensureChild(directory)
    const cached = iconCache.get(key)
    if (!cached) return
    if (store.icon === value) return
    cached.setStore("value", value)
    setStore("icon", value)
  }

  return {
    children,
    directories: () => Object.keys(children),
    ensureChild,
    child,
    peek,
    projectMeta,
    projectIcon,
    mark,
    pin,
    unpin,
    pinned,
    disposeDirectory,
    runEviction,
    vcsCache,
    metaCache,
    iconCache,
    setSessions(directory: string, value: Session[]) {
      const key = directoryKey(directory)
      verifiedSessions.add(key)
      sessionCache.get(key)?.("value", value)
    },
  }
}
