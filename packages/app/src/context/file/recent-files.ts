import { untrack } from "solid-js"
import { createStore } from "solid-js/store"

// 最近打开过的文件。
// 侧栏文件树挂在应用外壳（Layout），而 FileProvider 只包住会话路由，侧栏够不到它。
// 所以最近文件按工作区存进这份共享 store：会话侧的 FileProvider 写入、外壳侧的侧栏读取，
// 两边看同一份，既不用 context 也不会各存各的。落 localStorage，重启后仍在，且不跨工作区串味。
const LIMIT = 20
const storageKey = (dir: string) => `novaway.recentFiles:${dir}`

const read = (dir: string): string[] => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(dir))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string" && item !== "")
  } catch {
    return []
  }
}

const persist = (dir: string, list: string[]) => {
  try {
    globalThis.localStorage?.setItem(storageKey(dir), JSON.stringify(list))
  } catch {
    // 隐私模式 / 配额满：内存里仍然记着，只是重启后会丢。
  }
}

const [store, setStore] = createStore<Record<string, string[]>>({})

export function recent(dir: string): string[] {
  if (!dir) return []
  const list = store[dir]
  if (list) return list
  const loaded = read(dir)
  // 首次读某工作区时从 localStorage 灌进 store。写入放进 untrack，避免在 memo 里
  // 触发「读后又写同一 signal」的告警；上面那次读已经建立了对该工作区的响应式依赖。
  untrack(() => setStore(dir, loaded))
  return loaded
}

export function rememberRecent(dir: string, file: string) {
  if (!dir || !file) return
  const next = [file, ...recent(dir).filter((item) => item !== file)].slice(0, LIMIT)
  setStore(dir, next)
  persist(dir, next)
}

export function forgetRecent(dir: string, file: string) {
  if (!dir) return
  const next = recent(dir).filter((item) => item !== file)
  setStore(dir, next)
  persist(dir, next)
}
