import { MetaProvider } from "@solidjs/meta"
import { render } from "solid-js/web"
import "@opencode-ai/app/index.css"
import { Font } from "@opencode-ai/ui/font"
import { Splash } from "@opencode-ai/ui/logo"
import { Progress } from "@opencode-ai/ui/progress"
import "./styles.css"
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { InitStep, SqliteMigrationProgress } from "../preload/types"
import { t, initI18n } from "./i18n"

const root = document.getElementById("root")!

const initSteps = [
  { key: "server_waiting", text: "desktop.loading.startingServer", progress: 10 },
  { key: "initializing", text: "desktop.loading.initializingConfig", progress: 30 },
  { key: "loadingAgents", text: "desktop.loading.loadingAgents", progress: 50 },
  { key: "loadingSkills", text: "desktop.loading.loadingSkills", progress: 70 },
  { key: "sqlite_waiting", text: "desktop.loading.migrating", progress: 90 },
]

render(() => {
  const [step, setStep] = createSignal<InitStep | null>(null)
  const [currentStepIndex, setCurrentStepIndex] = createSignal(0)
  const [percent, setPercent] = createSignal(0)
  const [showMayTakeTime, setShowMayTakeTime] = createSignal(false)

  const phase = createMemo(() => step()?.phase)

  const value = createMemo(() => {
    if (phase() === "done") return 100
    return Math.max(10, Math.min(95, percent()))
  })

  window.api.awaitInitialization((next) => setStep(next as InitStep)).catch((err) => {
      console.error("Initialization error:", err)
      setStep({ phase: "done" })
    })

  onMount(async () => {
    await initI18n()

    setCurrentStepIndex(0)
    setPercent(10)

    const stepTimers = initSteps.map((initStep, index) => {
      if (index === 0) return undefined
      return setTimeout(() => {
        setCurrentStepIndex(index)
        setPercent(initStep.progress)
      }, 2000 + index * 1500)
    })

    const listener = window.api.onSqliteMigrationProgress((progress: SqliteMigrationProgress) => {
      if (progress.type === "InProgress") {
        setCurrentStepIndex(initSteps.findIndex((s) => s.key === "sqlite_waiting"))
        setPercent(90 + progress.value * 0.1)
        setShowMayTakeTime(true)
      }
      if (progress.type === "Done") {
        setPercent(100)
        setStep({ phase: "done" })
      }
    })

    onCleanup(() => {
      listener()
      stepTimers.forEach((timer) => {
        if (timer) clearTimeout(timer)
      })
    })
  })

  createEffect(() => {
    if (phase() !== "done") return

    const timer = setTimeout(() => window.api.loadingWindowComplete(), 1000)
    onCleanup(() => clearTimeout(timer))
  })

  const status = createMemo(() => {
    if (phase() === "done") return t("desktop.loading.done")
    if (phase() === "sqlite_waiting") return t("desktop.loading.migrating")
    
    const currentInitStep = initSteps[currentStepIndex()]
    if (currentInitStep) return t(currentInitStep.text as any)
    
    return t("desktop.loading.waiting")
  })

  return (
    <MetaProvider>
      <div class="w-screen h-screen bg-background-base flex items-center justify-center">
        <Font />
        <div class="flex flex-col items-center gap-11">
          <Splash class="w-20 h-25 opacity-15" />
          <div class="w-72 flex flex-col items-center gap-4" aria-live="polite">
            <span class="w-full overflow-hidden text-center text-ellipsis whitespace-nowrap text-text-strong text-14-normal">
              {status()}
            </span>
            {showMayTakeTime() && (
              <span class="w-full overflow-hidden text-center text-ellipsis whitespace-nowrap text-text-weak text-12-normal">
                {t("desktop.loading.mayTakeTime")}
              </span>
            )}
            <Progress
              value={value()}
              class="w-40 [&_[data-slot='progress-track']]:h-1.5 [&_[data-slot='progress-track']]:border-0 [&_[data-slot='progress-track']]:rounded-full [&_[data-slot='progress-track']]:bg-surface-weak [&_[data-slot='progress-fill']]:rounded-full [&_[data-slot='progress-fill']]:bg-icon-interactive-base"
              aria-label="初始化进度"
              getValueLabel={({ value }) => `${Math.round(value)}%`}
            />
            <span class="text-text-weak text-11-normal">
              {Math.round(value())}%
            </span>
          </div>
        </div>
      </div>
    </MetaProvider>
  )
}, root)
