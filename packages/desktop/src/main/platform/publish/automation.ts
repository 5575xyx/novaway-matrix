/**
 * 发布用的页面自动化原语。
 *
 * 优先在运营工作台里**用户已经打开、已经登录**的那块页面里操作（见 surface.ts）；
 * 没有这样的页面时才开一个隐藏窗口，两种载体共用下面这些原语。不依赖任何平台签名：
 * - 文件上传靠 CDP 的 DOM.setFileInputFiles（页面里没法伪造 File 对象）
 * - 文本输入用原生 setter + input 事件，React/Vue 的受控组件才认
 * - 按钮点击按可见文本匹配（站点改版时类名最不稳定，文案相对稳定）
 */
import { BrowserWindow, session } from "electron"
import type { Cookie, WebContents } from "electron"
import { PLATFORM_USER_AGENT } from "../request"

/**
 * 一次发布操作的载体：要么是运营工作台里**已经打开的那块页面**（用户看得见、
 * 也已经是登录态），要么是临时开一个隐藏窗口兜底。
 *
 * 页面里真正干活的只有 `webContents`，所以下面的原语既接受 WebContents，
 * 也接受包装对象（老调用点传的是 BrowserWindow）。
 */
export interface PublishSurface {
  webContents: WebContents
  /** visible：复用运营工作台里的页面，跑完不能关掉；hidden：临时窗口，用完即清。 */
  origin: "visible" | "hidden"
  close: () => Promise<void>
}

export type PublishTarget = WebContents | { webContents: WebContents }

export function contentsOf(target: PublishTarget): WebContents {
  return "webContents" in target ? target.webContents : target
}

/**
 * 页面脚本的统一入口。
 *
 * `userGesture: true` 让脚本里调用的 `el.click()` / focus 走"用户操作"分支：
 * 一批富文本编辑器只在用户手势里才肯挂上输入事件。
 */
export function run(target: PublishTarget, script: string): Promise<unknown> {
  return contentsOf(target).executeJavaScript(script, true)
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

/** 打开一个带登录态的隐藏发布窗口（没有可见页面时的兜底）。 */
export async function openPublishWindow(cookies: Cookie[], url: string): Promise<PublishSurface> {
  // 不带 persist: 前缀 = 内存分区：发布窗口里的登录态不落盘。
  const partition = `platform-publish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
    webContents: win.webContents,
    origin: "hidden",
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
  win: PublishTarget,
  probe: () => Promise<T | undefined | null | false>,
  timeoutMs: number,
  intervalMs = 400,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const contents = contentsOf(win)
    if (typeof contents.isDestroyed === "function" && contents.isDestroyed()) return undefined
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
export function waitForAnySelector(win: PublishTarget, selectors: string[] | undefined, timeoutMs = 20_000) {
  if (!selectors?.length) return Promise.resolve(false)
  return waitUntil(
    win,
    () =>
      run(
        win,
        `(${JSON.stringify(selectors)}).some((sel) => { try { return !!document.querySelector(sel) } catch { return false } })`,
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
export async function setFileInput(win: PublishTarget, selectors: string[], files: string[]): Promise<string> {
  if (files.length === 0) throw new Error("没有可上传的文件")
  const dbg = contentsOf(win).debugger
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

/**
 * 页面里共用的一组小工具（内联进每段脚本）。
 *
 * 两个平台细节：
 * - 公众号/H5 后台会把正文塞进同源 iframe（`iframe#ueditor_0`），
 *   `document.querySelector` 在主文档里只能拿到 iframe 标签本身；
 * - 富文本编辑器用受控组件，直接改 `innerHTML` 之后必须补一个 `input` 事件。
 */
const PAGE_HELPERS = `
  const deepDocs = () => {
    const docs = [document];
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try {
        const d = frame.contentDocument;
        if (d) docs.push(d);
      } catch {}
    }
    return docs;
  };
  const deepQuery = (selector) => {
    for (const doc of deepDocs()) {
      let found = null;
      try { found = doc.querySelector(selector) } catch {}
      if (found) return found;
    }
    return null;
  };
  const deepQueryAll = (selector) => {
    const out = [];
    for (const doc of deepDocs()) {
      try { out.push(...Array.from(doc.querySelectorAll(selector))) } catch {}
    }
    return out;
  };
  /** 拿到真正能编辑的节点：iframe 元素要下钻到它的 body。 */
  const editTarget = (el) => {
    if (!el) return null;
    if (el.tagName === "IFRAME") {
      try { return el.contentDocument && el.contentDocument.body } catch { return null }
    }
    return el;
  };
  const setNativeValue = (el, text) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
      : el.tagName === "INPUT" ? HTMLInputElement.prototype : null;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, text); else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const escapeHtml = (value) => value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  /** 纯文本 → 段落 HTML：富文本编辑器会把裸文本当成一段，换行全丢。 */
  const textToHtml = (text) => text
    .split("\\n")
    .map((line) => "<p>" + (escapeHtml(line) || "<br>") + "</p>")
    .join("");
  const writeEditor = (el, text) => {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      setNativeValue(el, text);
      return true;
    }
    el.innerHTML = textToHtml(text);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
`

/** 填普通输入框（input/textarea），走原生 setter 以便受控组件收到变更。 */
export async function fillInput(
  win: PublishTarget,
  selectors: string[] | undefined,
  value: string,
): Promise<boolean> {
  if (!selectors?.length || !value) return false
  const script = `(() => {
    ${PAGE_HELPERS}
    for (const sel of ${JSON.stringify(selectors)}) {
      const el = editTarget(deepQuery(sel));
      if (!el) continue;
      el.focus();
      setNativeValue(el, ${JSON.stringify(value)});
      return true;
    }
    return false;
  })()`
  return Boolean(await run(win, script))
}

/** 填富文本编辑器（contenteditable / 同源 iframe 里的 body）。 */
export async function fillEditor(
  win: PublishTarget,
  selectors: string[] | undefined,
  value: string,
): Promise<boolean> {
  if (!selectors?.length || !value) return false
  const script = `(() => {
    ${PAGE_HELPERS}
    const text = ${JSON.stringify(value)};
    for (const sel of ${JSON.stringify(selectors)}) {
      const el = editTarget(deepQuery(sel));
      if (!el) continue;
      el.focus();
      return writeEditor(el, text);
    }
    return false;
  })()`
  return Boolean(await run(win, script))
}

/** 按可见文本点按钮。`patterns` 是正则源码（不含 /），任一匹配即点击。 */
export async function clickByText(win: PublishTarget, patterns: string[] | undefined): Promise<string | undefined> {
  if (!patterns?.length) return undefined
  const script = `(() => {
    ${PAGE_HELPERS}
    const patterns = ${JSON.stringify(patterns)}.map((p) => new RegExp(p, "i"));
    const nodes = deepQueryAll('button, [role="button"], a, .btn, span');
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
  const clicked = String((await run(win, script)) ?? "").trim()
  return clicked || undefined
}

/** 页面是否出现某段文案（含同源 iframe 里的正文）。 */
export async function hasText(win: PublishTarget, patterns: string[] | undefined): Promise<boolean> {
  if (!patterns?.length) return false
  const script = `(() => {
    ${PAGE_HELPERS}
    const patterns = ${JSON.stringify(patterns)}.map((p) => new RegExp(p));
    const text = deepDocs().map((doc) => (doc.body ? doc.body.innerText : "")).join("\\n");
    return patterns.some((re) => re.test(text));
  })()`
  return Boolean(await run(win, script))
}

/**
 * 从当前地址（或页面的 `wx.commonData.t`）里取公众号 token。
 * token 是公众号后台所有 cgi 请求的必填参数，登录后一定在地址栏里。
 */
export async function readWechatToken(win: PublishTarget): Promise<string | undefined> {
  const script = `(() => {
    const fromSearch = (value) => {
      const match = /[?&]token=(\\d+)/.exec(value || "");
      return match ? match[1] : "";
    };
    return (
      fromSearch(location.search) ||
      fromSearch(location.hash) ||
      (window.wx && window.wx.commonData && window.wx.commonData.t) ||
      ""
    );
  })()`
  const token = String((await run(win, script)) ?? "").trim()
  return token || undefined
}

/** 打开（或复用）一个页面。返回的 `origin` 决定跑完要不要关掉。 */
export async function navigate(win: PublishTarget, url: string, timeoutMs = 30_000): Promise<boolean> {
  const contents = contentsOf(win)
  if (contents.getURL() === url) return true
  const loaded = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    timer.unref?.()
    const done = () => {
      clearTimeout(timer)
      contents.off("did-finish-load", done)
      contents.off("did-fail-load", done)
      resolve(true)
    }
    contents.once("did-finish-load", done)
    contents.once("did-fail-load", done)
  })
  void contents.loadURL(url).catch(() => undefined)
  return loaded
}
