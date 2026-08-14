import { createEffect, createSignal, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import type { OfficeArtifact } from "./office-artifact"

export function OfficeDesignEditor(props: { artifact: OfficeArtifact; onClose: () => void }) {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const [title, setTitle] = createSignal(props.artifact.title || "新品发布")
  const [subtitle, setSubtitle] = createSignal("2026 秋季新品 · 抢先体验")
  const [accent, setAccent] = createSignal("#10b981")
  const [background, setBackground] = createSignal("#0f172a")
  const [textColor, setTextColor] = createSignal("#ffffff")
  const [layout, setLayout] = createSignal<"landscape" | "portrait">("landscape")
  const [message, setMessage] = createSignal("")
  let canvasRef: HTMLCanvasElement | undefined

  createEffect(() => {
    const canvas = canvasRef
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const width = layout() === "landscape" ? 1280 : 720
    const height = layout() === "landscape" ? 720 : 1280
    canvas.width = width
    canvas.height = height
    ctx.fillStyle = background()
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = accent()
    ctx.fillRect(0, 0, 16, height)
    ctx.fillRect(width - 16, 0, 16, height)

    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    ctx.fillStyle = textColor()
    ctx.font = layout() === "landscape" ? "700 76px sans-serif" : "700 68px sans-serif"
    wrapText(ctx, title(), width * 0.72, height * 0.38, width * 0.72, 92, true)

    ctx.fillStyle = accent()
    ctx.fillRect(width * 0.22, height * 0.58, width * 0.56, 6)

    ctx.fillStyle = textColor()
    ctx.font = "500 30px sans-serif"
    wrapText(ctx, subtitle(), width * 0.64, height * 0.66, width * 0.64, 42, true)

    ctx.fillStyle = "rgba(255,255,255,0.68)"
    ctx.font = "500 20px sans-serif"
    ctx.fillText("NovaWay Office", width / 2, height * 0.9)
  })

  function wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    y: number,
    centerWidth: number,
    lineHeight: number,
    center: boolean,
  ) {
    const lines = text.length > 0 ? [text] : []
    lines.forEach((line, index) => {
      if (center) ctx.fillText(line, centerWidth, y + index * lineHeight)
    })
  }

  async function exportPng() {
    const canvas = canvasRef
    if (!canvas) return
    const dataUrl = canvas.toDataURL("image/png")
    const base64 = dataUrl.split(",")[1] ?? ""
    const filename = `${title() || "视觉设计"}.png`
    const result = await globalSDK.client.office.artifact.save({
      directory: sdk.directory,
      kind: "design",
      filename,
      mime: "image/png",
      contentBase64: base64,
    })
    setMessage(`已保存：${result.data?.path ?? filename}`)
  }

  return (
    <div class="flex max-h-[84vh] w-full max-w-4xl flex-col gap-4 p-5">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-16-medium text-text-strong">视觉设计画布</div>
          <div class="mt-1 text-12-regular text-text-weak">调整文案与配色后导出 PNG</div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="h-8 rounded-[7px] border border-emerald-300/40 bg-emerald-300/10 px-3 text-12-medium text-emerald-100"
            onClick={() => void exportPng()}
          >
            导出 PNG
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

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1 text-12-medium text-text-weak">
            主标题
            <input
              value={title()}
              onInput={(event) => setTitle(event.currentTarget.value)}
              class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
            />
          </label>
          <label class="flex flex-col gap-1 text-12-medium text-text-weak">
            副标题
            <input
              value={subtitle()}
              onInput={(event) => setSubtitle(event.currentTarget.value)}
              class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
            />
          </label>
          <label class="flex flex-col gap-1 text-12-medium text-text-weak">
            强调色
            <input
              type="color"
              value={accent()}
              onInput={(event) => setAccent(event.currentTarget.value)}
              class="h-9 rounded-[7px] border border-border-weak-base bg-background-base"
            />
          </label>
          <label class="flex flex-col gap-1 text-12-medium text-text-weak">
            背景色
            <input
              type="color"
              value={background()}
              onInput={(event) => setBackground(event.currentTarget.value)}
              class="h-9 rounded-[7px] border border-border-weak-base bg-background-base"
            />
          </label>
          <label class="flex flex-col gap-1 text-12-medium text-text-weak">
            文字色
            <input
              type="color"
              value={textColor()}
              onInput={(event) => setTextColor(event.currentTarget.value)}
              class="h-9 rounded-[7px] border border-border-weak-base bg-background-base"
            />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="h-9 rounded-[7px] border border-border-weak-base text-12-medium text-text-weak"
              classList={{ "border-emerald-300/50 bg-emerald-300/10 text-emerald-100": layout() === "landscape" }}
              onClick={() => setLayout("landscape")}
            >
              横版
            </button>
            <button
              type="button"
              class="h-9 rounded-[7px] border border-border-weak-base text-12-medium text-text-weak"
              classList={{ "border-emerald-300/50 bg-emerald-300/10 text-emerald-100": layout() === "portrait" }}
              onClick={() => setLayout("portrait")}
            >
              竖版
            </button>
          </div>
          <Show when={message()}>
            <span class="text-11-regular text-emerald-200">{message()}</span>
          </Show>
        </div>

        <div class="overflow-auto rounded-[8px] border border-border-weak-base bg-black/20 p-4">
          <canvas ref={canvasRef} class="mx-auto max-w-full rounded-[8px] shadow-[0_20px_60px_rgba(0,0,0,0.35)]" />
        </div>
      </div>
    </div>
  )
}
