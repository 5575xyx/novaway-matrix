import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = [
  "ollama",
  "deepseek",
  "siliconflow-cn",
  "zhipuai",
  "zai",
  "minimax-cn",
  "moonshotai-cn",
  "alibaba-cn",
  "xiaomi",
]
const popularProviderSet = new Set(popularProviders)

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const dir = createMemo(() => decode64(params.dir) ?? "")
  const providers = () => {
    if (dir()) {
      const [projectStore] = globalSync.child(dir())
      if (projectStore.provider_ready) return projectStore.provider
    }
    return globalSync.data.provider
  }
  // 供应商目录加载完成（全局那份一开始是空表）。项目覆盖是后到的增量，
  // 不该把输入框一直卡在加载态。
  const ready = () => providers().all.length > 0

  return {
    all: () => providers().all,
    default: () => providers().default,
    ready,
    popular: () => providers().all.filter((p) => popularProviderSet.has(p.id)),
    connected: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter((p) => connected.has(p.id))
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter((p) => connected.has(p.id))
    },
  }
}
