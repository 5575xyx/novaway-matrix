import { app } from "electron"

import { resolveChannel, type Channel } from "./channel"

export type { Channel }

// electron-vite 只 define 了 import.meta.env.NOVAWAY_CHANNEL (SCREAMING_SNAKE_CASE)。
// 历史上这里写成 PascalCase (NovaWay_CHANNEL) 导致 undefined 回退 "dev"，
// UPDATER_ENABLED 静默恒为 false，整个 updater 被 tree-shake 掉，自动更新失效。
export const CHANNEL: Channel = resolveChannel(import.meta.env.NOVAWAY_CHANNEL)

export const SETTINGS_STORE = "novaway.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_ENABLED_KEY = "wslEnabled"
export const PET_VISIBLE_KEY = "petVisible"
export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
