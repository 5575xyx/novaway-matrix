// e2e 夹具：预览面板的三态门（加载中 / 失败 / 有内容）。
//
// 真实复用的部分：`OfficePreviewFailureState`（面板里就是这个组件）、
// `readOfficePreview`（取字节通道，服务端 code → 失败态）、
// `officePreviewFailure` / `officePreviewBase64`（面板两个 memo 用的同一对取值）。
// 夹具自己写的只有外层那个 Switch —— 它照抄面板里的分支顺序（失败在内容之前、
// 骨架屏兜底），因为整块 FileTabContent 需要 SDK / 会话 / 布局上下文，无法独立挂载。
// 所以这一页证明的是「失败态压掉骨架屏」这段判定成立，不证明面板里没人改写它。
import { createSignal, Match, Switch } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { PlatformProvider, type Platform } from "@/context/platform"
import { ThemeProvider } from "@novaway/ui/theme/context"
import { LanguageProvider } from "@/context/language"
import { OfficePreviewFailureState } from "@/pages/session/office-preview-failure"
import {
  officePreviewBase64,
  officePreviewFailure,
  readOfficePreview,
  type OfficePreviewLoad,
  type OfficePreviewReader,
  type PreviewReadResult,
} from "@/pages/session/office-preview-load"

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  back: () => {},
  forward: () => {},
  restart: async () => {},
  notify: async () => {},
}

const server = (read: (path: string) => Promise<PreviewReadResult>): OfficePreviewReader => ({
  isExternal: () => false,
  readServer: read,
})

const refused = (code: string, path: string, message: string) =>
  server(async () => ({ error: { data: { code, path, message } } }))

/** 每个场景就是一次服务端回复的样子；Playwright 只传 id，闭包留在页面里。 */
const read: Record<string, () => Promise<OfficePreviewLoad>> = {
  ok: () =>
    readOfficePreview(
      server(async () => ({ data: { content: "UEsDBA==" } })),
      "output/deck.pptx",
    ),
  empty: () =>
    readOfficePreview(
      server(async () => ({ data: { content: "" } })),
      "output/blank.pptx",
    ),
  notFound: () => readOfficePreview(refused("not_found", "output/deck.pptx", "找不到这个文件"), "output/deck.pptx"),
  outside: () =>
    readOfficePreview(refused("path_outside_workspace", "../../secrets.pptx", "超出项目目录"), "../../secrets.pptx"),
  unsupported: () => readOfficePreview(refused("unsupported_type", "notes.txt", "这种格式不能预览"), "notes.txt"),
  rejected: () =>
    readOfficePreview(
      server(async () => {
        throw new Error("连接中断")
      }),
      "x.pptx",
    ),
  slow: () =>
    new Promise((resolve) =>
      setTimeout(
        () =>
          resolve(
            readOfficePreview(
              server(async () => ({ data: { content: "SLOW" } })),
              "a.pptx",
            ),
          ),
        800,
      ),
    ),
  fast: () =>
    readOfficePreview(
      server(async () => ({ data: { content: "FAST" } })),
      "b.pptx",
    ),
}

const [load, setLoad] = createSignal<OfficePreviewLoad | undefined>()

// 同一时刻只有最后一次请求的结果能进状态：seq 不匹配就丢弃，
// 否则切走标签后迟到的失败会盖掉当前文件（面板里的 officeLoadSeq 防同一件事）。
let seq = 0
async function run(id: string) {
  const mine = ++seq
  setLoad(undefined)
  const value = await read[id]()
  if (mine !== seq) return
  setLoad(value)
}

;(window as unknown as { __preview: { run: (id: string) => Promise<void> } }).__preview = { run }

const failure = () => officePreviewFailure(load())
const base64 = () => officePreviewBase64(load())

render(
  () => (
    <PlatformProvider value={platform}>
      <ThemeProvider>
        <LanguageProvider locale="zh">
          <div data-e2e="panel" class="h-[360px] w-[520px] border border-border bg-background">
            <Switch>
              <Match when={failure()}>{(value) => <OfficePreviewFailureState failure={value()} />}</Match>
              <Match when={base64()}>{(value) => <div data-e2e="content">{value()}</div>}</Match>
              <Match when={true}>
                <div data-e2e="skeleton">加载中...</div>
              </Match>
            </Switch>
          </div>
        </LanguageProvider>
      </ThemeProvider>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
