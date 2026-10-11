/** @jsxImportSource @opentui/solid */
//
// 差异激活模式下 pgup/pgdn 必须被工作区那层接管,不能被 session.global 那层的
// messages_page_up / messages_page_down(滚聊天记录)抢走。
//
// 背景:harness 的 provider 栈里没有 session 全局层 —— 所以 pgup 走不到冲突路径,
// 工作区自己的 useKeyboard 直接接管,测试**假绿**(harness 测不出这个 bug)。
// 这里在 KeymapContexts 里手动注册一个「全局」pageup 探针层,用来模拟 session.global。
// 层排序规则(见 @opentui/keymap 的 getSortedLayers):priority 降序、同 priority 时
// order 降序(即后注册的层排前面、优先赢)。KeymapContexts 里探针**先注册**,GitWorkspace
// 的 useBindings 在 children 挂载时**后注册** —— 于是工作区层天然赢,探针只在
// 工作区层 enabled 失活(非差异模式)时才被激活。按 pgup 时:
//   · 探针 fire → 全局层赢了,工作区层没赢(要么没注册、要么 enabled 为 false)
//   · 探针不 fire → 工作区 useBindings(pageup → run("diff.pageUp"))赢,差异真的滚一屏
// 断言两者:probeHits 必须为 0(工作区层赢下同键冲突),且 pgdn 之后首屏独有的内容
// 被整块顶出屏外(证明滚的确实是差异而不是聊天记录)。pgup 在顶部是空转 —— scrollDiffBy
// 把 0 夹回 0,帧不变是正确行为,所以拿它只验「没被抢走」,不拿它验滚动。
//
// key 名字面量用 `pageup` / `pagedown`:本仓库 src/keymap.tsx 的 KEY_ALIASES 把 `pgup` / `pgdn`
// 归一成这两个(与 src/feature-plugins/system/diff-viewer.tsx:742-743 同款口径)。
//
// 翻页键没有 mockInput 原生入口(KeyCodes 里只有 ARROW_* 与 F1-F12,没有 PAGEUP/PAGEDOWN),
// 所以按真实 CSI 序列发:pressKey 对 KeyCodes 之外的串原样 emit 给 stdin,真实解析器把它
// 解析成 name "pageup" / "pagedown" —— 与 focus.ts 的键名口径一致(已实测确认)。
import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { createBindingLookup } from "@opentui/keymap/extras"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createMockMouse } from "@opentui/core/testing"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup, type JSX } from "solid-js"
import { GitWorkspace } from "../../src/component/git-workspace"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { git, linesOf, tmpGitDir, type WorkspaceHarness } from "./git-workspace-harness"

const ESC = String.fromCharCode(27)
const PAGEUP = `${ESC}[5~`
const PAGEDOWN = `${ESC}[6~`

/** 全局(pageup → 探针)层的命中次数:工作区差异模式活着时必须为 0 —— 只许工作区那层赢。 */
let probeHits = 0

/**
 * 自带探针层的 keymap 栈。harness 的 KeymapContexts 是内部函数不能复用,这里抄一份同款
 * 脚手架再插一个 pageup 探针 —— 模拟 routes/session/index.tsx 的 session.global 层。
 *
 * 探针**先于** GitWorkspace 的 useBindings 注册:同 priority 时 order 降序(见 getSortedLayers),
 * 后注册的层赢。所以工作区层活着时探针自动失活,只在 enabled: false 才接得着事件。
 */
function ProbeKeymapContexts(props: { children: JSX.Element }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse({})), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
  const offKeymap = registerNovaWayKeymap(keymap, renderer, config)
  const offProbe = keymap.registerLayer({
    bindings: [
      {
        key: "pageup",
        desc: "全局滚动(探针)",
        group: "探针",
        cmd: () => {
          probeHits += 1
        },
      },
    ],
  })
  onCleanup(() => {
    offProbe()
    offKeymap()
  })
  return <NovaWayKeymapProvider keymap={keymap}>{props.children}</NovaWayKeymapProvider>
}

type ProbeApp = Awaited<ReturnType<typeof testRender>>

async function captureFrame(app: ProbeApp): Promise<string> {
  await app.renderOnce()
  await Bun.sleep(25)
  await app.renderOnce()
  for (let attempt = 0; attempt < 20; attempt++) {
    const frame = app.captureCharFrame()
    if (frame.trim().length > 0) return frame
    await Bun.sleep(25)
    await app.renderOnce()
  }
  return app.captureCharFrame()
}

async function mountProbeWorkspace(root: string, width = 100): Promise<WorkspaceHarness> {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <ProbeKeymapContexts>
                <GitWorkspace rootPath={root} onClose={() => {}} width={width} />
              </ProbeKeymapContexts>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 30 },
  )
  const pressKey = async (name: string) => {
    app.mockInput.pressKey(name)
    await captureFrame(app)
  }
  return {
    app,
    pressKey,
    frame: () => captureFrame(app),
    waitForFrame: async (pred, what) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        if (pred(await captureFrame(app))) return
        await Bun.sleep(25)
      }
      throw new Error(`帧里始终没等到:${what}`)
    },
    wait: async (fn, what, timeout = 3000) => {
      const start = Date.now()
      while (!(await fn())) {
        if (Date.now() - start > timeout) throw new Error(`始终没等到:${what}`)
        await Bun.sleep(25)
      }
    },
    mouse: createMockMouse(app.renderer),
    cellOf: (_frame, _needle, _nth = 0) => ({ x: 0, y: 0 }),
    cleanup: () => {
      app.renderer.destroy()
    },
    [Symbol.dispose]() {
      app.renderer.destroy()
    },
  }
}

/** enter / esc 走 mockInput 的原生入口,发完等一帧画完(它们本身不等帧)。 */
async function pressEnter(ws: WorkspaceHarness) {
  ws.app.mockInput.pressEnter()
  await ws.frame()
}

/** 跳到文件面板并等它选中第一行。初始焦点在状态面板,❯ 不在文件面板里。 */
async function intoFilesPanel(ws: WorkspaceHarness, file: string) {
  await ws.waitForFrame((frame) => linesOf(frame, file).length > 0, `文件面板渲染出 ${file}`)
  await ws.pressKey("2")
  await ws.waitForFrame((frame) => linesOf(frame, file).some((line) => line.includes("❯")), `❯ 落在 ${file}`)
}

/** 40 行全改的大 diff:一屏装不下,翻页才有可见距离(与 diff-focus 用例同款配方)。 */
async function longDiffRepo(prefix: string): Promise<string> {
  const dir = tmpGitDir(prefix)
  await git(dir, ["init", "-b", "main"])
  const num = (index: number) => String(index + 1).padStart(2, "0")
  fs.writeFileSync(
    path.join(dir, "long.txt"),
    Array.from({ length: 40 }, (_, i) => `alpha-${num(i)}`).join("\n") + "\n",
  )
  await git(dir, ["add", "long.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "long.txt"), Array.from({ length: 40 }, (_, i) => `beta-${num(i)}`).join("\n"))
  return dir
}

test("差异模式下 pgup/pgdn 被工作区层接管,不被 session.global 层抢走", async () => {
  probeHits = 0
  const dir = await longDiffRepo("nw-ws-keymap-pgup-")
  using ws = await mountProbeWorkspace(dir)
  await intoFilesPanel(ws, "long.txt")
  await pressEnter(ws)
  await ws.waitForFrame((frame) => frame.includes("alpha-01"), "差异视图渲染出第一屏")
  // 顶部按 pgup 是**空转**(scrollDiffBy 把 0 夹回 0),所以 pgup 只用来验证「没被全局层抢走」,
  // 不用来验证滚动 —— 帧不变是正确行为,不是命令没生效。
  await ws.pressKey(PAGEUP)
  expect(probeHits).toBe(0)
  expect(await ws.frame()).toContain("alpha-01")
  // pgdn 走真滚动:一屏的量必须把首屏独有的内容整块顶出屏外。这既证明滚的是差异而不是聊天记录,
  // 也证明命令落到了工作区的 run("diff.pageDown") 上 —— 探针层若赢了,这里就根本不会滚动。
  await ws.pressKey(PAGEDOWN)
  const afterPageDown = await ws.frame()
  expect(probeHits).toBe(0)
  expect(afterPageDown).not.toContain("alpha-01")
  expect(afterPageDown).not.toContain("alpha-23")
})

test("非差异模式:enabled 闸门失活,pgup 落回全局层", async () => {
  const dir = tmpGitDir("nw-ws-keymap-pgup-global-")
  await git(dir, ["init", "-b", "main"])
  using ws = await mountProbeWorkspace(dir)
  // 先等一帧落定再按:键事件要经 stdin 解析,渲染器没落定时发的键会被直接丢掉,
  // 那样探针不 fire 是因为「没按到」而不是「闸门失活」,断言会变成假阴性。
  await ws.frame()
  probeHits = 0
  await ws.pressKey(PAGEUP)
  expect(probeHits).toBe(1)
})
