import type { ElectronAPI } from "../preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __NovaWay__?: {
      deepLinks?: string[]
    }
  }

  interface ImportMetaEnv {
    // 与 electron.vite.config.ts 的 renderer.define 键名保持一致。
    readonly VITE_NOVAWAY_CHANNEL?: string
  }
}
