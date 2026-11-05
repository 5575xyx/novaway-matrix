/**
 * `Worker` 的 Web 与 Node 两边对齐。
 *
 * 源码里 TUI 用 `new Worker(file)` 起 render worker，然后按 Web 标准用
 * `worker.onmessage` 通信；worker 内部则直接用全局 `postMessage` / `onmessage`
 * （`src/util/rpc.ts`）。Node 的 `worker_threads` 只提供 `on("message")` 和
 * `parentPort`，而且 `Worker` 根本不是全局变量 —— 两边都要补。
 *
 * 只在 Node 路径生效：bun 下 Worker 本来就是 Web 标准形状。
 */
import { Worker as NodeWorker, isMainThread, parentPort } from "node:worker_threads"

/** 主线程侧：把 Worker 暴露成全局，并让 `worker.onmessage = fn` 能接到消息。 */
function installMainThread() {
  const Base = globalThis.Worker ?? NodeWorker

  class Worker extends Base {
    #handler = null
    #attached = null

    get onmessage() {
      return this.#handler
    }

    set onmessage(fn) {
      if (this.#attached) this.off("message", this.#attached)
      this.#handler = fn
      if (!fn) {
        this.#attached = null
        return
      }
      // Web 的 MessageEvent 只有 data 被用到；`{ data }` 足够。
      this.#attached = (data) => fn.call(this, { data })
      this.on("message", this.#attached)
    }

    addEventListener(type, fn) {
      if (type !== "message") return
      const previous = this.#handler
      this.onmessage = (event) => {
        previous?.call(this, event)
        fn.call(this, event)
      }
    }

    removeEventListener(type, fn) {
      if (type !== "message" || !this.#attached) return
      this.off("message", this.#attached)
      this.#attached = null
      this.#handler = null
    }
  }

  globalThis.Worker = Worker
}

/** Worker 线程侧：补上 `postMessage` / `onmessage` / `self` 这些全局。 */
function installWorkerThread() {
  if (!parentPort) return
  const g = globalThis

  if (typeof g.postMessage === "undefined") {
    g.postMessage = (data) => parentPort.postMessage(data)
  }
  if (typeof g.close === "undefined") {
    g.close = () => process.exit(0)
  }
  if (typeof g.self === "undefined") {
    g.self = g
  }

  // `onmessage = fn` 在 Web Worker 里是「注册处理器」，Node 侧要转成 event listener。
  // 用访问器属性接管，赋值时挂到 parentPort 上。
  let handler = null
  let attached = null
  Object.defineProperty(g, "onmessage", {
    configurable: true,
    get: () => handler,
    set: (fn) => {
      if (attached) parentPort.removeListener("message", attached)
      handler = fn
      if (!fn) {
        attached = null
        return
      }
      attached = (data) => fn({ data })
      parentPort.on("message", attached)
    },
  })

  // Web Worker 里 `addEventListener("message")` 与 `onmessage` 等价。
  if (typeof g.addEventListener === "undefined") {
    g.addEventListener = (type, fn) => {
      if (type !== "message") return
      parentPort.on("message", (data) => fn({ data }))
    }
  }
}

export function installWorkerCompat() {
  if (isMainThread) installMainThread()
  else installWorkerThread()
}
