import "@/index.css"
import { render } from "solid-js/web"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { DialogProvider } from "@novaway/ui/context/dialog"
import { ThemeProvider } from "@novaway/ui/theme/context"
import { PlatformProvider, type Platform } from "@/context/platform"
import { LanguageProvider } from "@/context/language"
import { ServerConnection, ServerProvider } from "@/context/server"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { GlobalSyncProvider } from "@/context/global-sync"
import { SettingsMemoryEvolution } from "@/components/settings-memory-evolution"

const params = new URLSearchParams(location.search)
const serverUrl = params.get("server") ?? "http://127.0.0.1:4096"
const directory = params.get("dir") ?? "/tmp/demo-project"

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  back: () => {},
  forward: () => {},
  restart: async () => {},
  notify: async () => {},
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
})

const conn: ServerConnection.Http = { type: "http", http: { url: serverUrl } }

render(
  () => (
    <PlatformProvider value={platform}>
      <ThemeProvider defaultTheme="parchment">
        <LanguageProvider locale="zh">
          <QueryClientProvider client={queryClient}>
            <DialogProvider>
              <ServerProvider defaultServer={ServerConnection.key(conn)} servers={[conn]} disableHealthCheck>
                <GlobalSDKProvider>
                  <GlobalSyncProvider>
                    <div class="h-dvh bg-background text-foreground">
                      <SettingsMemoryEvolution directory={directory} />
                    </div>
                  </GlobalSyncProvider>
                </GlobalSDKProvider>
              </ServerProvider>
            </DialogProvider>
          </QueryClientProvider>
        </LanguageProvider>
      </ThemeProvider>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
