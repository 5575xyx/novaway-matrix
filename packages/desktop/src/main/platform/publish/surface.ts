/**
 * 找到「运营工作台里已经打开的那块平台页面」。
 *
 * 发布为什么优先用这块页面：
 * - 它已经是登录态，不用把账号 cookie 再灌进一个新分区；
 * - 用户看得见每一步，平台风控看到的也是"人在看着的正常页面"；
 * - 公众号这类后台的编辑页要靠地址栏里的 token 才进得去，token 只存在于
 *   那个已登录的会话里。
 *
 * 找不到时才退回隐藏窗口（openPublishWindow），行为和以前一致。
 */
import { webContents } from "electron"
import { getDriver } from "./drivers"
import type { PublishSurface } from "./automation"

/** 运营工作台里的 `<webview>` 在 Electron 里的 type 就是 "webview"。 */
const WEBVIEW_TYPE = "webview"

export function findOpenSurface(platform: string): PublishSurface | undefined {
  const driver = getDriver(platform)
  if (!driver?.hosts?.length) return undefined

  const matches: Electron.WebContents[] = []
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue
    try {
      if (contents.getType() !== WEBVIEW_TYPE) continue
    } catch {
      continue
    }
    const url = contents.getURL()
    if (!url) continue
    let host = ""
    try {
      host = new URL(url).host
    } catch {
      continue
    }
    if (driver.hosts.includes(host)) matches.push(contents)
  }

  const target = matches[0]
  if (!target) return undefined

  return {
    webContents: target,
    origin: "visible",
    // 这是用户的页面，跑完不能关，也不清任何 storage。
    close: async () => {},
  }
}
