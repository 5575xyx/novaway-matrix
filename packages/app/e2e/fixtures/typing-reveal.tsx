// e2e 夹具：把真实的打字机状态机（src/utils/typing-reveal.ts）挂到页面上，
// 由 Playwright 通过 window.__typing 驱动，验证"只打新增行、不闪、不重来"。
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { createTypingReveal } from "../../src/utils/typing-reveal"

type Hooks = {
  setText: (value: string) => void
  setLive: (value: boolean) => void
  setScope: (value: string) => void
  shown: () => string
}

function Fixture() {
  const [text, setText] = createSignal("")
  const [live, setLive] = createSignal(false)
  const [scope, setScope] = createSignal("a")
  const shown = createTypingReveal({ source: text, live, scope })

  const hooks: Hooks = { setText, setLive, setScope, shown }
  ;(window as unknown as { __typing: Hooks }).__typing = hooks

  return (
    <pre id="shown" data-length={String(shown().length)}>
      {shown()}
    </pre>
  )
}

render(() => <Fixture />, document.getElementById("root")!)
