/** @jsxImportSource @opentui/solid */
import type { ParentProps } from "solid-js"
import { ArgsProvider } from "../../src/context/args"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { createTuiResolvedConfig } from "./tui-runtime"
import { TestTuiContexts } from "./tui-environment"

/**
 * 「只需要主题」的那串 provider。
 *
 * ThemeProvider 自己要读 KV、读 tui config、还挂在运行期路径 context 下面,所以任何要
 * `useTheme()` 的组件(输入卡、助手气泡卡、侧栏分区卡……)都得挂这一串。测试里抄一遍的
 * 话,少挂一层就会以「theme context must be used within a context provider」的形式报出来,
 * 报错指向错误的行。各测试文件从这儿取,别再各抄一份。
 *
 * 注意 ThemeProvider 是**异步就绪**的:主题读盘完成前只渲染空白。所以测试还要自己判断
 * 「主题到位了没有」(见 ThemeReady 哨兵)。
 */
export function ThemeTestProviders(props: ParentProps) {
  return (
    <TestTuiContexts>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <ArgsProvider>
          <KVProvider>
            <ThemeProvider mode="dark">{props.children}</ThemeProvider>
          </KVProvider>
        </ArgsProvider>
      </TuiConfigProvider>
    </TestTuiContexts>
  )
}

/**
 * 和 ThemeTestProviders 一起用的就绪哨兵。测试等帧里出现这个字,再断言别的 ——
 * 「等自己关心的内容出现」在负向用例里不成立(没有消息时本来就该什么都没有)。
 */
export function ThemeReady() {
  return <text>READY</text>
}
