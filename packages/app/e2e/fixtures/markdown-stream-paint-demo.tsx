import { createSignal } from "solid-js"
import { MarkedProvider } from "@novaway/ui/context/marked"
import { Markdown } from "@novaway/ui/markdown"

let release!: () => void
const pending = new Promise<void>((resolve) => { release = resolve })

async function nativeParser(text: string) {
  if (text === "New reply") await pending
  return `<p data-paint-probe>${text}</p>`
}

export function MarkdownStreamPaintDemo() {
  const [text, setText] = createSignal("Visible reply")
  return (
    <MarkedProvider nativeParser={nativeParser}>
      <button onClick={() => setText("New reply")}>Update text</button>
      <button onClick={release}>Finish parsing</button>
      <button onClick={() => setText("")}>Clear</button>
      <Markdown text={text()} streaming />
    </MarkedProvider>
  )
}

