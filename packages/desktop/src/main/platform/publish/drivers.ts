/**
 * 各平台的「发布页」描述。
 *
 * 为什么用页面自动化而不是接口：这些平台的内容接口都要求 x-s/x-t 之类的签名，
 * 逆向签名既脆弱又有风险；而"用户在浏览器里点发布"这条路是平台自己保证可用的。
 * 我们只是把同样的操作在隐藏窗口里重放一遍：选文件 → 填标题/正文 → 点发布。
 *
 * 选择器都给了多个候选（站点改版很频繁），任何一个命中即可；全部落空时
 * 错误信息会写明是哪一步失败，便于按平台补选择器。
 */
import type { PublishKind } from "./types"

export interface PublishDriver {
  id: string
  name: string
  /** 支持的发布类型；不支持的类型在执行前就会被拦下（而不是打开页面才发现）。 */
  supports: PublishKind[]
  /** 发布页地址。 */
  url: Record<PublishKind, string | undefined>
  /**
   * 平台发布页所在的域名。运营工作台里已经打开了这个域名的页面时，
   * 发布直接在那块**用户看得见的登录页面**里做，而不是另开隐藏窗口。
   */
  hosts?: string[]
  /**
   * 有登录 token 才能进的编辑页。`url` 只是"先落到哪"的入口（通常是首页），
   * 真正的编辑地址要拿地址栏里的 token 拼出来。
   */
  editorUrl?: (token: string) => string
  /** 文件输入框候选选择器（input[type=file]）。 */
  fileInput?: string[]
  /** 标题输入框候选。 */
  titleInput?: string[]
  /** 正文编辑器候选（textarea / contenteditable）。 */
  descriptionEditor?: string[]
  /** 提交按钮的文案（正则源码，匹配 button 的可见文本）。 */
  submitText?: string[]
  /** 成功后页面上会出现的文案。 */
  successText?: string[]
  /**
   * 成功时的用户可见文案。有些平台的自动流程只做到"存草稿"（群发不可撤销），
   * 这时候说"发布成功"是在骗人。
   */
  successMessage?: string
  /** 上传完成后才能点提交；用于等待按钮可用。 */
  readyText?: string[]
}

const XHS_IMAGE_TEXT = "https://creator.xiaohongshu.com/publish/publish?target=image&source=official"
const XHS_VIDEO = "https://creator.xiaohongshu.com/publish/publish?target=video&source=official"

export const DRIVERS: Record<string, PublishDriver> = {
  xhs: {
    id: "xhs",
    name: "小红书",
    hosts: ["creator.xiaohongshu.com"],
    supports: ["video", "image_text"],
    url: { video: XHS_VIDEO, image_text: XHS_IMAGE_TEXT, article: undefined },
    fileInput: ['input[type="file"][accept*="video"]', 'input[type="file"][accept*="image"]', 'input[type="file"]'],
    titleInput: ['input[placeholder*="标题"]', ".d-text input", "input.d-text"],
    descriptionEditor: [
      'div[contenteditable="true"]',
      "textarea[placeholder*='正文']",
      "textarea[placeholder*='描述']",
    ],
    submitText: ["^发布$", "^发布笔记$"],
    successText: ["发布成功", "已发布"],
    readyText: ["上传成功", "重新上传"],
  },
  douyin: {
    id: "douyin",
    name: "抖音",
    hosts: ["creator.douyin.com"],
    supports: ["video", "image_text"],
    url: {
      video: "https://creator.douyin.com/creator-micro/content/upload",
      image_text: "https://creator.douyin.com/creator-micro/content/upload?mediaType=image",
      article: undefined,
    },
    fileInput: ['input[type="file"][accept*="video"]', 'input[type="file"][accept*="image"]', 'input[type="file"]'],
    titleInput: ['input[placeholder*="作品标题"]', 'input[placeholder*="标题"]'],
    descriptionEditor: ['div[contenteditable="true"]', "textarea[placeholder*='作品描述']"],
    submitText: ["^发布$"],
    successText: ["发布成功", "作品发布成功"],
    readyText: ["重新上传", "上传成功"],
  },
  bilibili: {
    id: "bilibili",
    name: "B站",
    hosts: ["member.bilibili.com"],
    // 专栏（article）入口存在，但提交流程没验证过，先不放开；
    // 放开的类型必须和渲染层 publish-capabilities.ts 的矩阵一致。
    supports: ["video"],
    url: {
      video: "https://member.bilibili.com/platform/upload/video/frame",
      image_text: undefined,
      article: "https://member.bilibili.com/platform/upload/text/edit",
    },
    fileInput: ['input[type="file"]'],
    titleInput: ['input[placeholder*="标题"]', ".video-title input"],
    descriptionEditor: ['div[contenteditable="true"]', "textarea"],
    submitText: ["^立即投稿$", "^发布$"],
    successText: ["投稿成功", "稿件投递成功"],
  },
  kwai: {
    id: "kwai",
    name: "快手",
    hosts: ["cp.kuaishou.com"],
    // 图文（atlas）入口存在，提交流程未验证，先不放开（同上，和界面矩阵保持一致）。
    supports: ["video"],
    url: {
      video: "https://cp.kuaishou.com/article/publish/video",
      image_text: "https://cp.kuaishou.com/article/publish/atlas",
      article: undefined,
    },
    fileInput: ['input[type="file"]'],
    titleInput: ['input[placeholder*="标题"]', ".title-input input"],
    descriptionEditor: ['div[contenteditable="true"]', "textarea"],
    submitText: ["^发布$"],
    successText: ["发布成功"],
  },
  wxSph: {
    id: "wxSph",
    name: "视频号",
    hosts: ["channels.weixin.qq.com"],
    supports: ["video", "image_text"],
    url: {
      video: "https://channels.weixin.qq.com/platform/post/create",
      image_text: "https://channels.weixin.qq.com/platform/post/create",
      article: undefined,
    },
    fileInput: ['input[type="file"]'],
    titleInput: ['input[placeholder*="描述"]', "input.input-editor"],
    descriptionEditor: ['div[contenteditable="true"]', "textarea"],
    submitText: ["^发表$", "^发布$"],
    successText: ["发表成功", "发布成功"],
  },
  wxGzh: {
    id: "wxGzh",
    name: "公众号",
    supports: ["article"],
    hosts: ["mp.weixin.qq.com"],
    url: {
      // 首页只是"先落到哪"：登录后地址栏里才会带上 token，编辑页要用它拼。
      article: "https://mp.weixin.qq.com/",
      video: undefined,
      image_text: undefined,
    },
    editorUrl: (token) =>
      `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&lang=zh_CN&token=${token}`,
    titleInput: ["#activity-name", 'textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'],
    // 正文在 iframe#ueditor_0 里；automation 会下钻到 iframe 的 body。
    descriptionEditor: [
      "iframe#ueditor_0",
      'iframe[id^="ueditor_"]',
      '#js_editor_area [contenteditable="true"]',
      ".ProseMirror",
    ],
    // 只保存草稿。群发是不可撤销的（还有次数限制），必须由用户自己在后台点。
    submitText: ["^保存为草稿$", "^保存$"],
    successText: ["已保存", "保存成功"],
    successMessage: "已保存为草稿，群发请在公众号后台确认后手动点",
  },
  xianyu: {
    id: "xianyu",
    name: "闲鱼",
    hosts: ["www.goofish.com"],
    supports: ["image_text"],
    url: {
      image_text: "https://www.goofish.com/publish",
      video: undefined,
      article: undefined,
    },
    fileInput: ['input[type="file"]'],
    titleInput: ['input[placeholder*="标题"]'],
    descriptionEditor: ['div[contenteditable="true"]', "textarea"],
    submitText: ["^发布$"],
    successText: ["发布成功"],
  },
}

export function getDriver(platform: string): PublishDriver | undefined {
  return DRIVERS[platform]
}

export function supportsKind(platform: string, kind: PublishKind): boolean {
  return !!getDriver(platform)?.supports.includes(kind)
}
