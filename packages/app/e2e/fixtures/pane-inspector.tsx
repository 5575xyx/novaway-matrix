// e2e 夹具：把真实的检查器抽屉（src/pages/session/pane-inspector.tsx）挂在一个模拟右栏里，
// 验证它存在的理由：
//   1. 工具条那一行只留命令，数值输入全部在抽屉里；
//   2. 抽屉浮在文档右缘，宽度固定，不推挤文档；
//   3. Esc 只收抽屉，不会顺着外层一路把面板也关掉。
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { RibbonRow, RIBBON_BUTTON } from "@/pages/session/office-ribbon"
import {
  InspectorAction,
  InspectorField,
  INSPECTOR_INPUT,
  InspectorSection,
  InspectorToggle,
  PaneInspector,
} from "@/pages/session/pane-inspector"

type Hooks = {
  open: () => void
  close: () => void
  events: () => string[]
}

const [events, setEvents] = createSignal<string[]>([])
const [open, setOpen] = createSignal(false)
const [crop, setCrop] = createSignal("0")
const [box, setBox] = createSignal({ x: 40, width: 200 })

function log(id: string) {
  setEvents((prev) => [...prev, id])
}

const hooks: Hooks = {
  open: () => setOpen(true),
  close: () => setOpen(false),
  events,
}
;(window as unknown as { __inspector: Hooks }).__inspector = hooks

render(
  () => (
    <div class="p-4">
      {/* 外层同样监听 Esc：抽屉里 stopPropagation 之后，这里不应该再收到。 */}
      <div
        data-e2e="panel"
        class="relative flex flex-col border border-border"
        style={{ width: "420px", height: "320px" }}
        onKeyDown={() => log("outer-esc")}
      >
        <RibbonRow>
          <InspectorToggle
            open={open()}
            onToggle={() => {
              setOpen(!open())
              log("toggle")
            }}
          />
        </RibbonRow>
        <div data-e2e="document" class="min-h-0 flex-1 bg-background" />
        {open() ? (
          <PaneInspector
            title="PDF 检查器"
            hint="第 3 页"
            onClose={() => {
              setOpen(false)
              log("close")
            }}
          >
            <InspectorSection label="裁边">
              <InspectorField label="四边" title="四边各裁掉多少 pt">
                <input
                  type="number"
                  data-action="pdf-crop-input"
                  class={INSPECTOR_INPUT}
                  value={crop()}
                  onInput={(event) => setCrop(event.currentTarget.value)}
                />
                <span class="shrink-0 text-11-regular text-foreground-subtlest">pt</span>
              </InspectorField>
            </InspectorSection>
            <InspectorSection label="图片位置">
              <InspectorField label="x" title="左下角 x 坐标（pt）">
                <input
                  type="number"
                  data-action="pdf-image-x"
                  class={INSPECTOR_INPUT}
                  value={box().x}
                  onInput={(event) => setBox({ ...box(), x: Number(event.currentTarget.value) })}
                />
              </InspectorField>
              <InspectorField label="微调" title="每次移动 10pt">
                <button type="button" data-action="pdf-image-left" class={RIBBON_BUTTON} onClick={() => log("left")}>
                  ←
                </button>
                <button type="button" data-action="pdf-image-right" class={RIBBON_BUTTON} onClick={() => log("right")}>
                  →
                </button>
              </InspectorField>
              <InspectorField label="宽">
                <input
                  type="number"
                  data-action="pdf-image-width"
                  class={INSPECTOR_INPUT}
                  value={box().width}
                  onInput={(event) => setBox({ ...box(), width: Number(event.currentTarget.value) })}
                />
              </InspectorField>
              <InspectorAction
                actionId="pdf-image-apply"
                disabled={box().width <= 0}
                title="把位置写回 PDF"
                onClick={() => log("apply")}
              >
                应用图片位置
              </InspectorAction>
            </InspectorSection>
          </PaneInspector>
        ) : null}
      </div>
      <div data-slot="state">{events().join(",")}</div>
    </div>
  ),
  document.getElementById("root")!,
)
