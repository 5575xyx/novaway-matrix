export type VoiceAcceleration = "webgpu" | "native-gpu" | "wasm" | "checking"

/** Detects usable WebGPU, not merely the presence of navigator.gpu. */
export async function detectVoiceAcceleration(): Promise<"webgpu" | "wasm"> {
  const gpu = (
    globalThis as typeof globalThis & {
      navigator?: { gpu?: { requestAdapter?: () => Promise<unknown> } }
    }
  ).navigator?.gpu
  if (!gpu?.requestAdapter) return "wasm"
  try {
    return (await gpu.requestAdapter()) ? "webgpu" : "wasm"
  } catch {
    return "wasm"
  }
}
