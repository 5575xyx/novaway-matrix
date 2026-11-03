/**
 * 已挂载的平台 webview 登记表。
 *
 * 运营工作台的中间那一栏是用户眼前那块登录好的平台页面（Electron `<webview>`）。
 * 模型跑在服务端，够不到这块 webview；它能做的只是发一个"请在我眼前这块页面上
 * 执行 X"的请求（见 `context/webview-automation.tsx`），由渲染进程找到登记表里
 * 的那个 handle 去执行。
 *
 * 登记表只装"当前真的显示着"的页面：组件卸载就注销，所以模型永远不会操作一个
 * 用户看不见的后台页面。
 */
export type WebviewHandle = {
  /** 平台 id，例如 wxGzh / xhs。 */
  platform: string
  accountId: string
  nickname: string
  /** 页面是否已经加载完（dom-ready 之后）。 */
  ready: () => boolean
  getURL: () => string
  getTitle: () => string
  /** 在页面上下文里执行脚本并返回可序列化的结果。 */
  execute: (script: string) => Promise<unknown>
  /** 导航并等待加载完成。 */
  navigate: (url: string, timeoutMs: number) => Promise<{ url: string; title: string }>
  /** 截取用户看到的那一屏（data URL）。 */
  capture: () => Promise<string | undefined>
}

const handles = new Set<WebviewHandle>()

export function registerWebview(handle: WebviewHandle) {
  handles.add(handle)
  return () => {
    handles.delete(handle)
  }
}

export function hasWebview() {
  return handles.size > 0
}

/**
 * 找一个可用的 webview：优先已加载完的；指定 target 时按平台 id / 账号 id 匹配。
 * 多个页面同时开着时不做"猜"，只取第一个 —— 工作台同一时刻只显示一个。
 */
export function findWebview(target?: string): WebviewHandle | undefined {
  const all = [...handles]
  const matched = target
    ? all.filter((item) => item.platform === target || item.accountId === target)
    : all
  const pool = matched.length > 0 ? matched : all
  return pool.find((item) => item.ready()) ?? pool[0]
}
