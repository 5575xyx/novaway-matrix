/**
 * 发布用的页面自动化原语。
 *
 * 全部基于「隐藏 BrowserWindow + 页面内脚本」，不依赖任何平台签名：
 * - 文件上传靠 CDP 的 DOM.setFileInputFiles（页面里没法伪造 File 对象）
 * - 文本输入用原生 setter + input 事件，React/Vue 的受控组件才认
 * - 按钮点击按可见文本匹配（站点改版时类名最不稳定，文案相对稳定）
 */
import { BrowserWindow, session } from "electron"
import type { Cookie } from "electron"
import { PLATFORM_USER_AGENT } from "../request"

export interface PublishWindow {
  win: BrowserWindow
  close: () => Promise<void>
}

async function setCookies(target: Electron.Session, cookies: Cookie[]) {
  for (const cookie of cookies) {
    try {
      const url = cookie.domain
        ? cookie.domain.startsWith(".")
          ? `https://www.${cookie.domain.slice(1)}`
          : `https://${cookie.domain}`
        : ""
      await target.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
      })
    } catch {
      /* 单条失败忽略 */
    }
  }
}

/** 打开一个带登录态的隐藏发布窗口。 */
export async function openPublishWindow(cookies: Cookie[], url: string): Promise<PublishWindow> {
  const partition = `persist:platform-publish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const target = session.fromPartition(partition)
  await setCookies(target, cookies)

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      partition,
    },
  })
  win.webContents.setUserAgent(PLATFORM_USER_AGENT)

  const loaded = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 30_000)
    timer.unref?.()
    win.webContents.once("did-finish-load", () => {
      clearTimeout(timer)
      resolve()
    })
    win.webContents.once("did-fail-load", () => {
      clearTimeout(timer)
      resolve()
    })
  })
  void win.loadURL(url).catch(() => undefined)
  await loaded

  return {
    win,
    close: async () => {
      try {
        if (!win.isDestroyed()) win.destroy()
      } catch {}
      // 临时分区用完即清：发布窗口里的 cookie 不该落盘长期留存。
      try {
        await session.fromPartition(partition).clearStorageData()
      } catch {}
    },
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询页面，直到 `probe` 返回真值。 */
export async function waitUntil<T>(
  win: BrowserWindow,
  probe: () => Promise<T | undefined | null | false>,
  timeoutMs: number,
  intervalMs = 400,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (win.isDestroyed()) return undefined
    try {
      const value = await probe()
      if (value) return value
    } catch {
      /* 页面导航中会抛，等下一轮 */
    }
    await sleep(intervalMs)
  }
  return undefined
}

/** 元素是否出现。 */
export function waitForAnySelector(win: BrowserWindow, selectors: string[] | undefined, timeoutMs = 20_000) {
  if (!selectors?.length) return Promise.resolve(false)
  return waitUntil(
    win,
    () =>
      win.webContents.executeJavaScript(
        `(${JSON.stringify(selectors)}).some((sel) => { try { return !!document.querySelector(sel) } catch { return false } })`,
        true,
      ),
    timeoutMs,
  ).then(Boolean)
}

/**
 * 通过 CDP 往 `input[type=file]` 里塞文件。
 *
 * 页面脚本无法构造真实文件（浏览器的安全限制），因此必须走 DevTools 协议 ——
 * 这也是所有「自动化上传」工具的通用做法。
 */
export async function setFileInput(win: BrowserWindow, selectors: string[], files: string[]): Promise<string> {
  if (files.length === 0) throw new Error("没有可上传的文件")
  const dbg = win.webContents.debugger
  let attached = false
  try {
    if (!dbg.isAttached()) {
      dbg.attach("1.3")
      attached = true
    }
    await dbg.sendCommand("DOM.enable")
    const doc = await dbg.sendCommand("DOM.getDocument", { depth: -1 })
    let nodeId = 0
    let used = ""
    for (const selector of selectors) {
      const found = await dbg.sendCommand("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector,
      })
      if (found?.nodeId) {
        nodeId = found.nodeId
        used = selector
        break
      }
    }
    if (!nodeId) throw new Error("页面上找不到文件上传框（平台可能改版）")
    await dbg.sendCommand("DOM.setFileInputFiles", { files, nodeId })
    return used
  } finally {
    if (attached) {
      try {
        dbg.detach()
      } catch {}
    }
  }
}

/** 填普通输入框（input/textarea），走原生 setter 以便受控组件收到变更。 */
export async function fillInput(win: BrowserWindow, selectors: string[] | undefined, value: string): Promise<boolean> {
  if (!selectors?.length || !value) return false
  const script = `(() => {
    const setValue = (el, text) => {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      const setter = desc && desc.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    for (const sel of ${JSON.stringify(selectors)}) {
      let el = null;
      try { el = document.querySelector(sel) } catch {}
      if (!el) continue;
      el.focus();
      setValue(el, ${JSON.stringify(value)});
      return true;
    }
    return false;
  })()`
  return Boolean(await win.webContents.executeJavaScript(script, true))
}

/** 填富文本编辑器（contenteditable）。 */
export async function fillEditor(win: BrowserWindow, selectors: string[] | undefined, value: string): Promise<boolean> {
  if (!selectors?.length || !value) return false
  const script = `(() => {
    const text = ${JSON.stringify(value)};
    for (const sel of ${JSON.stringify(selectors)}) {
      let el = null;
      try { el = document.querySelector(sel) } catch {}
      if (!el) continue;
      el.focus();
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        const setter = desc && desc.set;
        if (setter) setter.call(el, text); else el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      // contenteditable：逐段插入纯文本，避免把换行吞掉
      el.innerHTML = "";
      text.split("\\n").forEach((line, index) => {
        if (index > 0) el.appendChild(document.createElement("br"));
        el.appendChild(document.createTextNode(line));
      });
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      return true;
    }
    return false;
  })()`
  return Boolean(await win.webContents.executeJavaScript(script, true))
}

/** 按可见文本点按钮。`patterns` 是正则源码（不含 /），任一匹配即点击。 */
export async function clickByText(win: BrowserWindow, patterns: string[] | undefined): Promise<string | undefined> {
  if (!patterns?.length) return undefined
  const script = `(() => {
    const patterns = ${JSON.stringify(patterns)}.map((p) => new RegExp(p, "i"));
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, .btn, span'));
    for (const node of nodes) {
      const text = (node.textContent || "").trim();
      if (!text || text.length > 20) continue;
      if (!patterns.some((re) => re.test(text))) continue;
      const el = node.closest("button, [role='button'], a") || node;
      if (el.getAttribute && (el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled"))) continue;
      el.click();
      return text;
    }
    return "";
  })()`
  const clicked = String((await win.webContents.executeJavaScript(script, true)) ?? "").trim()
  return clicked || undefined
}

/** 页面是否出现某段文案。 */
export async function hasText(win: BrowserWindow, patterns: string[] | undefined): Promise<boolean> {
  if (!patterns?.length) return false
  const script = `(() => {
    const patterns = ${JSON.stringify(patterns)}.map((p) => new RegExp(p));
    const text = document.body ? document.body.innerText : "";
    return patterns.some((re) => re.test(text));
  })()`
  return Boolean(await win.webContents.executeJavaScript(script, true))
}
