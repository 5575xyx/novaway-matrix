import { For } from "solid-js"
import { render } from "solid-js/web"
import type { AssistantMessage, ToolPart } from "@novaway/sdk/v2"
import { DataProvider, DialogProvider, FileComponentProvider, I18nProvider } from "@novaway/ui/context"
import { File } from "@novaway/ui/file"
import { ContextToolGroup, Part } from "@novaway/ui/message-part"
import { ThemeProvider, useTheme } from "@novaway/ui/theme/context"
import { LanguageProvider, useLanguage } from "@/context/language"
import { PlatformProvider, type Platform } from "@/context/platform"
import "@/index.css"

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  back: () => {},
  forward: () => {},
  restart: async () => {},
  notify: async () => {},
}

const directory = String.raw`C:\fixture`
const time = { start: 1, end: 2 }
const message: AssistantMessage = {
  id: "msg-fixture",
  sessionID: "ses-fixture",
  role: "assistant",
  parentID: "msg-parent",
  time: { created: 1, completed: 2 },
  modelID: "fixture",
  providerID: "fixture",
  mode: "build",
  agent: "build",
  path: { cwd: directory, root: directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}

function part(tool: string, state: ToolPart["state"], id = tool): ToolPart {
  return { id, type: "tool", callID: id, tool, messageID: message.id, sessionID: message.sessionID, state }
}

const completed = (state: Partial<Extract<ToolPart["state"], { status: "completed" }>> = {}) =>
  ({ status: "completed", input: {}, output: "", title: "", metadata: {}, time, ...state }) as const

const rows = [
  part(
    "edit",
    completed({
      title: "src/renamed.ts",
      metadata: {
        filediff: {
          file: String.raw`C:\fixture\src\renamed.ts`,
          additions: 1,
          deletions: 1,
          patch: "--- src/renamed.ts\n+++ src/renamed.ts\n@@ -1 +1 @@\n-before\n+after\n",
        },
      },
    }),
  ),
  part("write", {
    status: "error",
    input: { filePath: String.raw`C:\fixture\blocked.ts` },
    error: "Permission denied",
    time,
  }),
  part("apply_patch", {
    status: "error",
    input: { patchText: "*** Begin Patch\n*** Update File: src/main.ts\n@@\n-old\n+new\n*** End Patch" },
    error: "Permission denied",
    time,
  }),
  part("edit", completed({ title: "src/history.ts" }), "history"),
  part(
    "write",
    completed({
      metadata: {
        filepath: "src/new.ts",
        filediff: {
          file: "src/new.ts",
          additions: 1,
          deletions: 0,
          patch: "--- src/new.ts\n+++ src/new.ts\n@@ -0,0 +1 @@\n+new file content\n",
        },
      },
    }),
    "write-history",
  ),
  part("bash", completed({ input: { command: "echo ok" } })),
]

function Fixture() {
  const theme = useTheme()
  const language = useLanguage()
  return (
    <I18nProvider value={{ locale: language.intl, t: language.t }}>
      <DialogProvider>
        <DataProvider
          directory={directory}
          data={{ session: [], session_status: {}, session_diff: {}, message: {}, part: {} }}
        >
          <FileComponentProvider component={File}>
            <main class="mx-auto max-w-xl p-4" data-tool-density="compact">
              <button onClick={() => theme.setColorScheme("light")}>Light</button>
              <button onClick={() => theme.setColorScheme("dark")}>Dark</button>
              <div data-component="turn-fold-rows">
                <For each={rows}>
                  {(row) => (
                    <div data-timeline-row="AssistantPart">
                      <div data-slot="session-turn-assistant-content" data-testid={row.id}>
                        <Part part={row} message={message} />
                      </div>
                    </div>
                  )}
                </For>
                <div data-slot="side-pane-assistant" data-testid="context">
                  <ContextToolGroup parts={[part("read", completed({ input: { filePath: "src/main.ts" } }))]} />
                </div>
              </div>
            </main>
          </FileComponentProvider>
        </DataProvider>
      </DialogProvider>
    </I18nProvider>
  )
}

render(
  () => (
    <PlatformProvider value={platform}>
      <ThemeProvider defaultTheme="novaway">
        <LanguageProvider locale="zh">
          <Fixture />
        </LanguageProvider>
      </ThemeProvider>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
