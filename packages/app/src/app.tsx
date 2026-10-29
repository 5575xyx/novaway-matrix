// Inter(拉丁)+ Noto Sans SC(中文,思源黑体)可变字体,打包进产品保证三端一致。
import "@fontsource-variable/inter"
import "@fontsource-variable/noto-sans-sc"
import "@/index.css"
import * as Sentry from "@sentry/solid"
import { I18nProvider } from "@novaway/ui/context"
import { DialogProvider } from "@novaway/ui/context/dialog"
import { FileComponentProvider } from "@novaway/ui/context/file"
import { MarkedProvider } from "@novaway/ui/context/marked"
import { File } from "@novaway/ui/file"
import { Font } from "@novaway/ui/font"
import { Splash } from "@novaway/ui/logo"
import { ThemeProvider } from "@novaway/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Navigate, Route, Router, useParams } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Effect } from "effect"
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  type JSX,
  lazy,
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { CommandProvider } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { GlobalSyncProvider } from "@/context/global-sync"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { PreviewInspectionProvider } from "@/context/preview-inspection"
import { PromptProvider } from "@/context/prompt"
import { ServerConnection, ServerProvider, serverName, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import DirectoryLayout from "@/pages/directory-layout"
import { OfficeAgentProvider } from "@/pages/session/office-agent-context"
import Layout from "@/pages/layout"
import { decode64 } from "@/utils/base64"
import { ErrorPage } from "./pages/error"
import { useCheckServerHealth } from "./utils/server-health"
import { installPointerTracking } from "@novaway/ui/util/pointer-origin"

const HomeRoute = lazy(() => import("@/pages/home"))
const loadSession = () => import("@/pages/session")
const Session = lazy(loadSession)
const Loading = () => <div class="size-full bg-background" />

if (typeof location === "object" && /\/session(?:\/|$)/.test(location.pathname)) {
  void loadSession()
}

function SessionRoute() {
  const params = useParams()
  // 目录从路由参数解：元素选取挂在会话作用域，需要 PromptProvider，而它只在会话路由内
  const directory = createMemo(() => decode64(params.dir) ?? "")

  return (
    <SessionProviders directory={directory}>
      <Session />
    </SessionProviders>
  )
}

const SessionIndexRoute = () => <Navigate href="session" />

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
      wsl?: boolean
    }
    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
      minimizeWindow?: () => Promise<void>
      toggleMaximizeWindow?: () => Promise<void>
      closeWindow?: () => Promise<void>
      isWindowMaximized?: () => Promise<boolean>
      onWindowMaximizedChange?: (cb: (maximized: boolean) => void) => () => void
      marketplaceDownload?: (url: string) => Promise<string>
      marketplaceInstall?: (input: { dir: string; files: Array<{ path: string; data: string }> }) => Promise<string>
      marketplaceRemove?: (dir: string) => Promise<void>
      marketplaceGitInstall?: (input: { name: string; url: string; ref?: string; subdir?: string }) => Promise<{
        dir: string
        skillsPath?: string
        mcpServers?: Record<string, unknown>
        commands: number
        agents: number
      }>
      setKeepAwake?: (enabled: boolean) => Promise<boolean>
      keepAwakeEnabled?: boolean
      toPreviewUrl?: (url: string) => string
      setPreviewInspectorOrigin?: (origin: string) => Promise<void>
      updateFloatingAgentState?: (state: {
        current?: string
        agents: Array<{ name: string; mode: string; hidden?: boolean; options?: Record<string, unknown> }>
        tasks?: Array<{
          id?: string
          content: string
          status: string
          priority: string
          startedAt?: number
          completedAt?: number
          durationMs?: number
        }>
        taskGroups?: Array<{
          id: string
          label: string
          sessionID: string
          tasks: Array<{
            id?: string
            content: string
            status: string
            priority: string
            startedAt?: number
            completedAt?: number
            durationMs?: number
          }>
          updatedAt?: number
        }>
        currentTaskGroupID?: string
      }) => Promise<void>
      showFloatingWidget?: () => Promise<void>
      resolveFloatingNotification?: (input: {
        sessionID: string
        requestID: string
        status: "replied" | "dismissed"
      }) => Promise<void>
      onFloatingAgentChange?: (
        cb: (state: {
          current?: string
          agents: Array<{ name: string; mode: string; hidden?: boolean; options?: Record<string, unknown> }>
          tasks?: Array<{ content: string; status: string; priority: string }>
        }) => void,
      ) => (() => void) | undefined
    }
  }
}

function QueryProvider(props: ParentProps) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
              <CommandProvider>
                <HighlightsProvider>
                  <Layout>{props.children}</Layout>
                </HighlightsProvider>
              </CommandProvider>
            </ModelsProvider>
          </NotificationProvider>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function SessionProviders(props: ParentProps<{ directory: Accessor<string> }>) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <PreviewInspectionProvider directory={props.directory}>
            <OfficeAgentProvider>
              <CommentsProvider>{props.children}</CommentsProvider>
            </OfficeAgentProvider>
          </PreviewInspectionProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <AppShellProviders>
      {/*<Suspense fallback={<Loading />}>*/}
      {props.appChildren}
      {props.children}
      {/*</Suspense>*/}
    </AppShellProviders>
  )
}

export function AppBaseProviders(props: ParentProps<{ locale?: Locale }>) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode) => {
          void window.api?.setTitlebar?.({ mode })
        }}
      >
        <LanguageProvider locale={props.locale}>
          <UiI18nBridge>
            <ErrorBoundary
              fallback={(error) => {
                Sentry.captureException(error)
                return <ErrorPage error={error} />
              }}
            >
              <QueryProvider>
                <DialogProvider>
                  <MarkedProvider>
                    <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                  </MarkedProvider>
                </DialogProvider>
              </QueryProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ConnectionGate(props: ParentProps<{ disableHealthCheck?: boolean }>) {
  const server = useServer()
  const checkServerHealth = useCheckServerHealth()

  const [checkMode, setCheckMode] = createSignal<"blocking" | "background">("blocking")

  // performs repeated health check with a grace period for
  // non-http connections, otherwise fails instantly
  const [startupHealthCheck, healthCheckActions] = createResource(() =>
    props.disableHealthCheck
      ? true
      : Effect.gen(function* () {
          if (!server.current) return true
          const { http, type } = server.current

          // 每次探测之间留一点间隔：失败时 Chromium 会把每条请求都打成
          // net::ERR_CONNECTION_REFUSED，紧循环会在两秒内刷出几十条日志。
          // 这里的等待同时也是给 sidecar 重启留出的时间。
          while (true) {
            const res = yield* Effect.promise(() => checkServerHealth(http))
            if (res.healthy) return true
            if (checkMode() === "background" || type === "http") {
              // 后台模式下再给一次机会：sidecar 崩溃后会被自动重启，
              // 多等一轮能让界面自己恢复，而不是停在「连不上」。
              yield* Effect.sleep("1 second")
              const retry = yield* Effect.promise(() => checkServerHealth(http))
              if (retry.healthy) return true
              return false
            }
            yield* Effect.sleep("500 millis")
          }
        }).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(false) }),
          Effect.ensuring(Effect.sync(() => setCheckMode("background"))),
          Effect.runPromise,
        ),
  )

  createEffect(() => {
    if (!startupHealthCheck() || typeof window === "undefined") return
    const frame = requestAnimationFrame(() => void window.api?.showFloatingWidget?.())
    onCleanup(() => cancelAnimationFrame(frame))
  })

  return (
    <Suspense
      fallback={
        <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background">
          <Splash class="w-28 h-28 opacity-80 animate-pulse" />
        </div>
      }
    >
      {/*<Show
        when={checkMode() === "blocking" ? !startupHealthCheck.loading : startupHealthCheck.state !== "pending"}
        fallback={
          <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background">
            <Splash class="w-28 h-28 opacity-80 animate-pulse" />
          </div>
        }
      >*/}
      {checkMode() === "blocking" ? startupHealthCheck() : startupHealthCheck.latest}
      <Show
        when={startupHealthCheck()}
        fallback={
          <ConnectionError
            onRetry={() => {
              if (checkMode() === "background") void healthCheckActions.refetch()
            }}
            onServerSelected={(key) => {
              setCheckMode("blocking")
              server.setActive(key)
              void healthCheckActions.refetch()
            }}
          />
        }
      >
        {props.children}
      </Show>
      {/*</Show>*/}
    </Suspense>
  )
}

function ConnectionError(props: { onRetry?: () => void; onServerSelected?: (key: ServerConnection.Key) => void }) {
  const language = useLanguage()
  const server = useServer()
  const others = () => server.list.filter((s) => ServerConnection.key(s) !== server.key)
  const name = createMemo(() => server.name || server.key)
  const serverToken = "\u0000server\u0000"
  const unreachable = createMemo(() => language.t("app.server.unreachable", { server: serverToken }).split(serverToken))

  const timer = setInterval(() => props.onRetry?.(), 1000)
  onCleanup(() => clearInterval(timer))

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background gap-6 p-6">
      <div class="flex flex-col items-center max-w-md text-center">
        {/* Splash 的 viewBox 是正方形（120×120），`w-12 h-15` 会把它压扁。 */}
        <Splash class="w-12 h-12 mb-4" />
        <p class="text-14-regular text-foreground">
          {unreachable()[0]}
          <span class="text-foreground font-medium">{name()}</span>
          {unreachable()[1]}
        </p>
        <p class="mt-1 text-12-regular text-foreground-subtle">{language.t("app.server.retrying")}</p>
      </div>
      <Show when={others().length > 0}>
        <div class="flex flex-col gap-2 w-full max-w-sm">
          <span class="text-12-regular text-foreground text-center">{language.t("app.server.otherServers")}</span>
          <div class="flex flex-col gap-1 bg-surface rounded-lg p-2">
            <For each={others()}>
              {(conn) => {
                const key = ServerConnection.key(conn)
                return (
                  <button
                    type="button"
                    class="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-hover transition-colors text-left"
                    onClick={() => props.onServerSelected?.(key)}
                  >
                    <span class="text-14-regular text-foreground truncate">{serverName(conn)}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.key} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean
}) {
  return (
    <ServerProvider
      defaultServer={props.defaultServer}
      disableHealthCheck={props.disableHealthCheck}
      servers={props.servers}
    >
      <ConnectionGate disableHealthCheck={props.disableHealthCheck}>
        <ServerKey>
          <QueryProvider>
            <GlobalSDKProvider>
              <GlobalSyncProvider>
                <Dynamic
                  component={props.router ?? Router}
                  root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
                >
                  <Route path="/" component={HomeRoute} />
                  <Route path="/pulse" component={() => <Navigate href="/" />} />
                  <Route path="/:dir" component={DirectoryLayout}>
                    <Route path="/" component={SessionIndexRoute} />
                    <Route path="/session/:id?" component={SessionRoute} />
                  </Route>
                </Dynamic>
              </GlobalSyncProvider>
            </GlobalSDKProvider>
          </QueryProvider>
        </ServerKey>
      </ConnectionGate>
    </ServerProvider>
  )
}
