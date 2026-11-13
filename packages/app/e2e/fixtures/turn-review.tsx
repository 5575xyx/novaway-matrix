import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { PlatformProvider, type Platform } from "@/context/platform"
import { ThemeProvider } from "@novaway/ui/theme/context"
import { LanguageProvider } from "@/context/language"
import { TimelineDiffSummaryRow } from "@/pages/session/message-timeline"

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  back: () => {},
  forward: () => {},
  restart: async () => {},
  notify: async () => {},
}

function Fixture() {
  const [output, setOutput] = createSignal("")
  const [patch, setPatch] = createSignal("+first")
  return (
    <main data-component="session-turn" class="mx-auto flex w-full max-w-[820px] flex-col gap-4 p-5">
      <TimelineDiffSummaryRow
        diffs={[
          {
            file: "packages/app/src/pages/session/file-preview-header.tsx",
            additions: 16,
            deletions: 1,
            patch: patch(),
          },
          { file: "packages/app/src/pages/session/file-tabs.tsx", additions: 1, deletions: 0 },
        ]}
        fallback={false}
        sessionID="fixture"
        userMessageID="turn"
        onReview={(files) => setOutput(JSON.stringify(files))}
        onOpen={setOutput}
      />
      <button data-action="change-patch" onClick={() => setPatch("+second")}>
        Change patch
      </button>
      <output>{output()}</output>
    </main>
  )
}

render(
  () => (
    <PlatformProvider value={platform}>
      <ThemeProvider defaultTheme="parchment">
        <LanguageProvider locale="zh">
          <Fixture />
        </LanguageProvider>
      </ThemeProvider>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
