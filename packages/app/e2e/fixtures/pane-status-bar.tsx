// e2e 夹具：把统一底部状态栏（src/pages/session/pane-status-bar.tsx）挂在一个模拟右栏里，
// 验证它存在的理由：
//   1. 信息区 + 缩放控件一行排开，不换行；
//   2. − / % / ＋ 三个控件齐全，点「＋」百分比上涨、点「−」回落、点百分比复位；
//   3. 「适应」按钮只在 fitLabel 传入时出现，点它执行 onFit。
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { PaneStatusBar } from "@/pages/session/pane-status-bar"

const [zoom, setZoom] = createSignal(100)
const [fit, setFit] = createSignal(false)
const [events, setEvents] = createSignal<string[]>([])

function log(id: string) {
  setEvents((prev) => [...prev, id])
}

;(window as unknown as { __statusbar: { zoom: () => number; events: () => string[] } }).__statusbar = {
  zoom,
  events,
}

render(
  () => (
    <div class="p-4">
      <div data-e2e="panel" class="flex flex-col border border-border" style={{ width: "420px", height: "160px" }}>
        <div data-e2e="document" class="min-h-0 flex-1 bg-background" />
        <PaneStatusBar
          info={<span data-e2e="info">第 3 页</span>}
          extra={<button data-e2e="extra">放映</button>}
          zoom={{
            value: () => zoom(),
            onStep: (in_) => {
              log(in_ ? "in" : "out")
              setZoom((x) => Math.max(25, Math.min(400, x + (in_ ? 10 : -10))))
            },
            onReset: () => {
              log("reset")
              setZoom(100)
              setFit(true)
            },
            fitLabel: "适应",
            onFit: () => {
              log("fit")
              setZoom(100)
              setFit(true)
            },
            fitted: () => fit(),
          }}
        />
      </div>
      <div data-slot="state">{events().join(",")}</div>
    </div>
  ),
  document.getElementById("root")!,
)
