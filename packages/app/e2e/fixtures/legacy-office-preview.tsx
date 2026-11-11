import { buildZip } from "@novaway/core/office/pptx-edit"
import { PlatformProvider, type Platform } from "@/context/platform"
import { OfficeFilePreview } from "@/pages/session/office-file-preview"
import { OfficeRibbonBar, OfficeRibbonProvider } from "@/pages/session/office-ribbon"
import { render } from "solid-js/web"
import "@/index.css"

const platform: Platform = { platform: "web", openLink: () => {}, back: () => {}, forward: () => {}, restart: async () => {}, notify: async () => {} }
const formats = {
  odt: { mime: "application/vnd.oasis.opendocument.text", xml: `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>ODT 段落</text:p></office:text></office:body></office:document-content>` },
  ods: { mime: "application/vnd.oasis.opendocument.spreadsheet", xml: `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="数据"><table:table-row><table:table-cell><text:p>ODS 单元格</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>` },
  odp: { mime: "application/vnd.oasis.opendocument.presentation", xml: `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:presentation><draw:page draw:name="封面"><text:p>ODP 幻灯片</text:p></draw:page></office:presentation></office:body></office:document-content>` },
}
const requested = new URLSearchParams(location.search).get("format") || "odt"
const format = requested === "rtf" ? "rtf" : requested in formats ? requested as keyof typeof formats : "odt"
const item = format === "rtf" ? undefined : formats[format]
const encoder = new TextEncoder()
const bytes = item
  ? buildZip([{ name: "mimetype", data: encoder.encode(item.mime) }, { name: "content.xml", data: encoder.encode(item.xml) }])
  : encoder.encode("{\\rtf1\\ansi RTF preview\\par}")
let binary = ""
for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
const base64 = btoa(binary)
const root = document.getElementById("root")!
const state = document.createElement("output")
state.dataset.slot = "legacy-save"
root.append(state)
render(() => <PlatformProvider value={platform}><OfficeRibbonProvider><div class="flex h-screen flex-col"><OfficeRibbonBar /><OfficeFilePreview path={`sample.${format}`} base64={base64} onSaveParagraph={async (paragraph, text) => { state.textContent = JSON.stringify({ paragraph, text }) }} onSaveCell={async (sheet, cell, value) => { state.textContent = JSON.stringify({ sheet, cell, value }) }} /></div></OfficeRibbonProvider></PlatformProvider>, root)
