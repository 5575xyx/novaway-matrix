import { createStore } from "solid-js/store"

type MemorySetupState = {
  running: boolean
  phase: string
  log: string
}

export type MemorySetupResult = {
  ok: boolean
  steps?: Array<{ step: string; status: string; detail?: string }>
  config?: {
    embedding_mode: "ollama"
    embedding_ollama_url: string
    embedding_ollama_model: string
    embedding_ollama_install_dir?: string
    embedding_ollama_models_dir?: string
  }
  status?: {
    message?: string
    hint?: string
    downloadURL?: string
    ready?: boolean
  }
}

const [state, setState] = createStore<MemorySetupState>({
  running: false,
  phase: "",
  log: "",
})

let activeSetup: Promise<MemorySetupResult> | undefined

export const memorySetupState = state

export function runMemorySetup(task: (updatePhase: (phase: string) => void) => Promise<MemorySetupResult>): {
  promise: Promise<MemorySetupResult>
  started: boolean
} {
  if (activeSetup) return { promise: activeSetup, started: false }
  setState({ running: true, phase: "checking", log: "" })
  const updatePhase = (phase: string) => {
    if (!state.running) return
    setState("phase", phase)
  }
  activeSetup = task(updatePhase)
    .then((result) => {
      const lines = (result.steps ?? []).map(
        (step) => `${step.status.toUpperCase()} ${step.step}${step.detail ? ` - ${step.detail}` : ""}`,
      )
      setState({
        running: false,
        phase: "",
        log: lines.join("\n") || result.status?.message || "",
      })
      return result
    })
    .catch((error) => {
      setState({
        running: false,
        phase: "",
        log: error instanceof Error ? error.message : String(error),
      })
      throw error
    })
    .finally(() => {
      activeSetup = undefined
    })
  return { promise: activeSetup, started: true }
}
