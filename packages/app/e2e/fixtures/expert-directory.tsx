import { render } from "solid-js/web"
import "@/index.css"
import { ExpertDirectory } from "@/components/expert-directory"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { LanguageProvider } from "@/context/language"
import { PlatformProvider, type Platform } from "@/context/platform"
import { ServerConnection, ServerProvider } from "@/context/server"

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  restart: async () => {},
  back: () => {},
  forward: () => {},
  notify: async () => {},
}
const server: ServerConnection.Http = { type: "http", http: { url: window.location.origin } }

render(
  () => (
    <PlatformProvider value={platform}>
      <LanguageProvider locale="en">
        <ServerProvider defaultServer={ServerConnection.key(server)} servers={[server]} disableHealthCheck>
          <GlobalSDKProvider>
            <div class="h-dvh">
              <ExpertDirectory
                directory="/expert-directory-fixture"
                onBack={() => {}}
                onManage={() => {}}
                onOpenSession={() => {}}
              />
            </div>
          </GlobalSDKProvider>
        </ServerProvider>
      </LanguageProvider>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
