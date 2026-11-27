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
import { type BaseRouterProps, Navigate, Route, Router, useNavigate, useParams } from "@solidjs/router"
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
  onMount,
  type ParentProps,
  Show,
  Suspense,
  untrack,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { CommandProvider } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { DataProvider } from "@novaway/ui/context"
import { FileProvider } from "@/context/file"
import { PreviewProvider } from "@/context/preview"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
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
import { usePlatform } from "@/context/platform"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import DirectoryLayout from "@/pages/directory-layout"
import { OfficeAgentProvider } from "@/pages/session/office-agent-context"
import Layout from "@/pages/layout"
import { decode64 } from "@/utils/base64"
import { ErrorPage } from "./pages/error"
import { type ServerHealth, useCheckServerHealth } from "./utils/server-health"
import { PluginViewHost, type PluginViewRender } from "@/components/plugin-view-host"
import { installPointerTracking } from "@novaway/ui/util/pointer-origin"
// 「思考过程」图标的思考强度版本：注册一次，所有渲染 message-part 的地方都生效。
import "@/components/session/reasoning-effort-indicator"

const HomeRoute = lazy(() => import("@/pages/home"))
const loadSession = () => import("@/pages/session")
const Session = lazy(loadSession)
const PulseWorkspace = lazy(() => import("@/pages/pulse/PulseWorkspace"))

const Loading = () => {
  const language = useLanguage()
  return (
    <div
      data-component="route-loading"
      role="status"
      aria-label={language.t("common.loading")}
      class="flex size-full min-h-[40vh] flex-col items-center justify-center gap-4 bg-background"
    >
      <div class="relative grid size-14 place-items-center" aria-hidden="true">
        <Splash class="size-9 animate-pulse opacity-80" />
        <div
          class="absolute inset-0 rounded-full border-2 animate-spin"
          style={{ "border-color": "color-mix(in srgb, var(--icon-interactive-base) 24%, transparent)", "border-top-color": "var(--icon-interactive-base)" }}
        />
      </div>
      <span class="text-13-regular text-foreground-subtle">{language.t("common.loading")}</span>
    </div>
  )
}

function HomeRouteWithLoading() {
  return (
    <Suspense fallback={<Loading />}>
      <HomeRoute />
    </Suspense>
  )
}

if (typeof location === "object" && /\/session(?:\/|$)/.test(location.pathname)) {
  void loadSession()
}

function SessionRoute() {
  const params = useParams()
  // 目录从路由参数解：元素选取挂在会话作用域，需要 PromptProvider，而它只在会话路由内
  const directory = createMemo(() => decode64(params.dir) ?? "")

  return (
    <SessionProviders directory={directory}>
      <Suspense fallback={<Loading />}>
        <Session />
      </Suspense>
    </SessionProviders>
  )
}

const SessionIndexRoute = () => <Navigate href="session" />

function pluginViewRender(value: unknown): PluginViewRender | undefined {
  if (typeof value !== "object" || value === null || !("type" in value)) return undefined
  const item = value as Record<string, unknown>
  if (item.type === "iframe" && typeof item.url === "string") return { type: "iframe", url: item.url }
  if (item.type === "builtin" && typeof item.component === "string")
    return { type: "builtin", component: item.component }
  return undefined
}

function PluginSurfaceViewRoute() {
  const params = useParams()
  const navigate = useNavigate()
  const globalSync = useGlobalSync()
  const contribution = createMemo(() => {
    const directory = decode64(params.dir) ?? ""
    if (!directory) return undefined
    const [store] = globalSync.child(directory, { bootstrap: false })
    return store.plugin_contributions.find(
      (item) =>
        item.pluginID === params.pluginID &&
        item.kind === "surface" &&
        (item.slot === "sidebar.item" || item.slot === "sidebar.footer" || item.slot === "workbench") &&
        item.status === "active" &&
        item.action !== undefined &&
        typeof item.action === "object" &&
        item.action !== null &&
        "type" in item.action &&
        item.action.type === "view" &&
        "viewId" in item.action &&
        item.action.viewId === params.viewId,
    )
  })

  return (
    <Show
      when={contribution()}
      fallback={
        <div class="size-full flex items-center justify-center text-14-regular text-foreground-subtle">
          插件视图不可用
        </div>
      }
    >
      {(item) => {
        const action = item().action as { type?: unknown; viewId?: unknown; render?: unknown } | undefined
        const render = pluginViewRender(action?.render)
        return (
          <main
            data-component="plugin-surface-view"
            data-plugin-id={item().pluginID}
            data-view-id={params.viewId}
            class="size-full"
          >
            <Show
              when={render?.type === "builtin" && render.component === "operations-workbench"}
              fallback={
                <PluginViewHost
                  pluginID={item().pluginID}
                  viewID={params.viewId}
                  render={render}
                  data={{
                    pluginID: item().pluginID,
                    contribution: item().localName,
                    title: item().title,
                    viewID: params.viewId,
                  }}
                  fallback={
                    <div class="size-full p-6">
                      <h1 class="text-20-medium text-foreground">{item().title}</h1>
                      <p class="mt-2 text-14-regular text-foreground-subtle">插件视图：{params.viewId}</p>
                    </div>
                  }
                />
              }
            >
              <Suspense fallback={<Loading />}>
                <PulseWorkspace onBack={() => navigate(`/${params.dir}`)} />
              </Suspense>
            </Show>
          </main>
        )
      }}
    </Show>
  )
}

function GlobalChatSession() {
  const sync = useSync()
  // 消息渲染组件依赖 DataProvider（项目路由由 DirectoryLayout 提供）。
  return (
    <DataProvider data={sync.data} directory="global-chat" onSessionHref={(id) => `/global-chat/session/${id}`}>
      <Suspense fallback={<Loading />}>
        <Session />
      </Suspense>
    </DataProvider>
  )
}

function GlobalChatRoute() {
  const directory = createMemo(() => "global-chat")
  const globalSync = useGlobalSync()
  createEffect(() => globalSync.bootstrapInstance(directory()))
  return (
    <SDKProvider directory={directory}>
      <SyncProvider>
        <PreviewProvider directory={directory}>
          <LocalProvider>
            <SessionProviders directory={directory}>
              <GlobalChatSession />
            </SessionProviders>
          </LocalProvider>
        </PreviewProvider>
      </SyncProvider>
    </SDKProvider>
  )
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __NOVAWAY__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
      openFiles?: string[]
      wsl?: boolean
    }
    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
      minimizeWindow?: () => Promise<void>
      toggleMaximizeWindow?: () => Promise<void>
      closeWindow?: () => Promise<void>
      getNativeSpeechBackends?: () => Promise<
        Array<{
          name: string
          description: string
          kind: string
          deviceType: string
          deviceId: string | null
          memoryTotal: number
          memoryFree: number
          index: number | null
        }>
      >
      getNativeSpeechModels?: () => Promise<
        Array<{
          id: string
          label: string
          family: string
          languages: readonly string[]
          sizeBytes: number
          fileName: string
          downloadUrl: string
          path: string
          downloaded: boolean
          bytes: number
        }>
      >
      downloadNativeSpeechModel?: (id: string) => Promise<string>
      onNativeSpeechDownloadProgress?: (callback: (event: { id: string; progress: number }) => void) => () => void
      transcribeNativeSpeech?: (
        id: string,
        pcm: Float32Array,
        language: string,
      ) => Promise<{ text: string; device: { name: string; kind: string; deviceType: string } }>
      startNativeSpeechStream?: (
        id: string,
        language: string,
      ) => Promise<{ streaming: boolean; device: { name: string; kind: string; deviceType: string } }>
      feedNativeSpeechStream?: (
        id: string,
        pcm: Float32Array,
      ) => Promise<{ full: string; committed: string; tentative: string }>
      stopNativeSpeechStream?: (id: string) => Promise<{ text: string; committed: string; tentative: string }>
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
      /** 选择本地文件（发布弹窗选视频/图片，桌面端才有的能力）。 */
      openFilePicker?: (opts?: {
        multiple?: boolean
        title?: string
        defaultPath?: string
        accept?: string[]
        extensions?: string[]
      }) => Promise<string | string[] | null>
      toPreviewUrl?: (url: string) => string
      setPreviewInspectorOrigin?: (origin: string) => Promise<void>
      getResourceReport?: () => Promise<{
        generatedAt: number
        totalSize: number
        locations: Array<{
          id: "data" | "config" | "cache" | "temp" | "logs"
          label: string
          path: string
          defaultPath: string
          size: number
          fileCount: number
          lastModified: number | null
          exists: boolean
        }>
      }>
      setResourceLocation?: (id: "data" | "config" | "cache" | "temp" | "logs", path: string) => Promise<unknown>
      getResourceCleanupConfig?: () => Promise<{
        enabled: boolean
        interval: "daily" | "weekly"
        olderThanDays: number
        lastRunAt: number | null
      }>
      setResourceCleanupConfig?: (config: {
        enabled: boolean
        interval: "daily" | "weekly"
        olderThanDays: number
      }) => Promise<{
        enabled: boolean
        interval: "daily" | "weekly"
        olderThanDays: number
        lastRunAt: number | null
      }>
      cleanResources?: (olderThanDays: number) => Promise<{ deletedFiles: number; deletedBytes: number }>
      openDirectoryPicker?: (opts?: { title?: string; defaultPath?: string }) => Promise<string | string[] | null>
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
  const platform = usePlatform()
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode) => {
          void window.api?.setTitlebar?.({ mode })
          void platform.setAppAppearanceMode?.(mode)
        }}
      >
        <LanguageProvider locale={props.locale}>
          <UiI18nBridge>
            <ErrorBoundary
              fallback={(error) => {
                Sentry.captureException(error)
                return <ErrorPage error={error} restart={() => window.location.reload()} />
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

function ConnectionGate(props: { disableHealthCheck?: boolean; children: (health: ServerHealth) => JSX.Element }) {
  const server = useServer()
  const platform = usePlatform()
  const [appIcon, setAppIcon] = createSignal<string>()
  const checkServerHealth = useCheckServerHealth()

  onMount(() => {
    if (platform.platform !== "desktop") return
    void platform.getAppAppearance?.().then((appearance) => setAppIcon(appearance.iconData))
    const dispose = platform.onAppAppearanceChange?.((appearance) => setAppIcon(appearance.iconData))
    if (dispose) onCleanup(dispose)
  })
  const splash = (className: string) => (
    <Show when={platform.platform === "desktop" && appIcon()} fallback={<Splash class={className} />}>
      {(src) => <img src={src()} alt="" class={className} draggable={false} />}
    </Show>
  )

  const [checkMode, setCheckMode] = createSignal<"blocking" | "background">("blocking")

  // performs repeated health check with a grace period for
  // non-http connections, otherwise fails instantly
  const [startupHealthCheck, healthCheckActions] = createResource(() =>
    props.disableHealthCheck
      ? { healthy: true } satisfies ServerHealth
      : Effect.gen(function* () {
          if (!server.current) return { healthy: true } satisfies ServerHealth
          const { http, type } = server.current

          // 每次探测之间留一点间隔：失败时 Chromium 会把每条请求都打成
          // net::ERR_CONNECTION_REFUSED，紧循环会在两秒内刷出几十条日志。
          // 这里的等待同时也是给 sidecar 重启留出的时间。
          while (true) {
            const res = yield* Effect.promise(() => checkServerHealth(http))
            if (res.healthy) return res
            if (checkMode() === "background" || type === "http") {
              // 后台模式下再给一次机会：sidecar 崩溃后会被自动重启，
              // 多等一轮能让界面自己恢复，而不是停在「连不上」。
              yield* Effect.sleep("1 second")
              const retry = yield* Effect.promise(() => checkServerHealth(http))
              if (retry.healthy) return retry
              return { healthy: false } satisfies ServerHealth
            }
            yield* Effect.sleep("500 millis")
          }
        }).pipe(
          Effect.timeoutOrElse({
            duration: "10 seconds",
            orElse: () => Effect.succeed({ healthy: false } satisfies ServerHealth),
          }),
          Effect.ensuring(Effect.sync(() => setCheckMode("background"))),
          Effect.runPromise,
        ),
  )

  return (
    <Suspense
      fallback={
        <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background">
          {splash("w-28 h-28 opacity-80 animate-pulse")}
        </div>
      }
    >
      <Show
        when={startupHealthCheck()?.healthy}
        fallback={
          <ConnectionError
            onRetry={() => {
              if (checkMode() === "background") void healthCheckActions.refetch()
            }}
            onServerSelected={(key) => {
              server.setActive(key)
            }}
          />
        }
      >
        {props.children(untrack(() => startupHealthCheck()) ?? { healthy: false })}
      </Show>
    </Suspense>
  )
}

function ConnectionError(props: { onRetry?: () => void; onServerSelected?: (key: ServerConnection.Key) => void }) {
  const language = useLanguage()
  const server = useServer()
  const platform = usePlatform()
  const [appIcon, setAppIcon] = createSignal<string>()
  onMount(() => {
    if (platform.platform !== "desktop") return
    void platform.getAppAppearance?.().then((appearance) => setAppIcon(appearance.iconData))
    const dispose = platform.onAppAppearanceChange?.((appearance) => setAppIcon(appearance.iconData))
    if (dispose) onCleanup(dispose)
  })
  const splash = (className: string) => (
    <Show when={platform.platform === "desktop" && appIcon()} fallback={<Splash class={className} />}>
      {(src) => <img src={src()} alt="" class={className} draggable={false} />}
    </Show>
  )
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
        {splash("w-12 h-12 mb-4")}
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
      <ServerKey>
        <ConnectionGate disableHealthCheck={props.disableHealthCheck}>
          {(health) => (
            <QueryProvider>
              <GlobalSDKProvider>
                <GlobalSyncProvider sessionCacheIdentity={health.sessionLibrary}>
                  <Dynamic
                    component={props.router ?? Router}
                    root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
                  >
                    <Route path="/" component={HomeRouteWithLoading} />
                    <Route path="/global-chat/session/:id?" component={GlobalChatRoute} />
                    <Route path="/pulse" component={() => <Navigate href="/" />} />
                    <Route path="/:dir" component={DirectoryLayout}>
                      <Route path="/" component={SessionIndexRoute} />
                      <Route path="/plugin-view/:pluginID/:viewId" component={PluginSurfaceViewRoute} />
                      <Route path="/session/:id?" component={SessionRoute} />
                    </Route>
                  </Dynamic>
                </GlobalSyncProvider>
              </GlobalSDKProvider>
            </QueryProvider>
          )}
        </ConnectionGate>
      </ServerKey>
    </ServerProvider>
  )
}
