import type { Event } from "@novaway/sdk/v2/client"
import { createSimpleContext } from "@novaway/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { makeEventListener } from "@solid-primitives/event-listener"
import { batch, onCleanup, onMount } from "solid-js"
import { authTokenFromCredentials, createSdkForServer } from "@/utils/server"
import { useLanguage } from "./language"
import { usePlatform } from "./platform"
import { useServer } from "./server"
import { createStreamEventQueue, createStreamHeartbeat } from "./stream-events"

const isAbortError = (error: unknown) =>
  error !== null && typeof error === "object" && "name" in error && error.name === "AbortError"

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: () => {
    const language = useLanguage()
    const server = useServer()
    const platform = usePlatform()
    const abort = new AbortController()

    const eventFetch = (() => {
      if (!platform.fetch || !server.current) return
      try {
        const url = new URL(server.current.http.url)
        const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
        if (url.protocol === "http:" && !loopback) return platform.fetch
      } catch {
        return
      }
    })()

    const currentServer = server.current
    if (!currentServer) throw new Error(language.t("error.globalSDK.noServerAvailable"))

    const eventSdk = createSdkForServer({
      signal: abort.signal,
      fetch: eventFetch,
      server: currentServer.http,
    })
    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    // Coalesce bursty packets before updating long timelines; this caps redundant UI commits.
    const FLUSH_FRAME_MS = 32
    const STREAM_YIELD_MS = 64
    const RECONNECT_DELAY_MS = 250
    const queue = createStreamEventQueue()
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0

    const flush = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      const events = queue.take()
      if (!events.length) return
      last = Date.now()
      batch(() => {
        for (const { directory, payload } of events) emitter.emit(directory, payload)
      })
    }

    const schedule = () => {
      if (timer !== undefined) return
      const elapsed = Date.now() - last
      timer = setTimeout(flush, Math.max(0, FLUSH_FRAME_MS - elapsed))
    }

    let streamErrorLogged = false
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    const aborted = isAbortError

    let attempt: AbortController | undefined
    let run: Promise<void> | undefined
    let started = false
    const heartbeat = createStreamHeartbeat({ timeoutMs: 15_000, onTimeout: () => attempt?.abort() })

    const start = () => {
      if (started) return run
      started = true
      run = (async () => {
        // oxlint-disable-next-line no-unmodified-loop-condition -- `started` is set to false by stop() which also aborts; both flags are checked to allow graceful exit
        while (!abort.signal.aborted && started) {
          attempt = new AbortController()
          heartbeat.received()
          const onAbort = () => {
            attempt?.abort()
          }
          abort.signal.addEventListener("abort", onAbort)
          try {
            const events = await eventSdk.global.event({
              signal: attempt.signal,
              onSseError: (error) => {
                if (aborted(error)) return
                if (streamErrorLogged) return
                streamErrorLogged = true
                console.error("[global-sdk] event stream error", {
                  url: currentServer.http.url,
                  fetch: eventFetch ? "platform" : "webview",
                  error,
                })
              },
            })
            let yielded = Date.now()
            heartbeat.received()
            for await (const event of events.stream) {
              heartbeat.received()
              streamErrorLogged = false
              const directory = event.directory ?? "global"
              if (event.payload.type === "sync") {
                continue
              }

              const payload = event.payload as Event

              queue.push(directory, payload)
              schedule()

              if (Date.now() - yielded < STREAM_YIELD_MS) continue
              yielded = Date.now()
              await wait(0)
            }
          } catch (error) {
            if (!aborted(error) && !streamErrorLogged) {
              streamErrorLogged = true
              console.error("[global-sdk] event stream failed", {
                url: currentServer.http.url,
                fetch: eventFetch ? "platform" : "webview",
                error,
              })
            }
          } finally {
            abort.signal.removeEventListener("abort", onAbort)
            attempt = undefined
            heartbeat.stop()
          }

          if (abort.signal.aborted || !started) return
          await wait(RECONNECT_DELAY_MS)
        }
      })().finally(() => {
        run = undefined
        flush()
      })
      return run
    }

    const stop = () => {
      started = false
      attempt?.abort()
      heartbeat.stop()
    }

    onMount(() => {
      makeEventListener(document, "visibilitychange", () => {
        if (document.visibilityState !== "visible") return
        if (!started) return
        if (!heartbeat.expired()) return
        attempt?.abort()
      })
    })

    onCleanup(() => {
      stop()
      abort.abort()
      flush()
    })

    const sdk = createSdkForServer({
      server: server.current.http,
      fetch: platform.fetch,
      throwOnError: true,
    })

    const request = (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      if (currentServer.http.password) {
        headers.set(
          "Authorization",
          `Basic ${authTokenFromCredentials({
            username: currentServer.http.username,
            password: currentServer.http.password,
          })}`,
        )
      }
      return (platform.fetch ?? globalThis.fetch)(input, { ...init, headers })
    }

    return {
      url: currentServer.http.url,
      request,
      client: sdk,
      event: {
        on: emitter.on.bind(emitter),
        listen: emitter.listen.bind(emitter),
        start,
      },
      createClient(opts: Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">) {
        const s = server.current
        if (!s) throw new Error(language.t("error.globalSDK.serverNotAvailable"))
        return createSdkForServer({
          server: s.http,
          fetch: platform.fetch,
          ...opts,
        })
      },
    }
  },
})
