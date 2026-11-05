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
 * 后台页面远比普通网页难伺候，这里是踩过的坑：
 * - 公众号正文在**同源 iframe**（`iframe#ueditor_0`）里；
 * - 视频号整页挂在 **wujie 微前端的影子树**（`wujie-app.wujie_iframe`）里；
 * - 小红书发布按钮在 `<xhs-publish-btn>` 的 **closed shadow root** 里，
 *   标准 DOM API 永远查不到（只能靠真实鼠标坐标点，见 `clickAt`）；
 * - 富文本编辑器（ProseMirror / Slate / tiptap）只在"用户输入"时才更新内部状态，
 *   直接改 `innerHTML` 会出现"界面看着有字、提交时是空的"。所以优先
 *   `execCommand("insertText")`，失败才退回 innerHTML。
 */
const PAGE_HELPERS = `
  /** 主文档 + 所有同源 iframe + 所有开放 shadow root（递归）。 */
  const allRoots = () => {
    const out = [];
    const seen = new Set();
    const walk = (root, depth) => {
      if (!root || seen.has(root) || depth > 6) return;
      seen.add(root);
      out.push(root);
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll("*")) } catch {}
      for (const node of nodes) {
        if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
        if (node.tagName === "IFRAME") {
          try {
            const doc = node.contentDocument;
            if (doc) walk(doc, depth + 1);
          } catch {}
        }
      }
    };
    walk(document, 0);
    return out;
  };
  const deepQuery = (selector) => {
    for (const root of allRoots()) {
      let found = null;
      try { found = root.querySelector(selector) } catch {}
      if (found) return found;
    }
    return null;
  };
  const deepQueryAll = (selector) => {
    const out = [];
    for (const root of allRoots()) {
      try { out.push(...Array.from(root.querySelectorAll(selector))) } catch {}
    }
    return out;
  };
  const deepBodyText = () =>
    allRoots().map((root) => (root.body ? root.body.innerText : "")).join("\\n");
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
  /** 读回元素里的可见内容，用于"写进去没有"的校验。 */
  const readValue = (el) => {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return String(el.value || "");
    return String(el.innerText || el.textContent || "");
  };
  const writeEditor = (el, text) => {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      setNativeValue(el, text);
      return true;
    }
    const doc = el.ownerDocument || document;
    el.focus();
    let written = false;
    try {
      const selection = doc.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      written = doc.execCommand("insertText", false, text);
    } catch { written = false }
    if (!written || !readValue(el).trim()) {
      el.innerHTML = textToHtml(text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    }
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

/** 填富文本编辑器（contenteditable / 同源 iframe 里的 body / 影子树里的编辑器）。 */
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

/** 按码点取前 n 个字符：`slice` 会把 emoji 的代理对切半，导致永远比对不上。 */
export function head(value: string, n = 8): string {
  return Array.from(String(value ?? ""))
    .slice(0, n)
    .join("")
}

/** 比较用的归一化：去掉 &nbsp;、零宽字符与所有空白（中文语境下空白不承载语义）。 */
export function normalizeForCompare(value: string): string {
  return String(value ?? "")
    .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, "")
}

/**
 * 写进去之后再读回来核对。
 *
 * 平台富文本会把空格换成 `&nbsp;`、插入零宽字符、把换行折成空格，
 * 所以比较前先做"视觉等价"归一，并按码点取前缀。不一致就整段重写一次，
 * 仍不一致才算失败 —— 一次没写进去常常只是焦点丢了或 IME 还没提交。
 */
export async function fillVerified(
  win: PublishTarget,
  selectors: string[] | undefined,
  value: string,
): Promise<{ ok: boolean; read: string }> {
  if (!selectors?.length || !value) return { ok: false, read: "" }
  const read = async () => {
    const script = `(() => {
      ${PAGE_HELPERS}
      for (const sel of ${JSON.stringify(selectors)}) {
        const el = editTarget(deepQuery(sel));
        if (el) return readValue(el);
      }
      return "";
    })()`
    return String((await run(win, script)) ?? "")
  }
  const matches = (typed: string) => {
    const want = normalizeForCompare(head(value, 10))
    return !want || normalizeForCompare(typed).includes(want)
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    await fillEditor(win, selectors, value)
    await sleep(400)
    const typed = await read()
    if (matches(typed)) return { ok: true, read: typed }
  }
  return { ok: false, read: await read() }
}

/** 按可见文本点按钮。`patterns` 是正则源码（不含 /），任一匹配即点击。 */
export async function clickByText(win: PublishTarget, patterns: string[] | undefined): Promise<string | undefined> {
  if (!patterns?.length) return undefined
  const script = `(() => {
    ${PAGE_HELPERS}
    const patterns = ${JSON.stringify(patterns)}.map((p) => new RegExp(p, "i"));
    const nodes = deepQueryAll('button, [role="button"], a, .btn, span, div[class*="button"]');
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

/** 按选择器点（比文案匹配更稳：文案会随活动和改版变）。 */
export async function clickBySelector(
  win: PublishTarget,
  selectors: string[] | undefined,
): Promise<string | undefined> {
  if (!selectors?.length) return undefined
  const script = `(() => {
    ${PAGE_HELPERS}
    for (const sel of ${JSON.stringify(selectors)}) {
      const el = deepQuery(sel);
      if (!el) continue;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      el.scrollIntoView({ block: "center" });
      el.click();
      return sel;
    }
    return "";
  })()`
  const clicked = String((await run(win, script)) ?? "").trim()
  return clicked || undefined
}

/** 页面是否出现某段文案（含同源 iframe 与开放影子树里的正文）。 */
export async function hasText(win: PublishTarget, patterns: string[] | undefined): Promise<boolean> {
  if (!patterns?.length) return false
  const script = `(() => {
    ${PAGE_HELPERS}
    const patterns = ${JSON.stringify(patterns)}.map((p) => new RegExp(p));
    const text = deepBodyText();
    return patterns.some((re) => re.test(text));
  })()`
  return Boolean(await run(win, script))
}

/** 页面上是否出现了某个选择器（含 iframe / 开放影子树）。 */
export async function hasSelector(win: PublishTarget, selectors: string[] | undefined): Promise<boolean> {
  if (!selectors?.length) return false
  const script = `(() => {
    ${PAGE_HELPERS}
    return ${JSON.stringify(selectors)}.some((sel) => !!deepQuery(sel));
  })()`
  return Boolean(await run(win, script))
}

/** 读某个属性（小红书用宿主元素上的 `submit-disabled` 判断按钮能不能点）。 */
export async function attrOf(win: PublishTarget, selector: string, attr: string): Promise<string | null> {
  const script = `(() => {
    ${PAGE_HELPERS}
    const el = deepQuery(${JSON.stringify(selector)});
    if (!el) return null;
    return el.getAttribute(${JSON.stringify(attr)});
  })()`
  const value = await run(win, script)
  return value === null || value === undefined ? null : String(value)
}

/** 元素在视口里的位置（CSS px，和 `sendInputEvent` 的坐标系一致）。 */
export async function rectOf(
  win: PublishTarget,
  selector: string,
): Promise<{ x: number; y: number; width: number; height: number } | undefined> {
  const script = `(() => {
    ${PAGE_HELPERS}
    const el = deepQuery(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const box = el.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  })()`
  const value = (await run(win, script)) as { x: number; y: number; width: number; height: number } | null
  return value ?? undefined
}

/**
 * 在坐标上用**真实输入事件**点一下。
 *
 * 小红书新版发布按钮在 `<xhs-publish-btn>` 的 closed shadow root 里：
 * `querySelector` 进不去，`host.click()` 只打到宿主、内部按钮收不到；
 * 只有浏览器自己的输入管线能把点击路由进影子树 —— 所以走 `sendInputEvent`。
 * 顺带补了移动轨迹，平台风控看到的不是"凭空出现在按钮上的点击"。
 */
export async function clickAt(win: PublishTarget, x: number, y: number): Promise<void> {
  const contents = contentsOf(win)
  const px = Math.round(x)
  const py = Math.round(y)
  contents.sendInputEvent({ type: "mouseMove", x: px - 8, y: py - 6 })
  await sleep(40)
  contents.sendInputEvent({ type: "mouseMove", x: px, y: py })
  await sleep(40)
  contents.sendInputEvent({ type: "mouseDown", x: px, y: py, button: "left", clickCount: 1 })
  await sleep(30)
  contents.sendInputEvent({ type: "mouseUp", x: px, y: py, button: "left", clickCount: 1 })
}

/** 页面正文（诊断用：失败时把页面状态写进错误信息，比截图更好定位）。 */
export async function pageText(win: PublishTarget, limit = 400): Promise<string> {
  const script = `(() => {
    ${PAGE_HELPERS}
    return deepBodyText();
  })()`
  const text = String((await run(win, script)) ?? "").replace(/\s+/g, " ").trim()
  return text.slice(0, limit)
}

/**
 * 从当前地址（或页面的 `wx.commonData.t`、首页 HTML）里取公众号 token。
 * token 是公众号后台所有 cgi 请求的必填参数，登录后一定拿得到。
 */
export async function readWechatToken(win: PublishTarget): Promise<string | undefined> {
  const script = `(async () => {
    const fromSearch = (value) => {
      const match = /[?&]token=(\\d+)/.exec(value || "");
      return match ? match[1] : "";
    };
    const inline =
      fromSearch(location.search) ||
      fromSearch(location.hash) ||
      (window.wx && window.wx.commonData && (window.wx.commonData.t || window.wx.commonData.token)) ||
      "";
    if (inline) return String(inline);
    try {
      const html = await (await fetch("https://mp.weixin.qq.com/", { credentials: "include" })).text();
      const match = /data:\\s*\\{[\\s\\S]*?["']?t["']?\\s*:\\s*["']([^"']+)["']/.exec(html);
      return match ? match[1] : "";
    } catch {
      return "";
    }
  })()`
  const token = String((await run(win, script)) ?? "").trim()
  return token || undefined
}

/** 从公众号首页 HTML 里解析 token（纯函数，便于单测）。 */
export function parseWechatToken(html: string, url = ""): string | undefined {
  const fromUrl = /[?&]token=(\d+)/.exec(url)
  if (fromUrl) return fromUrl[1]
  const fromInline = /data:\s*\{[\s\S]*?["']?t["']?\s*:\s*["']([^"']+)["']/.exec(html)
  return fromInline ? fromInline[1] : undefined
}

/** 公众号草稿创建接口的表单字段（对齐 Wechatsync 的 weixin 适配器）。 */
export function wechatDraftForm(input: { title: string; html: string; digest?: string; author?: string }) {
  return new URLSearchParams({
    f: "json",
    ajax: "1",
    random: String(Math.random()),
    AppMsgId: "",
    count: "1",
    data_seq: "0",
    operate_from: "Chrome",
    isnew: "0",
    title0: input.title,
    author0: input.author ?? "",
    digest0: input.digest ?? "",
    auto_gen_digest0: input.digest ? "0" : "1",
    content0: input.html,
    need_open_comment0: "1",
    only_fans_can_comment0: "0",
    show_cover_pic0: "0",
    copyright_type0: "0",
    fee0: "0",
    is_share_copyright0: "0",
    share_page_type0: "0",
    share_imageinfo0: '{"list":[]}',
    dot0: "{}",
    categories_list0: "[]",
  })
}

/** 公众号草稿的编辑地址（建完之后用户可以自己打开继续改）。 */
export function wechatDraftUrl(token: string, appMsgId: string): string {
  return (
    `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77` +
    `&appmsgid=${appMsgId}&token=${token}&lang=zh_CN`
  )
}

/**
 * 直接建一篇草稿（不点 DOM）。
 *
 * 后台自己的"保存为草稿"就是调这个 cgi-bin 接口；在**已登录页面的上下文里**
 * fetch 会带上 cookie，Origin/Referer 也天然正确。比模拟点击稳定得多：
 * 不受编辑器版本、按钮文案、iframe 布局影响，也不会误触「群发」。
 * 只建草稿 —— 群发不可撤销，留给用户自己在后台点。
 */
export async function createWechatDraft(
  win: PublishTarget,
  input: { title: string; html: string; digest?: string; author?: string },
): Promise<{ appMsgId: string; draftUrl: string }> {
  const token = await readWechatToken(win)
  if (!token) throw new Error("没拿到公众号登录 token，请先在这个账号的页面里完成登录")

  const body = wechatDraftForm(input)
  body.set("token", token)
  body.set("lang", "zh_CN")
  const endpoint =
    "https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=" +
    token +
    "&lang=zh_CN"
  const script = `(async () => {
    const response = await fetch(${JSON.stringify(endpoint)}, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: ${JSON.stringify(body.toString())},
    });
    let payload = null;
    try { payload = await response.json() } catch { payload = null }
    return { status: response.status, payload };
  })()`
  const result = (await run(win, script)) as {
    status: number
    payload: { appMsgId?: string | number; base_resp?: { ret?: number; err_msg?: string } } | null
  }
  const appMsgId = result.payload?.appMsgId
  if (!appMsgId) {
    const reason = result.payload?.base_resp?.err_msg || `HTTP ${result.status}`
    throw new Error(`公众号草稿创建失败：${reason}`)
  }
  return { appMsgId: String(appMsgId), draftUrl: wechatDraftUrl(token, String(appMsgId)) }
}

/** 打开（或复用）一个页面。 */
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
