// @refresh reload

import {
  AppBaseProviders,
  AppInterface,
  handleNotificationClick,
  loadLocaleDict,
  normalizeLocale,
  type Locale,
  PlatformProvider,
  ServerConnection,
  useCommand,
} from "@novaway/app"
import * as Sentry from "@sentry/solid"
import { MemoryRouter } from "@solidjs/router"
import { Splash } from "@novaway/ui/logo"
import { createEffect, createResource, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../../package.json"
import { initI18n, t } from "./i18n"
import { createPlatform, listenForDeepLinks, listenForOpenFiles } from "./platform"
import "./styles.css"
import { useTheme } from "@novaway/ui/theme"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `desktop@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "desktop",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" &&
          !(
            import.meta.env.VITE_NOVAWAY_CHANNEL === "prod" &&
            (i.name === "GlobalHandlers" || i.name === "BrowserApiErrors")
          ),
      )
    },
  })
}

function StartupFallback() {
  return (
    <div
      data-component="desktop-startup-loading"
      role="status"
      aria-label={t("desktop.loading.startingServer")}
      class="flex h-dvh w-screen flex-col items-center justify-center gap-5 bg-background"
    >
      <div class="relative grid size-20 place-items-center" aria-hidden="true">
        <Splash class="size-14 animate-pulse opacity-80" />
        <div
          class="absolute inset-0 rounded-full border-2 animate-spin"
          style={{ "border-color": "color-mix(in srgb, var(--icon-interactive-base) 24%, transparent)", "border-top-color": "var(--icon-interactive-base)" }}
        />
      </div>
      <span class="text-14-regular text-foreground-subtle">{t("desktop.loading.startingServer")}</span>
      <div class="h-1 w-40 overflow-hidden rounded-full bg-surface" aria-hidden="true">
        <div class="h-full w-1/3 animate-pulse rounded-full bg-icon-interactive-base" />
      </div>
    </div>
  )
}

void initI18n()

let menuTrigger = null as null | ((id: string) => void)
if (window.api) {
  window.api.onMenuCommand((id) => {
    menuTrigger?.(id)
  })
  window.api.onNotificationClick((href) => {
    handleNotificationClick(href)
  })
} else {
  console.error("preload 脚本未正确暴露 window.api，部分桌面功能将不可用")
}
listenForDeepLinks()
listenForOpenFiles()

render(() => {
  const platform = createPlatform()
  const [windowConfig] = createResource(() => window.api.getWindowConfig().catch(() => ({ updaterEnabled: false })))
  const loadLocale = async () => {
    const raw = await platform.storage?.("novaway.global.dat").getItem("language")
    if (!raw) return
    const locale = raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
    if (!locale) return
    const next = normalizeLocale(locale)
    if (next !== "en") await loadLocaleDict(next)
    return next satisfies Locale
  }

  const [windowCount] = createResource(() => window.api.getWindowCount())

  // Fetch sidecar credentials (available immediately, before health check)
  const [sidecar] = createResource(() => window.api.awaitInitialization(() => undefined))

  const [defaultServer] = createResource(() =>
    platform.getDefaultServer?.().then((url) => {
      if (url) return ServerConnection.key({ type: "http", http: { url } })
    }),
  )
  const [locale] = createResource(loadLocale)

  const servers = () => {
    const data = sidecar()
    if (!data) return []
    const server: ServerConnection.Sidecar = {
      displayName: "Local Server",
      type: "sidecar",
      variant: "base",
      http: {
        url: data.url,
        username: data.username ?? undefined,
        password: data.password ?? undefined,
      },
    }
    return [server] as ServerConnection.Any[]
  }

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  function Inner() {
    const cmd = useCommand()
    menuTrigger = (id) => cmd.trigger(id)

    const theme = useTheme()

    createEffect(() => {
      theme.themeId()
      theme.mode()
      // 与工作区窗口根底色一致：根节点用的是 background-weak（比面板暗/亮一档），
      // 窗口原生底色若仍取 background-base，四帧之外那圈 4px 留白会露出错误的颜色。
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-weak").trim()
      if (bg) {
        void window.api.setBackgroundColor(bg)
      }
    })

    return null
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show
          when={
            !defaultServer.loading &&
            !sidecar.loading &&
            !windowConfig.loading &&
            !windowCount.loading &&
            !locale.loading
          }
          fallback={<StartupFallback />}
        >
          {(_) => {
            return (
              <AppInterface
                defaultServer={defaultServer.latest ?? ServerConnection.Key.make("sidecar")}
                servers={servers()}
                router={MemoryRouter}
              >
                <Inner />
              </AppInterface>
            )
          }}
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
