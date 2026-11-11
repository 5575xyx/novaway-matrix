import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { CsvGrid } from "@/pages/session/csv-grid"
import { PlatformProvider, type Platform } from "@/context/platform"

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  back: () => {},
  forward: () => {},
  restart: async () => {},
  notify: async () => {},
}
const params = new URLSearchParams(location.search)
const original = params.has("bom")
  ? "﻿姓名;金额;备注\r\n张三;12;中文\r\n=1+1;0;文本"
  : "name,amount,note\r\nAlice,12,\"a,b\"\r\n=1+1,0,plain"
const [text, setText] = createSignal(original)
render(
  () => (
    <PlatformProvider value={platform}>
      <output data-slot="csv-text">{text()}</output>
      <CsvGrid
        text={text()}
        path="/fixture.csv"
        onChange={setText}
        readOnly={params.has("readonly")}
      />
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
