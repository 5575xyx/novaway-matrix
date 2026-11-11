// e2e 夹具：把真实的富文本编辑器（src/pages/session/rich-file-preview.tsx）挂在模拟右栏里，
// 头部那颗「查找」是唯一的查找入口 —— 验证它能把请求转进编辑器并落到源码视图的查找条上。
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { RichFilePreview } from "@/pages/session/rich-file-preview"

const HTML = "<h1>标题</h1><p>第一段文字</p><p>第二段文字</p>"

const [findTick, setFindTick] = createSignal(0)
const [saved, setSaved] = createSignal<string[]>([])

render(
  () => (
    <div class="p-4">
      <div data-e2e="panel" class="relative flex h-[420px] w-[520px] flex-col border border-border">
        <div class="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2.5">
          <span class="min-w-0 flex-1 truncate text-ui-sm font-medium text-foreground">page.html</span>
          <button
            type="button"
            data-e2e="header-find"
            class="rounded px-2 py-1 text-11-regular text-foreground-subtle hover:bg-hover hover:text-foreground"
            onClick={() => setFindTick((value) => value + 1)}
          >
            查找
          </button>
        </div>
        <RichFilePreview
          path="page.html"
          content={HTML}
          findRequest={findTick}
          onSaveSource={async (html) => {
            setSaved((prev) => [...prev, html])
          }}
        />
      </div>
      <div data-slot="saved">{saved().join("|")}</div>
    </div>
  ),
  document.getElementById("root")!,
)
