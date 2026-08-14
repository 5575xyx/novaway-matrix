import { createMemo, createSignal, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import type { OfficeArtifact } from "./office-artifact"
import { bytesToBase64 } from "./office-export"

export function OfficeWebEditor(props: { artifact: OfficeArtifact; onClose: () => void }) {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const [html, setHtml] = createSignal(extractHtml(props.artifact.body))
  const [message, setMessage] = createSignal("")
  const preview = createMemo(() => html())

  async function save() {
    const bytes = new TextEncoder().encode(preview())
    const filename = `${props.artifact.title || "网页看板"}.html`
    const result = await globalSDK.client.office.artifact.save({
      directory: sdk.directory,
      kind: "web",
      filename,
      mime: "text/html",
      contentBase64: bytesToBase64(bytes),
    })
    setMessage(`已保存：${result.data?.path ?? filename}`)
  }

  return (
    <div class="flex max-h-[80vh] w-full max-w-5xl flex-col gap-4 p-5">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-16-medium text-text-strong">网页看板预览</div>
          <div class="mt-1 text-12-regular text-text-weak">修改 HTML 后实时预览，可保存到办公产物库</div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="h-8 rounded-[7px] border border-emerald-300/40 bg-emerald-300/10 px-3 text-12-medium text-emerald-100"
            onClick={() => void save()}
          >
            保存 HTML
          </button>
          <button
            type="button"
            class="grid size-8 place-items-center rounded-[7px] border border-border-weak-base text-text-weak"
            onClick={props.onClose}
          >
            <Icon name="close" size="small" />
          </button>
        </div>
      </div>

      <div class="grid min-h-[520px] grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="flex flex-col gap-2">
          <div class="text-12-medium text-text-strong">HTML</div>
          <textarea
            value={html()}
            onInput={(event) => setHtml(event.currentTarget.value)}
            class="min-h-[480px] w-full flex-1 resize-y rounded-[8px] border border-border-weak-base bg-background-base p-3 font-mono text-12-regular leading-relaxed text-text-strong outline-none"
          />
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-12-medium text-text-strong">实时预览</span>
            <Show when={message()}>
              <span class="text-11-regular text-emerald-200">{message()}</span>
            </Show>
          </div>
          <iframe
            title="网页看板预览"
            sandbox="allow-scripts"
            class="min-h-[480px] w-full flex-1 rounded-[8px] border border-border-weak-base bg-white"
            srcdoc={preview()}
          />
        </div>
      </div>
    </div>
  )
}

function extractHtml(body: string) {
  const fenced = body.match(/```html\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) return fenced[1].trim()
  const direct = body.match(/^<!DOCTYPE html[\s\S]*<\/html>\s*$/im)
  if (direct?.[0]) return direct[0].trim()
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(propsTitle(body))}</title>
<style>
body { font-family: -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 32px; background: #f8fafc; color: #0f172a; }
.card { max-width: 960px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
</style>
</head>
<body>
<div class="card"><pre>${escapeHtml(body.replace(/#{1,6}\s*/g, ""))}</pre></div>
</body>
</html>`
}

function propsTitle(body: string) {
  return (
    body
      .split("\n")
      .map((line) => line.trim().match(/^#\s+(.+)$/)?.[1])
      .find(Boolean) ?? "网页看板"
  )
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
