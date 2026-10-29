import { createStore, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo } from "solid-js"
import { createSimpleContext } from "@novaway/ui/context"
import { persisted } from "@/utils/persist"

export interface NotificationSettings {
  agent: boolean
  permissions: boolean
  errors: boolean
  feishu: {
    enabled: boolean
    onlyWhenUnfocused: boolean
    agent: boolean
    permissions: boolean
    errors: boolean
    questions: boolean
  }
}

export interface SoundSettings {
  agentEnabled: boolean
  agent: string
  permissionsEnabled: boolean
  permissions: string
  errorsEnabled: boolean
  errors: string
}

export interface Settings {
  general: {
    autoSave: boolean
    releaseNotes: boolean
    followup: "queue" | "steer"
    showNavigation: boolean
    showSearch: boolean
    showTerminal: boolean
    showDatabase: boolean
    showReasoningSummaries: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
    showSessionProgressBar: boolean
  }
  updates: {
    startup: boolean
  }
  appearance: {
    fontSize: number
    mono: string
    sans: string
    terminal: string
  }
  keybinds: Record<string, string>
  notifications: NotificationSettings
  sounds: SoundSettings
  /**
   * 默认值迁移版本。
   *
   * 本地存档会和默认值做深合并：存档里已经写过的键不会跟着新默认值变
   * （所以之前 showNavigation: false 的用户永远看不到导航按钮）。
   * 这里用一个小版本号做一次性迁移，只覆盖确实调整过默认值的字段，
   * 不动快捷键等用户自己的数据。
   */
  defaultsVersion?: number
}

export const monoDefault = "System Mono"
export const sansDefault = "System Sans"
export const terminalDefault = "JetBrainsMono Nerd Font Mono"

const monoFallback =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const sansFallback =
  'Inter Variable, "Noto Sans SC Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
const terminalFallback =
  '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoBase = monoFallback
const sansBase = sansFallback
const terminalBase = terminalFallback

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

export function terminalInput(font: string | undefined) {
  return input(font)
}

export function terminalFontFamily(font: string | undefined) {
  return stack(font, terminalBase)
}

/** 默认值调整的版本号：调了默认值就 +1，存档会在下次启动时一次性跟上。 */
const CURRENT_DEFAULTS_VERSION = 1

const defaultSettings: Settings = {
  general: {
    autoSave: true,
    releaseNotes: true,
    followup: "queue",
    showNavigation: true,
    showSearch: true,
    showTerminal: true,
    showDatabase: true,
    showReasoningSummaries: true,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
    showSessionProgressBar: false,
  },
  updates: {
    startup: true,
  },
  appearance: {
    fontSize: 15,
    mono: "",
    sans: "",
    terminal: "",
  },
  keybinds: {},
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
    feishu: {
      enabled: false,
      onlyWhenUnfocused: false,
      agent: true,
      permissions: true,
      errors: true,
      questions: true,
    },
  },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
}

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  init: () => {
    // 保持同一个 key（v3，带迁移版本号字段）：换 key 会连用户自定义的快捷键一起丢掉。
    const [store, setStore, _, ready] = persisted("settings.v3", createStore<Settings>(defaultSettings))

    /**
     * 一次性默认值迁移（见 `Settings.defaultsVersion` 的注释）。
     *
     * 只在存档版本号落后时跑：把「默认值调整过」的几个字段推到新默认，
     * 之后用户自己再改就按用户的来。
     */
    createEffect(() => {
      if (!ready()) return
      const version = store.defaultsVersion ?? 0
      if (version >= CURRENT_DEFAULTS_VERSION) return
      batch(() => {
        setStore("general", "showNavigation", true)
        setStore("general", "showSearch", true)
        setStore("general", "showTerminal", true)
        setStore("general", "showDatabase", true)
        setStore("general", "followup", "queue")
        setStore("appearance", "fontSize", 15)
        setStore("updates", "startup", true)
        setStore("defaultsVersion", CURRENT_DEFAULTS_VERSION)
      })
    })

    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.mono))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
    })

    const fontSize = withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize)
    createEffect(() => {
      if (typeof document === "undefined") return
      document.documentElement.style.setProperty("--ui-font-size", `${fontSize()}px`)
    })

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: withFallback(() => store.general?.autoSave, defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
        releaseNotes: withFallback(() => store.general?.releaseNotes, defaultSettings.general.releaseNotes),
        setReleaseNotes(value: boolean) {
          setStore("general", "releaseNotes", value)
        },
        /**
         * 运行中提交消息的行为。
         *
         * - `steer`：立即投递，**在下一个安全边界生效、不中断当前运行**（默认）
         * - `queue`：排进队列，等这一轮跑完按顺序发
         *
         * 这里以前把 `queue` 强行归一成 `steer` 并且**没有任何地方读它** ——
         * 也就是设置里写着"引导"、实际行为却是排队。现在两边接上了
         * （读的地方见 pages/session.tsx 的 `queueEnabled`）。
         */
        followup: withFallback(() => store.general?.followup, defaultSettings.general.followup),
        setFollowup(value: "queue" | "steer") {
          setStore("general", "followup", value)
        },
        showNavigation: withFallback(() => store.general?.showNavigation, defaultSettings.general.showNavigation),
        setShowNavigation(value: boolean) {
          setStore("general", "showNavigation", value)
        },
        showSearch: withFallback(() => store.general?.showSearch, defaultSettings.general.showSearch),
        setShowSearch(value: boolean) {
          setStore("general", "showSearch", value)
        },
        showTerminal: withFallback(() => store.general?.showTerminal, defaultSettings.general.showTerminal),
        setShowTerminal(value: boolean) {
          setStore("general", "showTerminal", value)
        },
        showDatabase: withFallback(() => store.general?.showDatabase, defaultSettings.general.showDatabase),
        setShowDatabase(value: boolean) {
          setStore("general", "showDatabase", value)
        },
        showReasoningSummaries: withFallback(
          () => store.general?.showReasoningSummaries,
          defaultSettings.general.showReasoningSummaries,
        ),
        setShowReasoningSummaries(value: boolean) {
          setStore("general", "showReasoningSummaries", value)
        },
        shellToolPartsExpanded: withFallback(
          () => store.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
        },
        editToolPartsExpanded: withFallback(
          () => store.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
        },
        showSessionProgressBar: withFallback(
          () => store.general?.showSessionProgressBar,
          defaultSettings.general.showSessionProgressBar,
        ),
        setShowSessionProgressBar(value: boolean) {
          setStore("general", "showSessionProgressBar", value)
        },
      },
      updates: {
        startup: withFallback(() => store.updates?.startup, defaultSettings.updates.startup),
        setStartup(value: boolean) {
          setStore("updates", "startup", value)
        },
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        font: withFallback(() => store.appearance?.mono, defaultSettings.appearance.mono),
        setFont(value: string) {
          setStore("appearance", "mono", value.trim() ? value : "")
        },
        uiFont: withFallback(() => store.appearance?.sans, defaultSettings.appearance.sans),
        setUIFont(value: string) {
          setStore("appearance", "sans", value.trim() ? value : "")
        },
        terminalFont: withFallback(() => store.appearance?.terminal, defaultSettings.appearance.terminal),
        setTerminalFont(value: string) {
          setStore("appearance", "terminal", value.trim() ? value : "")
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          setStore("keybinds", (current) => {
            if (!Object.prototype.hasOwnProperty.call(current, action)) return current
            const next = { ...current }
            delete next[action]
            return next
          })
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
        },
      },
      notifications: {
        agent: withFallback(() => store.notifications?.agent, defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
        },
        permissions: withFallback(() => store.notifications?.permissions, defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
        },
        errors: withFallback(() => store.notifications?.errors, defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
        },
        feishu: {
          enabled: withFallback(
            () => store.notifications?.feishu?.enabled,
            defaultSettings.notifications.feishu.enabled,
          ),
          setEnabled(value: boolean) {
            setStore("notifications", "feishu", "enabled", value)
          },
          onlyWhenUnfocused: withFallback(
            () => store.notifications?.feishu?.onlyWhenUnfocused,
            defaultSettings.notifications.feishu.onlyWhenUnfocused,
          ),
          setOnlyWhenUnfocused(value: boolean) {
            setStore("notifications", "feishu", "onlyWhenUnfocused", value)
          },
          agent: withFallback(() => store.notifications?.feishu?.agent, defaultSettings.notifications.feishu.agent),
          setAgent(value: boolean) {
            setStore("notifications", "feishu", "agent", value)
          },
          permissions: withFallback(
            () => store.notifications?.feishu?.permissions,
            defaultSettings.notifications.feishu.permissions,
          ),
          setPermissions(value: boolean) {
            setStore("notifications", "feishu", "permissions", value)
          },
          errors: withFallback(() => store.notifications?.feishu?.errors, defaultSettings.notifications.feishu.errors),
          setErrors(value: boolean) {
            setStore("notifications", "feishu", "errors", value)
          },
          questions: withFallback(
            () => store.notifications?.feishu?.questions,
            defaultSettings.notifications.feishu.questions,
          ),
          setQuestions(value: boolean) {
            setStore("notifications", "feishu", "questions", value)
          },
        },
      },
      sounds: {
        agentEnabled: withFallback(() => store.sounds?.agentEnabled, defaultSettings.sounds.agentEnabled),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
        },
        agent: withFallback(() => store.sounds?.agent, defaultSettings.sounds.agent),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
        },
        permissionsEnabled: withFallback(
          () => store.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
        },
        permissions: withFallback(() => store.sounds?.permissions, defaultSettings.sounds.permissions),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
      },
    }
  },
})
