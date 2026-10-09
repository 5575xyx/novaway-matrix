import type { TuiPluginApi } from "@opencode/plugin/tui"
import { RGBA } from "@opentui/core"
import { formatKeyBindings, formatKeySequence } from "../../src/keymap"
import { createTuiResolvedConfig } from "./tui-runtime"

type Opts = {
  client?: TuiPluginApi["client"]
  keymap?: TuiPluginApi["keymap"]
  attention?: Partial<TuiPluginApi["attention"]>
  event?: TuiPluginApi["event"]
  state?: {
    session?: Partial<TuiPluginApi["state"]["session"]>
    provider?: TuiPluginApi["state"]["provider"]
    path?: TuiPluginApi["state"]["path"]
  }
  version?: string
}

// 默认版本号。侧栏/首页页脚的品牌落款要印 api.app.version,缺了这一项那两个页脚在测试里
// 一挂就崩 —— 于是「页脚到底印了什么」这类断言没法在真插件上做。
const VERSION = "0.0.0-test"

export function createTuiPluginApi(opts: Opts = {}) {
  const values = new Map<string, unknown>()
  const color = RGBA.fromInts(200, 200, 200)
  const dialog = { clear() {}, replace() {}, setSize() {}, size: "medium" as const, depth: 0, open: false }
  const tuiConfig = createTuiResolvedConfig()
  return {
    app: { version: opts.version ?? VERSION },
    attention: { notify: async () => ({ ok: false, notification: false, sound: false }), ...opts.attention },
    client: opts.client,
    event: opts.event,
    // keys 形状照 plugin/adapters.tsx 的同名字段。tips-view 的 configShortcut 要经它把键位序列
    // 折成可读文本,少了它那一整支提示在测试里直接抛,而不是安静地退化成空串。
    keys: {
      formatSequence: (parts: never) => formatKeySequence(parts, tuiConfig),
      formatBindings: (bindings: never) => formatKeyBindings(bindings, tuiConfig),
    },
    // parseKeySequence 同样只有 configShortcut 用到。默认给一个返回空序列的桩:调用方拿到空串,
    // 那几条「按 <键> …」的提示会被筛掉,不影响别的提示进候选池。
    keymap: opts.keymap ?? ({ parseKeySequence: () => [] } as unknown as TuiPluginApi["keymap"]),
    kv: {
      get(name: string, fallback?: unknown) {
        return values.has(name) ? values.get(name) : fallback
      },
      set(name: string, value: unknown) {
        values.set(name, value)
      },
      ready: true,
    },
    state: {
      session: { get: () => undefined, ...opts.state?.session },
      // 内置页脚要问「有没有连上别的提供商」来决定是否显示快速开始引导块。默认空数组 = 没连,
      // 引导块会显示 —— 测试里显式传 provider: [{ id: "NovaWay", models: {} }] 可以把它关掉。
      provider: opts.state?.provider ?? [],
      // 实例路径同样只有「真的读它」的那几个插件需要。**给了它,那些插件就会真的把目录印出来** ——
      // 「页脚不再印目录」这类断言只有在实例目录真的送进来时才是有效守卫(否则被测代码一读
      // 就抛,断言压根没跑到)。
      ...(opts.state?.path ? { path: opts.state.path } : {}),
    },
    theme: { current: new Proxy({}, { get: () => color }) },
    tuiConfig,
    ui: { dialog },
  } as unknown as TuiPluginApi
}
