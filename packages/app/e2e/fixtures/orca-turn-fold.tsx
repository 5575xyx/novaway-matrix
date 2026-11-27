import { createSignal, For } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { TurnFoldView } from "@/pages/session/turn-fold-view"
import { ThemeProvider } from "@novaway/ui/theme/context"
import { LanguageProvider } from "@/context/language"
import { PlatformProvider, type Platform } from "@/context/platform"

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  back: () => {},
  forward: () => {},
  restart: async () => {},
  notify: async () => {},
}

const completedRows = ["bun test --filter session", "edit src/pages/session/message-timeline.tsx"]
const interruptedRows = ["bun test --filter timeline"]
const continuedRows = ["edit src/pages/session/message-timeline.data.ts", "bun run typecheck"]

function ProcessRows(props: { rows: string[] }) {
  return (
    <div data-component="turn-fold-rows" data-tool-density="compact">
      <For each={props.rows}>
        {(row) => (
          <div data-timeline-row="AssistantPart" class="min-w-0 w-full">
            <div class="turn-fold-fixture-row">{row}</div>
          </div>
        )}
      </For>
    </div>
  )
}

function Fold(props: { label: string; rows: string[]; testID: string }) {
  const [open, setOpen] = createSignal(false)
  return (
    <section data-testid={props.testID} class="turn-fold-fixture-section">
      <TurnFoldView label={props.label} open={open()} onToggle={() => setOpen((value) => !value)}>
        <ProcessRows rows={props.rows} />
      </TurnFoldView>
    </section>
  )
}

function Fixture() {
  return (
    <main data-component="orca-turn-fold-fixture" class="mx-auto flex w-full max-w-[760px] flex-col gap-2 p-5">
      <Fold testID="completed" label="已运行 2 条命令 和 已编辑 1 个文件" rows={completedRows} />
      <div data-component="turn-divider" class="turn-fold-fixture-divider">
        已中断
      </div>
      <Fold testID="interrupted" label="已运行 1 条命令" rows={interruptedRows} />
      <Fold testID="continued" label="已运行 1 条命令 和 已编辑 1 个文件" rows={continuedRows} />
      <div data-component="error-detail" class="turn-fold-fixture-error">
        失败 1 次：命令返回错误
      </div>
    </main>
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
