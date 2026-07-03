import type { PlatformBase } from "./PlatformBase"
import { XhsPlatform } from "./platforms/xhs"
import { DouyinPlatform } from "./platforms/douyin"
import { BilibiliPlatform } from "./platforms/bilibili"
import { KwaiPlatform } from "./platforms/kwai"
import { WxSphPlatform } from "./platforms/wxSph"
import { WxGzhPlatform } from "./platforms/wxGzh"
import { XianyuPlatform } from "./platforms/xianyu"

const platformRegistry: Record<string, new () => PlatformBase> = {
  xhs: XhsPlatform,
  douyin: DouyinPlatform,
  bilibili: BilibiliPlatform,
  kwai: KwaiPlatform,
  wxSph: WxSphPlatform,
  wxGzh: WxGzhPlatform,
  xianyu: XianyuPlatform,
}

export function getPlatform(type: string): PlatformBase {
  const PlatformClass = platformRegistry[type]
  if (!PlatformClass) {
    throw new Error(`不支持的平台类型: ${type}`)
  }
  return new PlatformClass()
}

export function getSupportedPlatforms(): { id: string; name: string }[] {
  return Object.entries(platformRegistry).map(([id, cls]) => ({
    id,
    name: new cls().name,
  }))
}

export { PlatformLoginManager } from "./login"
export * from "./store"
export * from "./PlatformBase"
