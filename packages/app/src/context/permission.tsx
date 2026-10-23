import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@novaway/ui/context"
import type { PermissionRequest } from "@novaway/sdk/v2/client"
import { Persist, persisted } from "@/utils/persist"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "./global-sync"
import { useParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import {
  acceptKey,
  directoryAcceptKey,
  isDirectoryAutoAccepting,
  autoRespondsPermission,
} from "./permission-auto-respond"
import {
  autoRespondsUnder,
  isRiskyPermission,
  legacyModeFrom,
  normalizeMode,
  resolvePermissionMode,
  type SessionPermissionMode,
} from "./permission-risk"

type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
  directory?: string
}) => void

function isNonAllowRule(rule: unknown) {
  if (!rule) return false
  if (typeof rule === "string") return rule !== "allow"
  if (typeof rule !== "object") return false
  if (Array.isArray(rule)) return false

  for (const action of Object.values(rule)) {
    if (action !== "allow") return true
  }

  return false
}

function hasPermissionPromptRules(permission: unknown) {
  if (!permission) return false
  if (typeof permission === "string") return permission !== "allow"
  if (typeof permission !== "object") return false
  if (Array.isArray(permission)) return false

  const config = permission as Record<string, unknown>
  return Object.values(config).some(isNonAllowRule)
}

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const params = useParams()
    const globalSDK = useGlobalSDK()
    const globalSync = useGlobalSync()

    const permissionsEnabled = createMemo(() => {
      const directory = decode64(params.dir)
      if (!directory) return false
      const [store] = globalSync.child(directory)
      return hasPermissionPromptRules(store.config.permission)
    })

    const [store, setStore, _, ready] = persisted(
      {
        ...Persist.global("permission", ["permission.v3"]),
        migrate(value) {
          if (!value || typeof value !== "object" || Array.isArray(value)) return value

          const data = value as Record<string, unknown>
          if (data.autoAccept) return value

          return {
            ...data,
            autoAccept:
              typeof data.autoAcceptEdits === "object" && data.autoAcceptEdits && !Array.isArray(data.autoAcceptEdits)
                ? data.autoAcceptEdits
                : {},
          }
        },
      },
      createStore({
        autoAccept: {} as Record<string, boolean>,
        /**
         * 旧版目录级档位（confirm / auto / full）。
         *
         * 新版本把档位存在会话的 permissionMode 上；这里只用于迁移 ——
         * 读到旧值就映射成对应内核档位，用户下次选择后即被清除。
         */
        mode: {} as Record<string, string>,
        /** 新会话界面选的档位：创建会话时写入，不碰全局默认。 */
        pending: {} as Record<string, string>,
      }),
    )

    // 乐观档位：点完立刻变色，等内核/配置真正回流后自动撤掉。
    // 键是 `${directory}\u0000${sessionID}`，sessionID 为空表示「新会话的默认档位」。
    // 不落盘 —— 它是"请求已发出"的临时显示，不是事实。
    const [optimistic, setOptimistic] = createStore<Record<string, SessionPermissionMode>>({})
    const optimisticKey = (directory: string | undefined, sessionID: string | undefined) =>
      `${directory ?? ""}\u0000${sessionID ?? ""}`

    // When config has permission: "allow", auto-enable directory-level auto-accept
    createEffect(() => {
      if (!ready()) return
      const directory = decode64(params.dir)
      if (!directory) return
      const [childStore] = globalSync.child(directory)
      const perm = childStore.config.permission
      if (typeof perm === "string" && perm === "allow") {
        const key = directoryAcceptKey(directory)
        if (store.autoAccept[key] === undefined) {
          setStore(
            produce((draft) => {
              draft.autoAccept[key] = true
            }),
          )
        }
      }
    })

    const MAX_RESPONDED = 1000
    const RESPONDED_TTL_MS = 60 * 60 * 1000
    const responded = new Map<string, number>()
    const enableVersion = new Map<string, number>()

    function pruneResponded(now: number) {
      for (const [id, ts] of responded) {
        if (now - ts < RESPONDED_TTL_MS) break
        responded.delete(id)
      }

      for (const id of responded.keys()) {
        if (responded.size <= MAX_RESPONDED) break
        responded.delete(id)
      }
    }

    const respond: PermissionRespondFn = (input) => {
      globalSDK.client.permission.respond(input).catch(() => {
        responded.delete(input.permissionID)
      })
    }

    function respondOnce(permission: PermissionRequest, directory?: string) {
      const now = Date.now()
      const hit = responded.has(permission.id)
      responded.delete(permission.id)
      responded.set(permission.id, now)
      pruneResponded(now)
      if (hit) return
      respond({
        sessionID: permission.sessionID,
        permissionID: permission.id,
        response: "once",
        directory,
      })
    }

    function isAutoAccepting(sessionID: string, directory?: string) {
      if (autoRespondsUnder(mode(sessionID, directory)) !== "never") return true
      const session = directory ? globalSync.child(directory, { bootstrap: false })[0].session : []
      return autoRespondsPermission(store.autoAccept, session, { sessionID }, directory)
    }

    /** 新会话继承全局默认档位，所以"是否会自动接受"也按默认档位判断。 */
    function isAutoAcceptingDirectory(directory: string) {
      if (autoRespondsUnder(defaultMode(directory)) !== "never") return true
      return isDirectoryAutoAccepting(store.autoAccept, directory)
    }

    /** 全局默认档位：写在 config.permission_mode，内核在建会话时回落到它。 */
    function configDefaultMode(directory?: string): SessionPermissionMode {
      // 没有目录时（设置页在应用级）直接读全局配置，避免依赖 Session 上下文。
      if (!directory) return normalizeMode(globalSync.data.config.permission_mode) ?? "default"
      return normalizeMode(globalSync.child(directory, { bootstrap: false })[0].config.permission_mode) ?? "default"
    }

    /** 界面上看到的默认档位：优先用刚点下的乐观值，避免等配置回流才变色。 */
    function defaultMode(directory?: string): SessionPermissionMode {
      const actual = configDefaultMode(directory)
      const pending = optimistic[optimisticKey(directory, undefined)]
      return pending && pending !== actual ? pending : actual
    }

    /** 新会话暂存的档位：会话还不存在时，选择器把它记在这里。 */
    function pendingMode(directory?: string): SessionPermissionMode | undefined {
      return directory ? normalizeMode(store.pending[directory]) : undefined
    }

    /** 旧版目录级档位 → 内核档位（只用于迁移）。 */
    function legacyMode(directory?: string): SessionPermissionMode | undefined {
      if (!directory) return undefined
      const key = directoryAcceptKey(directory)
      return legacyModeFrom(store.mode[key], store.autoAccept[key])
    }

    function sessionById(sessionID: string, directory?: string) {
      const sessions = directory ? globalSync.child(directory, { bootstrap: false })[0].session : []
      return sessions.find((item) => item.id === sessionID) as
        | { id: string; permissionMode?: SessionPermissionMode }
        | undefined
    }

    /**
     * 会话当前生效的档位：会话自己的设置 > 旧版目录设置 > 全局默认。
     *
     * 返回的永远是"真正会生效的那一档"，界面因此不会出现
     * "显示默认、实际却在自动放行"的错位。
     */
    function mode(sessionID: string | undefined, directory?: string): SessionPermissionMode {
      const resolved = resolvePermissionMode({
        ...(sessionID ? { session: sessionById(sessionID, directory)?.permissionMode } : {}),
        ...(legacyMode(directory) ? { legacy: legacyMode(directory) } : {}),
        ...(store.autoAccept[directory ? directoryAcceptKey(directory) : ""] === true
          ? { legacyAutoAccept: true }
          : {}),
        config: configDefaultMode(directory),
      })
      // 刚点下的档位先按它显示；一旦内核值追上，effect 会把这个临时值删掉。
      // 新会话还没有 sessionID：读待定档位（创建会话时写进 permissionMode），
      // 否则在新建任务里换档位会"点了没反应"。
      const pending = sessionID
        ? optimistic[optimisticKey(directory, sessionID)]
        : (pendingMode(directory) ?? optimistic[optimisticKey(directory, undefined)])
      return pending && pending !== resolved ? pending : resolved
    }

    /** 会话是否跟随全局默认（没有自己的档位）。 */
    function isInherited(sessionID: string | undefined, directory?: string): boolean {
      if (!sessionID) return true
      if (optimistic[optimisticKey(directory, sessionID)]) return false
      return !normalizeMode(sessionById(sessionID, directory)?.permissionMode)
    }

    /**
     * 乐观值回收：只要会话 / 配置里的真实值追上了刚点的那一档，就把临时值删掉。
     * 没追上就继续显示乐观值 —— 这正是"点完立刻生效"和"不闪回旧档位"的平衡点。
     */
    createEffect(() => {
      for (const key of Object.keys(optimistic)) {
        const [directory, sessionID] = key.split("\u0000")
        const actual = sessionID
          ? (normalizeMode(sessionById(sessionID, directory || undefined)?.permissionMode) ??
            configDefaultMode(directory || undefined))
          : configDefaultMode(directory || undefined)
        if (actual !== optimistic[key]) continue
        setOptimistic(
          produce((draft) => {
            delete draft[key]
          }),
        )
      }
    })

    function setMode(sessionID: string | undefined, directory: string, next: SessionPermissionMode) {
      // 新会话界面还没有 session：档位先记在待定槽位，创建会话时写入。
      if (!sessionID) {
        setStore("pending", directory, next)
        return
      }
      // 清掉旧版目录级设置，避免它继续盖过新档位。
      setStore(
        produce((draft) => {
          delete draft.mode[directoryAcceptKey(directory)]
        }),
      )
      disableDirectory(directory)
      const key = optimisticKey(directory, sessionID)
      setOptimistic(key, next)
      void globalSDK.client.session.update({ directory, sessionID, permissionMode: next }).catch(() => {
        // 请求失败就撤回乐观值，别让界面停在一个没生效的档位上。
        setOptimistic(
          produce((draft) => {
            delete draft[key]
          }),
        )
      })
      if (next === "default") return
      // 切到自动档位时，把已经挂在请求队列里的权限按新档位处理掉。
      const behavior = autoRespondsUnder(next)
      globalSDK.client.permission
        .list({ directory })
        .then((x) => {
          for (const perm of x.data ?? []) {
            if (!perm?.id) continue
            if (perm.sessionID !== sessionID) continue
            if (behavior === "risky" && isRiskyPermission(perm)) continue
            respondOnce(perm, directory)
          }
        })
        .catch(() => undefined)
    }

    function shouldAutoRespond(permission: PermissionRequest, directory?: string) {
      // 会话档位是唯一权威来源（会话 > 全局默认），内核与客户端用同一套值。
      const behavior = autoRespondsUnder(mode(permission.sessionID, directory))
      if (behavior === "always") return true
      if (behavior === "risky") return !isRiskyPermission(permission)
      // 旧版「当前会话/当前项目自动接受」开关仍生效，避免升级后行为突变。
      const session = directory ? globalSync.child(directory, { bootstrap: false })[0].session : []
      return autoRespondsPermission(store.autoAccept, session, permission, directory)
    }

    function bumpEnableVersion(sessionID: string, directory?: string) {
      const key = acceptKey(sessionID, directory)
      const next = (enableVersion.get(key) ?? 0) + 1
      enableVersion.set(key, next)
      return next
    }

    const unsubscribe = globalSDK.event.listen((e) => {
      const event = e.details
      if (event?.type !== "permission.asked") return

      const perm = event.properties
      if (!shouldAutoRespond(perm, e.name)) return

      respondOnce(perm, e.name)
    })
    onCleanup(unsubscribe)

    function enableDirectory(directory: string) {
      const key = directoryAcceptKey(directory)
      setStore(
        produce((draft) => {
          draft.autoAccept[key] = true
        }),
      )

      globalSDK.client.permission
        .list({ directory })
        .then((x) => {
          if (!isAutoAcceptingDirectory(directory)) return
          for (const perm of x.data ?? []) {
            if (!perm?.id) continue
            if (!shouldAutoRespond(perm, directory)) continue
            respondOnce(perm, directory)
          }
        })
        .catch(() => undefined)
    }

    function disableDirectory(directory: string) {
      const key = directoryAcceptKey(directory)
      setStore(
        produce((draft) => {
          draft.autoAccept[key] = false
        }),
      )
    }

    function enable(sessionID: string, directory: string) {
      const key = acceptKey(sessionID, directory)
      const version = bumpEnableVersion(sessionID, directory)
      setStore(
        produce((draft) => {
          draft.autoAccept[key] = true
          delete draft.autoAccept[sessionID]
        }),
      )

      globalSDK.client.permission
        .list({ directory })
        .then((x) => {
          if (enableVersion.get(key) !== version) return
          if (!isAutoAccepting(sessionID, directory)) return
          for (const perm of x.data ?? []) {
            if (!perm?.id) continue
            if (!shouldAutoRespond(perm, directory)) continue
            respondOnce(perm, directory)
          }
        })
        .catch(() => undefined)
    }

    function disable(sessionID: string, directory?: string) {
      bumpEnableVersion(sessionID, directory)
      const key = directory ? acceptKey(sessionID, directory) : sessionID
      setStore(
        produce((draft) => {
          draft.autoAccept[key] = false
          if (!directory) return
          delete draft.autoAccept[sessionID]
        }),
      )
    }

    return {
      ready,
      respond,
      autoResponds(permission: PermissionRequest, directory?: string) {
        return shouldAutoRespond(permission, directory)
      },
      isAutoAccepting,
      isAutoAcceptingDirectory,
      toggleAutoAccept(sessionID: string, directory: string) {
        if (isAutoAccepting(sessionID, directory)) {
          disable(sessionID, directory)
          return
        }

        enable(sessionID, directory)
      },
      toggleAutoAcceptDirectory(directory: string) {
        if (isAutoAcceptingDirectory(directory)) {
          disableDirectory(directory)
          return
        }
        enableDirectory(directory)
      },
      enableAutoAccept(sessionID: string, directory: string) {
        if (isAutoAccepting(sessionID, directory)) return
        enable(sessionID, directory)
      },
      disableAutoAccept(sessionID: string, directory?: string) {
        disable(sessionID, directory)
      },
      permissionsEnabled,
      /** 会话当前生效的档位（选择器用）。 */
      mode,
      /** 会话是否跟随全局默认。 */
      isInherited,
      /** 全局默认档位（设置页用）。 */
      defaultMode,
      setMode,
      /** 新会话建好后清掉待定档位，避免它变成下一个新任务的隐性默认值。 */
      consumePendingMode(directory: string) {
        setStore(
          produce((draft) => {
            delete draft.pending[directory]
          }),
        )
      },
      /** 直接把全局默认写回 config.permission_mode。 */
      setDefaultMode(directory: string | undefined, next: SessionPermissionMode) {
        const key = optimisticKey(directory, undefined)
        setOptimistic(key, next)
        void globalSync.updateConfig({ permission_mode: next } as never).catch(() => {
          setOptimistic(
            produce((draft) => {
              delete draft[key]
            }),
          )
        })
        if (!directory) return
        setStore(
          produce((draft) => {
            delete draft.mode[directoryAcceptKey(directory)]
          }),
        )
      },
      isRisky(permission: PermissionRequest) {
        return isRiskyPermission(permission)
      },
      isPermissionAllowAll(directory: string) {
        const [childStore] = globalSync.child(directory)
        const perm = childStore.config.permission
        return typeof perm === "string" && perm === "allow"
      },
    }
  },
})
