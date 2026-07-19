import type {
  PowersNexusWorkflowSnapshot,
  PowersnexusChangesResponse,
  PowersnexusVersionResponse,
} from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "./language"
import { useSDK } from "./sdk"

export type PowersNexusRunLog = {
  text: string
  offset: number
  nextOffset: number
  eof: boolean
}

export type PowersNexusRunView = {
  run?: {
    id: string
    binding_id: string
    action: string
    status: string
    attempt: number
    fingerprint?: string | null
    error_code?: string | null
    log_directory: string
  } | null
  steps: Array<{
    step_id: string
    sequence: number
    status: string
    exit_code?: number | null
    evidence_digest?: string | null
  }>
}

type Store = {
  ready: boolean
  loading: boolean
  error?: string
  panelOpen: boolean
  selectedChangeName?: string
  version?: PowersnexusVersionResponse
  changes: PowersnexusChangesResponse
  snapshot?: PowersNexusWorkflowSnapshot | null
  run?: PowersNexusRunView
  log?: PowersNexusRunLog
  logStepID?: string
}

const empty: Store = {
  ready: false,
  loading: false,
  panelOpen: false,
  changes: [],
  snapshot: null,
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === "object" && err && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message
  }
  return fallback
}

export const { use: usePowersNexus, provider: PowersNexusProvider } = createSimpleContext({
  name: "PowersNexus",
  init: () => {
    const sdk = useSDK()
    const language = useLanguage()
    const [store, setStore] = createStore<Store>({ ...empty })

    const refreshVersion = async () => {
      try {
        const version = await sdk.client.powersnexus.version().then((x) => x.data)
        setStore("version", version)
        return version
      } catch (err) {
        setStore("error", errorMessage(err, language.t("powersnexus.error.version" as never)))
        throw err
      }
    }

    const refreshChanges = async () => {
      try {
        const changes = (await sdk.client.powersnexus.changes().then((x) => x.data)) ?? []
        setStore("changes", changes)
        const selected =
          store.selectedChangeName && changes.some((item) => item.changeName === store.selectedChangeName)
            ? store.selectedChangeName
            : changes[0]?.changeName
        setStore("selectedChangeName", selected)
        return changes
      } catch (err) {
        setStore("error", errorMessage(err, language.t("powersnexus.error.changes" as never)))
        throw err
      }
    }

    const refreshStatus = async (changeName?: string) => {
      const name = changeName ?? store.selectedChangeName
      try {
        const snapshot = await sdk.client.powersnexus
          .status(name ? { changeName: name } : undefined)
          .then((x) => x.data)
        setStore({
          snapshot: snapshot ?? null,
          selectedChangeName: snapshot?.changeName ?? name,
        })
        const runID = snapshot?.delivery?.activeRunID
        if (runID) await refreshRun(runID)
        return snapshot ?? null
      } catch (err) {
        setStore("error", errorMessage(err, language.t("powersnexus.error.status" as never)))
        throw err
      }
    }

    const refreshAll = async () => {
      setStore({ loading: true, error: undefined })
      try {
        await refreshVersion()
        await refreshChanges()
        await refreshStatus()
        setStore({ ready: true, loading: false })
      } catch {
        setStore({ ready: true, loading: false })
      }
    }

    const refreshRun = async (runID: string) => {
      const result = await sdk.client.powersnexus.run({ id: runID }).then((x) => x.data)
      setStore("run", result as PowersNexusRunView)
      return result
    }

    const refreshLog = async (input: {
      runID: string
      stepID: string
      stream?: "stdout" | "stderr"
      offset?: number
      limit?: number
    }) => {
      const log = await sdk.client.powersnexus
        .runLog({
          id: input.runID,
          stepID: input.stepID,
          stream: input.stream ?? "stdout",
          offset: String(input.offset ?? 0),
          limit: String(input.limit ?? 16 * 1024),
        })
        .then((x) => x.data)
      setStore({ log: log as PowersNexusRunLog, logStepID: input.stepID })
      return log
    }

    const checkUpdate = async () => {
      setStore({ loading: true, error: undefined })
      try {
        const version = await sdk.client.powersnexus
          .check({ requestID: `ui-check-${Date.now()}`, channel: "stable" })
          .then((x) => x.data)
        setStore({ version, loading: false })
        return version
      } catch (err) {
        setStore({
          loading: false,
          error: errorMessage(err, language.t("powersnexus.error.check" as never)),
        })
        throw err
      }
    }

    const rollback = async () => {
      const expected = store.version?.active.digest
      if (!expected) throw new Error(language.t("powersnexus.error.noActive" as never))
      setStore({ loading: true, error: undefined })
      try {
        await sdk.client.powersnexus.rollback({
          requestID: `ui-rollback-${Date.now()}`,
          expectedActiveDigest: expected,
        })
        await refreshVersion()
        setStore("loading", false)
      } catch (err) {
        setStore({
          loading: false,
          error: errorMessage(err, language.t("powersnexus.error.rollback" as never)),
        })
        throw err
      }
    }

    const archive = async () => {
      const snapshot = store.snapshot
      if (!snapshot) throw new Error(language.t("powersnexus.error.noSnapshot" as never))
      setStore({ loading: true, error: undefined })
      try {
        await sdk.client.powersnexus.archive({
          actionID: `ui-archive-${Date.now()}`,
          expectedRevision: snapshot.revision,
          bindingID: snapshot.bindingID,
        })
        await refreshStatus(snapshot.changeName)
        setStore("loading", false)
      } catch (err) {
        setStore({
          loading: false,
          error: errorMessage(err, language.t("powersnexus.error.archive" as never)),
        })
        throw err
      }
    }

    createEffect(() => {
      void refreshAll()
      const unsubs = [
        sdk.event.on("powersnexus.snapshot.changed" as never, (event: { properties: PowersNexusWorkflowSnapshot }) => {
          batch(() => {
            setStore("snapshot", event.properties)
            setStore("selectedChangeName", event.properties.changeName)
          })
        }),
        sdk.event.on("powersnexus.phase.changed" as never, () => {
          void refreshStatus()
        }),
        sdk.event.on("powersnexus.binding.changed" as never, () => {
          void refreshChanges().then(() => refreshStatus())
        }),
        sdk.event.on("powersnexus.blocked" as never, (event: { properties: { message: string } }) => {
          setStore("error", event.properties.message)
          void refreshStatus()
        }),
        sdk.event.on("powersnexus.run.started" as never, (event: { properties: { runID: string } }) => {
          void refreshRun(event.properties.runID)
        }),
        sdk.event.on("powersnexus.step.completed" as never, (event: { properties: { runID: string } }) => {
          void refreshRun(event.properties.runID)
        }),
        sdk.event.on("powersnexus.run.completed" as never, (event: { properties: { runID: string } }) => {
          void refreshRun(event.properties.runID)
          void refreshStatus()
        }),
        sdk.event.on("powersnexus.archived" as never, () => {
          void refreshStatus()
        }),
      ]
      onCleanup(() => {
        for (const unsub of unsubs) unsub()
      })
    })

    return {
      store,
      setPanelOpen: (open: boolean) => setStore("panelOpen", open),
      selectChange: async (changeName: string) => {
        setStore("selectedChangeName", changeName)
        await refreshStatus(changeName)
      },
      refreshAll,
      refreshVersion,
      refreshStatus,
      refreshChanges,
      refreshRun,
      refreshLog,
      checkUpdate,
      rollback,
      archive,
    }
  },
})
