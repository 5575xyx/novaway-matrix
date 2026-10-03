/** @jsxImportSource @opentui/solid */
// 内置侧栏页脚插件(feature-plugins/sidebar/footer.tsx)的渲染契约。
//
// 页脚**不印目录**:目录在整个底部区域由会话页底栏(routes/session/footer.tsx)独家显示,
// 那一行还带着 abbreviateHome 过的路径与 `⑂ 分支`。这个插件原来在品牌落款上面印了一行
// `目录[:分支]`,于是屏幕底部上下叠着两条一模一样的路径、分支印了两遍。
//
// **为什么单独一个文件、而不是挂在整棵侧栏上测**:侧栏最宽 60 列(SIDEBAR_MAX_WIDTH),
// 一条 Windows 临时目录路径(~55 列)会被渲染器裁掉 —— 那样「帧里没有这条路径」就成了一句
// 裁切之后的空话,把它改回去测试照样绿。这里把插件注册进来的那个 View 单独取出来、在
// 200 列的视口里渲染,量的是**未经裁切**的输出。
//
// 取 View 的手法照 feature-plugins/sidebar-messages.test.tsx:把 api.slots.register 换成捕获器,
// 拿到插件真正注册进来的工厂,再在渲染作用域里调用它(opentui 的 reconciler 在 createElement
// 时就要求 renderer 存在,组件外构造 JSX 会直接抛)。
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import sidebarFooterPlugin from "../../src/feature-plugins/sidebar/footer"
import { TUI_BRAND } from "../../src/brand"
import { createTuiPluginApi } from "../fixture/tui-plugin"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"

// 一条短而独特的实例目录:够短,200 列的视口里不会被裁,断言才不是空话。
const DIRECTORY = "/w/nova-way/packages/tui"

type FooterFactory = (ctx: unknown, props: { session_id: string }) => JSX.Element

/** 跑一遍插件的注册流程,把 sidebar_footer 的工厂原样交出来。 */
function registerFooter(sessionDirectory?: string) {
  const api = createTuiPluginApi({
    state: {
      // provider 里给一个非 NovaWay 的条目 → 插件判定「已经连上别的提供商」,
      // 快速开始引导块整块不画,这一帧里页脚只剩品牌落款(负向断言不受引导块文案干扰)。
      // mock 数据只带了 id,Provider / Session 的其余必填字段用 never 强转掉。
      provider: [{ id: "test-provider" }] as never,
      path: { state: "", config: "", worktree: "/w/nova-way", directory: DIRECTORY },
      session: {
        get: () => (sessionDirectory ? ({ id: "ses_test", directory: sessionDirectory } as never) : undefined),
      },
    },
  })
  let slot: FooterFactory | undefined
  const host = api as unknown as { slots: unknown }
  host.slots = {
    register(plugin: { slots: { sidebar_footer: FooterFactory } }) {
      slot = plugin.slots.sidebar_footer
      return () => {}
    },
  }
  void sidebarFooterPlugin.tui(api, undefined, {} as never)
  if (!slot) throw new Error("sidebar_footer 没有被注册")
  return () => slot!({}, { session_id: "ses_test" })
}

async function captureFrame(render: () => JSX.Element) {
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        {render()}
      </ThemeTestProviders>
    ),
    { width: 200, height: 10 },
  )
  try {
    let frame = ""
    for (let attempt = 0; attempt < 200; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("READY")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(frame, "主题没就绪,下面的断言会跑在空白帧上").toContain("READY")
    return frame
  } finally {
    app.renderer.destroy()
  }
}

test("页脚只印品牌落款,不印目录", async () => {
  const frame = await captureFrame(registerFooter())
  // 闸门:页脚确实渲染了。
  expect(frame).toContain(TUI_BRAND.left)
  expect(frame).toContain(TUI_BRAND.right)
  // 契约:实例目录不在这里。
  expect(frame).not.toContain(DIRECTORY)
  expect(frame).not.toContain("/w/nova-way")
})

// 会话目录与实例目录不同时同理:插件原来印的是会话目录(没有会话才落回实例目录),
// 所以两种取值都得钉住,否则只测一种就等于给另一种留了后门。
test("页脚在会话目录与实例目录不同时也不印任何一份", async () => {
  const frame = await captureFrame(registerFooter("/w/somewhere-else"))
  expect(frame).toContain(TUI_BRAND.left)
  expect(frame).not.toContain("/w/somewhere-else")
  expect(frame).not.toContain(DIRECTORY)
})
