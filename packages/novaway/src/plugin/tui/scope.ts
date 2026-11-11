import type { TuiDispose, TuiPluginApi } from "@novaway/plugin/tui"

type PluginLoad = { spec: string }
type ScopeLogger = (message: string, data: Record<string, unknown>) => void

export type PluginScope = {
  lifecycle: TuiPluginApi["lifecycle"]
  track: (fn: (() => void) | undefined) => () => void
  dispose: () => Promise<void>
}

type CleanupResult = { type: "ok" } | { type: "error"; error: unknown } | { type: "timeout" }

function runCleanup(fn: () => unknown, ms: number): Promise<CleanupResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ type: "timeout" })
    }, ms)

    Promise.resolve()
      .then(fn)
      .then(
        () => {
          resolve({ type: "ok" })
        },
        (error) => {
          resolve({ type: "error", error })
        },
      )
      .finally(() => {
        clearTimeout(timer)
      })
  })
}

export function createPluginScope(load: PluginLoad, id: string, disposeTimeoutMs: number, report: ScopeLogger) {
  const ctrl = new AbortController()
  let list: { key: symbol; fn: TuiDispose }[] = []
  let done = false

  const onDispose = (fn: TuiDispose) => {
    if (done) return () => {}
    const key = Symbol()
    list.push({ key, fn })
    let drop = false
    return () => {
      if (drop) return
      drop = true
      list = list.filter((x) => x.key !== key)
    }
  }

  const track = (fn: (() => void) | undefined) => {
    if (!fn) return () => {}
    let drop = false
    let off = () => {}
    const wrapped = () => {
      if (drop) return
      drop = true
      off()
      fn()
    }
    off = onDispose(wrapped)
    return wrapped
  }

  const lifecycle: TuiPluginApi["lifecycle"] = {
    signal: ctrl.signal,
    onDispose,
  }

  const dispose = async () => {
    if (done) return
    done = true
    ctrl.abort()
    const queue = [...list].reverse()
    list = []
    const until = Date.now() + disposeTimeoutMs
    for (const item of queue) {
      const left = until - Date.now()
      if (left <= 0) {
        report("timed out cleaning up tui plugin", {
          path: load.spec,
          id,
          timeout: disposeTimeoutMs,
        })
        break
      }

      const out = await runCleanup(item.fn, left)
      if (out.type === "ok") continue
      if (out.type === "timeout") {
        report("timed out cleaning up tui plugin", {
          path: load.spec,
          id,
          timeout: disposeTimeoutMs,
        })
        break
      }

      if (out.type === "error") {
        report("failed to clean up tui plugin", {
          path: load.spec,
          id,
          error: out.error,
        })
      }
    }
  }

  return {
    lifecycle,
    track,
    dispose,
  }
}
