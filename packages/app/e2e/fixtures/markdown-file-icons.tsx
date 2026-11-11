// e2e 夹具：聊天正文里的文件 / 目录引用长什么样。
//
// 挂的是真实 `Markdown` 组件（真实 marked + 真实 decorate），所以这里断言到的图标
// 就是消息流里那个图标：文件链接前面是类型图标（pptx → Powerpoint、md → Markdown），
// 目录 chip 前面是文件夹图标且**不可点**，不像路径的行内 code 一个图标都不加。
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import "@/index.css"
import { ThemeProvider } from "@novaway/ui/theme/context"
import { MarkedProvider } from "@novaway/ui/context/marked"
import { DialogProvider } from "@novaway/ui/context/dialog"
import { Markdown } from "@novaway/ui/markdown"

const text = `
| 引用 | 说明 |
| --- | --- |
| \`svg_output/\` + \`docs/\` | 目录：只给图标，不给点 |
| \`design_spec.md\` / \`README.md\` | 设计规格、目录说明 |
| \`product_promo_20261101_134706.pptx\` | 交付文件 |
| \`workflow.log\` | 运行日志 |
| \`inline_path\` | 不是路径，不该出现图标 |
`

const [clicked, setClicked] = createSignal("")

render(
  () => (
    <ThemeProvider>
      <DialogProvider>
        <MarkedProvider>
          <div data-e2e="markdown-root" class="p-4">
            <Markdown text={text} onFileOpen={(path) => setClicked(path)} />
            <div data-e2e="clicked">{clicked()}</div>
          </div>
        </MarkedProvider>
      </DialogProvider>
    </ThemeProvider>
  ),
  document.getElementById("root")!,
)
