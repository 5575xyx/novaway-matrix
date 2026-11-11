import { createPdf } from "@novaway/core/office/pdf/engine"
import { PlatformProvider, type Platform } from "@/context/platform"
import { PdfPageTools, type PdfPageOp } from "@/pages/session/office-file-preview"
import { OfficeRibbonBar, OfficeRibbonProvider } from "@/pages/session/office-ribbon"
import { render } from "solid-js/web"
import "@/index.css"

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  back: () => {},
  forward: () => {},
  restart: async () => {},
  notify: async () => {},
}

function toBase64(bytes: Uint8Array) {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

async function main() {
  const root = document.getElementById("root")!
  const pdf = await createPdf({ title: "PDF 页面工具验证" })
  const base64 = toBase64(pdf)
  ;(window as unknown as { __pdfFixtureBase64: string }).__pdfFixtureBase64 = base64
  const state = document.createElement("div")
  state.dataset.slot = "state"
  root.append(state)
  const record = async (op: PdfPageOp) => {
    state.dataset.lastOp = JSON.stringify(op)
    state.textContent = JSON.stringify(op)
  }
  render(
    () => (
      <PlatformProvider value={platform}>
        <OfficeRibbonProvider>
          <div class="flex h-screen flex-col">
            <OfficeRibbonBar />
            <PdfPageTools base64={base64} path="sample.pdf" onPageOp={record} />
          </div>
        </OfficeRibbonProvider>
      </PlatformProvider>
    ),
    root,
  )
}

void main()
