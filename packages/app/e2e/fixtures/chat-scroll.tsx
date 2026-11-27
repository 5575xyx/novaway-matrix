import { For } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { ThemeProvider } from "@novaway/ui/theme/context"
import { MarkedProvider } from "@novaway/ui/context/marked"
import { DialogProvider } from "@novaway/ui/context/dialog"
import { Markdown } from "@novaway/ui/markdown"
import { MarkdownStreamPaintDemo } from "./markdown-stream-paint-demo"

type Row = { id: number; kind: "user" | "assistant" | "thinking" | "tool"; text: string }

const rows: Row[] = Array.from({ length: 240 }, (_, index) => {
  const turn = Math.floor(index / 4) + 1
  const kind = (["user", "assistant", "thinking", "tool"] as const)[index % 4]
  const code = ["```ts", `const turn = ${turn}`, "console.log(turn)", "```"].join("\n")
  const text =
    kind === "user"
      ? `第 ${turn} 轮：请解释这个改动，并列出要验证的边界情况。`
      : kind === "assistant"
        ? [
            `第 ${turn} 轮，先确认目标和约束，再拆解验证步骤。`,
            "",
            "- 检查主要路径",
            "- 确认异常分支",
            "- 对照运行结果",
            "",
            code,
          ].join("\n")
        : kind === "thinking"
          ? `分析第 ${turn} 轮中的状态变化、可见性和滚动锚点。`
          : `工具结果 ${turn}：扫描完成，发现 2 个相关文件，没有执行外部操作。`
  return { id: index, kind, text }
})

function Fixture() {
  return (
    <>
      <output id="metrics">rows={rows.length}</output>
      <div id="scroll-root" data-scrollable>
        <main id="timeline" data-component="message-timeline">
          <For each={rows}>
            {(row) => (
              <article data-timeline-row={row.kind} data-row-index={row.id}>
                <div class={row.kind}>{row.kind === "assistant" ? <Markdown text={row.text} /> : row.text}</div>
              </article>
            )}
          </For>
        </main>
      </div>
    </>
  )
}

render(
  () => (
    <ThemeProvider>
      <DialogProvider>
        {location.search === "?pending-parse" ? (
          <MarkdownStreamPaintDemo />
        ) : (
          <MarkedProvider><Fixture /></MarkedProvider>
        )}
      </DialogProvider>
    </ThemeProvider>
  ),
  document.getElementById("root")!,
)
