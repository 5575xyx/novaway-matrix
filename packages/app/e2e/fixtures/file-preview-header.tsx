// e2e 夹具：把真实的文件预览头部（src/pages/session/file-preview-header.tsx）挂到页面上，
// 用来验证重设计后的三条约定：
//   1. 永远一行 —— 300px 宽的面板里控件不折行、不溢出；
//   2. 动词都在手上 —— 撤销 / 重做 / 保存 / 查找 / 视图▾ / 编辑 直接可点；
//   3. 「正在编辑」用主题强调色，不再写死 emerald（浅色主题下会糊成一片）。
// Playwright 通过 window.__header 改状态，断言按钮的启用与回调。
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { PlatformProvider, type Platform } from "@/context/platform"
import { ThemeProvider } from "@novaway/ui/theme/context"
import { LanguageProvider } from "@/context/language"
import {
  FilePreviewHeader,
  type FilePreviewSaveStatus,
  type PreviewMenuItem,
  type PreviewMenuGroup,
} from "@/pages/session/file-preview-header"

// LanguageProvider 的 locale 走 persisted()，而 persisted() 要读 Platform —— 夹具里给一个
// 最小可用的 web 实现，其余能力（通知、原生存储）这一页用不到。
const platform: Platform = {
  platform: "web",
  openLink: () => {},
  back: () => {},
  forward: () => {},
  restart: async () => {},
  notify: async () => {},
}

type Hooks = {
  dirty: () => void
  saved: () => void
  typed: () => void
  events: () => string[]
}

const openWith: PreviewMenuItem[] = [{ id: "vscode", label: "Visual Studio Code", onSelect: () => log("open-vscode") }]

const views: PreviewMenuItem[] = [
  { id: "markdown-preview", label: "预览", checked: true, onSelect: () => log("view-preview") },
  { id: "markdown-live", label: "实况", onSelect: () => log("view-live") },
  { id: "markdown-source", label: "源码", onSelect: () => log("view-source") },
]

const menu: PreviewMenuGroup[] = [
  {
    label: "编辑",
    items: [
      { id: "palette", label: "命令面板…", hint: "Ctrl+Shift+P", onSelect: () => log("palette") },
      { id: "wrap", label: "自动换行", checked: true, onSelect: () => log("wrap") },
    ],
  },
  { label: "导出", items: [{ id: "export-md", label: "导出为 .md", onSelect: () => log("export") }] },
]

const [events, setEvents] = createSignal<string[]>([])
const [saveStatus, setSaveStatus] = createSignal<FilePreviewSaveStatus>("saved")
const [canStep, setCanStep] = createSignal(false)

function log(id: string) {
  setEvents((prev) => [...prev, id])
}

const hooks: Hooks = {
  dirty: () => setSaveStatus("dirty"),
  saved: () => setSaveStatus("saved"),
  typed: () => setCanStep(true),
  events,
}
;(window as unknown as { __header: Hooks }).__header = hooks

// 交互状态色来自 ThemeProvider 提供的语义 token；没有它，text-interactive-base 工具类无法解析颜色。
render(
  () => (
    <PlatformProvider value={platform}>
      <ThemeProvider>
        <LanguageProvider locale="zh">
          <div class="flex flex-col gap-4 p-4">
            <div data-e2e="reading" class="overflow-hidden border border-border" style={{ width: "300px" }}>
              <FilePreviewHeader
                path="docs/report.md"
                saveStatus="saved"
                editing={false}
                canEdit
                onToggleEditing={() => log("toggle")}
                openNativeMenu={openWith}
                menu={menu}
              />
            </div>
            <div data-e2e="editing" class="overflow-hidden border border-border" style={{ width: "300px" }}>
              <FilePreviewHeader
                path="docs/report.md"
                saveStatus={saveStatus()}
                editing
                canEdit
                onToggleEditing={() => log("toggle")}
                onFind={() => log("find")}
                onUndo={() => log("undo")}
                onRedo={() => log("redo")}
                canUndo={canStep()}
                canRedo={canStep()}
                onSave={() => log("save")}
                viewMenu={views}
                menu={menu}
              />
            </div>
            <div data-slot="state">
              {saveStatus()}|undo:{String(canStep())}|{events().join(",")}
            </div>
          </div>
        </LanguageProvider>
      </ThemeProvider>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
