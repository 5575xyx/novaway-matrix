// e2e 夹具：挂真实的 diff 渲染器（与文件预览用的是同一个组件、同一套 pierre 选项），
// 用来验证"绿色 + / 红色 -"和红绿底色浓度。
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
// 注册 "NovaWay" 这个 Shiki 主题（应用里由 MarkedProvider 注册）；不注册时
// pierre 会报 "No valid loader for NovaWay" 并渲染成空白。
import "@novaway/ui/context/marked"
import { File } from "@novaway/ui/file"

const before = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].join("\n")
const after = ["alpha", "beta", "GAMMA changed", "delta", "epsilon", "zeta", "eta", "theta", "iota appended"].join("\n")

type Hooks = { setStyle: (value: "unified" | "split") => void }

function Fixture() {
  const [style, setStyle] = createSignal<"unified" | "split">("unified")
  ;(window as unknown as { __diff: Hooks }).__diff = { setStyle }
  return (
    <div id="host" data-style={style()} style={{ height: "100%" }}>
      <File
        mode="diff"
        diffStyle={style()}
        before={{ name: "sample.txt", contents: before }}
        after={{ name: "sample.txt", contents: after }}
      />
    </div>
  )
}

render(() => <Fixture />, document.getElementById("root")!)
