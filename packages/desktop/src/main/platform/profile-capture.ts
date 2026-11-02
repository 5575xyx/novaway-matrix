/**
 * 从"已经登录的页面"里抓账号资料（昵称 / 头像 / 平台 uid）。
 *
 * 为什么需要它：各平台的内容接口都在做签名/风控，靠 cookie 直接打 API 时
 * 一旦被拒（406、空 data、code != 0），账号记录里就只有一串空字符串，
 * 左边的账号列表看起来"登录成功了却没有名字"。而页面本身是浏览器正常渲染的，
 * 名字和头像一定在 DOM / 首屏 state 里 —— 从页面读永远拿得到。
 *
 * 抓取顺序：
 * 1. 平台指定的 DOM 选择器（最准，走的是页面上肉眼可见的那一份）；
 * 2. 首屏全局状态（`__INITIAL_STATE__` / `__NUXT__` / `__NEXT_DATA__` …）里的
 *    常见键名，按"同时含昵称与头像"的对象优先。
 */
import type { BrowserWindow } from "electron"

export interface PageProfile {
  uid: string
  nickname: string
  avatar: string
}

const EMPTY: PageProfile = { uid: "", nickname: "", avatar: "" }

export interface CaptureHints {
  /** 昵称元素的 CSS 选择器（按优先级）。 */
  nicknameSelectors?: string[]
  /** 头像 img 的 CSS 选择器。 */
  avatarSelectors?: string[]
}

/** 每个平台认识的首屏全局变量名。只做浅层枚举，避免把整页数据序列化。 */
const STATE_GLOBALS = ["__INITIAL_STATE__", "__NUXT__", "__NEXT_DATA__", "cgiData", "__PRELOADED_STATE__"]

const NICK_KEYS = [
  "nickname",
  "nickName",
  "nick_name",
  "user_nickname",
  "userName",
  "user_name",
  "uname",
  "displayName",
  "authorName",
  "name",
]
const AVATAR_KEYS = ["avatar", "avatarUrl", "headimg", "head_img", "headImgUrl", "headImg", "face", "imageb", "avatar_url"]
const UID_KEYS = ["uid", "user_id", "userId", "sec_uid", "secUid", "mid", "uniqId", "fakeid", "authorId"]

/**
 * 在页面上下文里执行的抓取脚本。
 *
 * 返回值刻意保持为 `{ uid, nickname, avatar }` 三个字符串 ——
 * IPC 边界上只传可序列化的最小结果，不把整页 state 抄回来。
 */
export function buildCaptureScript(hints: CaptureHints) {
  const nickSelectors: string[] = hints.nicknameSelectors ?? []
  const avatarSelectors: string[] = hints.avatarSelectors ?? []
  return `(() => {
    const pick = (value) => (typeof value === "string" ? value.trim() : "");
    const abs = (value) => {
      const text = pick(value);
      if (!text) return "";
      if (text.startsWith("//")) return "https:" + text;
      if (/^https?:/i.test(text)) return text;
      return "";
    };
    const out = { uid: "", nickname: "", avatar: "" };
    // 有些后台的"账号名"位置会先渲染成占位文案（公众号/微信公众平台/小红书），
    // 那不是昵称，命中就当作没取到。
    const GENERIC = /^(公众号|微信公众平台|视频号|小红书|抖音|哔哩哔哩|bilibili|快手|闲鱼|登录|首页)$/i;
    const face = (text) => (text && !GENERIC.test(text) ? text : "");

    // 1) 页面选择器
    for (const sel of ${JSON.stringify(nickSelectors)}) {
      try {
        const node = document.querySelector(sel);
        const text = face(pick(node && (node.getAttribute("title") || node.textContent)));
        if (text) { out.nickname = text; break; }
      } catch {}
    }
    for (const sel of ${JSON.stringify(avatarSelectors)}) {
      try {
        const node = document.querySelector(sel);
        const src = abs(node && node.getAttribute("src"));
        if (src) { out.avatar = src; break; }
      } catch {}
    }

    // 2) 首屏全局状态（广度优先，限定层数，找同时带昵称和头像的对象）
    const NICK = ${JSON.stringify(NICK_KEYS)};
    const AVATAR = ${JSON.stringify(AVATAR_KEYS)};
    const UID = ${JSON.stringify(UID_KEYS)};
    const queue = [];
    for (const key of ${JSON.stringify(STATE_GLOBALS)}) {
      try {
        const value = window[key];
        if (value && typeof value === "object") queue.push({ node: value, depth: 0 });
      } catch {}
    }
    const seen = new Set();
    let scanned = 0;
    // 首屏 state 很杂（tab 名、按钮文案都在里面），单看"哪个字段像昵称"容易抓错。
    // 打分：对象里同时有昵称+头像最像账号资料，带 uid 再加一分，取最高分那个。
    let best = { score: 0, nickname: "", avatar: "", uid: "" };
    while (queue.length && scanned < 4000) {
      const { node, depth } = queue.shift();
      if (!node || depth > 6 || seen.has(node)) continue;
      seen.add(node);
      scanned++;
      const read = (keys) => {
        for (const key of keys) {
          try {
            const raw = node[key];
            const value = typeof raw === "number" ? String(raw) : pick(raw);
            if (value) return value;
          } catch {}
        }
        return "";
      };
      const nickname = face(read(NICK));
      const avatar = abs(read(AVATAR));
      const uid = read(UID);
      const score = (nickname ? 2 : 0) + (avatar ? 2 : 0) + (uid ? 1 : 0);
      if (score > best.score) best = { score, nickname, avatar, uid };
      if (best.score >= 5) break;
      for (const key of Object.keys(node)) {
        let value;
        try { value = node[key]; } catch { continue; }
        if (value && typeof value === "object") queue.push({ node: value, depth: depth + 1 });
      }
    }
    if (!out.nickname && best.nickname) out.nickname = best.nickname;
    if (!out.avatar && best.avatar) out.avatar = best.avatar;
    if (!out.uid && best.uid) out.uid = best.uid;

    // 3) 标题兜底（很多创作者后台标题就是"账号名 - 平台名"）
    if (!out.nickname) {
      const title = face(pick(document.title).split(/[-|_–—]/)[0].trim());
      if (title) out.nickname = title;
    }
    return out;
  })()`
}

/** 在当前页面上抓一份账号资料；页面被销毁或脚本失败时返回空值。 */
export async function capturePageProfile(win: BrowserWindow, hints: CaptureHints = {}): Promise<PageProfile> {
  if (win.isDestroyed()) return EMPTY
  try {
    const result = (await win.webContents.executeJavaScript(buildCaptureScript(hints), true)) as Partial<PageProfile> | null
    return {
      uid: (result?.uid ?? "").trim(),
      nickname: (result?.nickname ?? "").trim(),
      avatar: (result?.avatar ?? "").trim(),
    }
  } catch {
    return EMPTY
  }
}

/** 等待页面里出现某个元素（登录后台常见的异步首屏）。 */
export async function waitForSelector(win: BrowserWindow, selector: string, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (win.isDestroyed()) return false
    try {
      const found = await win.webContents.executeJavaScript(
        `!!document.querySelector(${JSON.stringify(selector)})`,
        true,
      )
      if (found) return true
    } catch {
      /* 页面正在导航时会抛，重试即可 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}
