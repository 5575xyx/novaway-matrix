export type VoiceModelProgress =
  | { type: "status"; status: string; device?: "webgpu" | "wasm"; progress?: number }
  | { type: "error"; message: string }

export function preloadVoiceModel(model: string, onEvent: (event: VoiceModelProgress) => void) {
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("./voice-stt.worker.ts", import.meta.url), { type: "module" })
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      worker.terminate()
      callback()
    }
    worker.onmessage = (event: MessageEvent<VoiceModelProgress>) => {
      const data = event.data
      onEvent(data)
      if (data.type === "status" && data.status === "ready") finish(resolve)
      if (data.type === "error") finish(() => reject(new Error(data.message)))
    }
    worker.onerror = (event) => finish(() => reject(new Error(event.message || "本地模型 worker 启动失败")))
    worker.postMessage({ type: "start", model, language: "" })
  })
}
