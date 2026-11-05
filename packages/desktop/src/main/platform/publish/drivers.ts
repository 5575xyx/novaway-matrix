/**
 * 各平台的「发布页」描述。
 *
 * 为什么用页面自动化而不是接口：这些平台的内容接口都要求 x-s/x-t 之类的签名，
 * 逆向签名既脆弱又有风险；而"用户在浏览器里点发布"这条路是平台自己保证可用的。
 * 我们只是把同样的操作在已登录的页面里重放一遍：选文件 → 填标题/正文 → 点发布。
 *
 * 选择器来自几个开源实现的实测产物（它们每天都在跟平台改版打架）：
 * - kebenxiaoming/matrix（抖音/快手/视频号/小红书的 Playwright 发布脚本）
 * - hanliang77/MatrixMedia（Electron + puppeteer，和我们同构，含影子树/坐标点击的处理）
 * - wechatsync/Wechatsync（公众号草稿箱，直接调 cgi-bin 接口）
 *
 * 选择器都给了多个候选（站点改版很频繁），任何命中即用；全部落空时错误信息
 * 会写明是哪一步失败，便于按平台补选择器。
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
  /**
   * 不用 DOM，直接调后台自己的建草稿接口。
   * 公众号的「保存为草稿」就是这条路 —— 不受编辑器版本、iframe 布局影响。
   */
  draftApi?: "wechat"
  /** 文件输入框候选选择器（input[type=file]）。 */
  fileInput?: string[]
  /** 标题输入框候选。 */
  titleInput?: string[]
  /** 正文编辑器候选（textarea / contenteditable / 同源 iframe / 影子树）。 */
  descriptionEditor?: string[]
  /** 提交按钮选择器（优先于文案匹配：文案会随活动和改版变）。 */
  submitSelector?: string[]
  /** 提交按钮的文案（正则源码，匹配按钮的可见文本）。 */
  submitText?: string[]
  /**
   * 按钮在 **closed shadow root** 里时的点法：先取宿主元素位置，
   * 再按比例/偏移量换算成坐标，用真实鼠标事件点（小红书）。
   */
  submitClick?: { host: string; xRatio?: number; yOffset?: number; waitAttr?: { name: string; value: string } }
  /** 成功后页面上会出现的文案。 */
  successText?: string[]
  /** 成功后页面会跳到的地址（含该片段的路径）。 */
  successUrl?: string
  /** 上传中会出现的文案（抖音的「取消上传」）。 */
  uploadingText?: string[]
  /** 上传完成会出现的文案（抖音的「重新上传 / 上传成功」）。 */
  uploadedText?: string[]
  /** 上传完成后才能点提交；用于等待按钮可用。 */
  readyText?: string[]
  /**
   * 成功时的用户可见文案。有些平台的自动流程只做到"存草稿"（群发不可撤销），
   * 这时候说"发布成功"是在骗人。
   */
  successMessage?: string
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
    // 新版上传框是 `input.upload-input`；老版仍是裸的 input[type=file]。
    fileInput: ["input.upload-input", 'input[type="file"]'],
    titleInput: ['input[placeholder*="填写标题"]', ".d-text input"],
    // tiptap 编辑器；纯 contenteditable 是老版。
    descriptionEditor: ["div.tiptap", 'div[contenteditable="true"]'],
    // 新版发布按钮在 <xhs-publish-btn> 的 closed shadow root 里，DOM 点不到：
    // 宿主要等到 submit-disabled="false"，然后在宿主矩形右侧按坐标点。
    submitClick: { host: "xhs-publish-btn", xRatio: 0.8, yOffset: 26, waitAttr: { name: "submit-disabled", value: "false" } },
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
    // 上传区的容器 class 是哈希（改版就变），但 input[type=file] 一直在。
    fileInput: ['input[type="file"]'],
    titleInput: ['input[placeholder*="作品标题"]', 'input[placeholder*="标题"]'],
    // 新版是 Slate 的 .zone-container，老版是裸 contenteditable。
    descriptionEditor: [".zone-container", 'div[contenteditable="true"]'],
    submitText: ["^发布$"],
    // 「上传成功」一闪而过、「重新上传」传输中也会出现，都不能单独当判据；
    // 要等「取消上传」消失且出现「重新上传/上传成功」。见 uploadingText/uploadedText。
    uploadingText: ["取消上传"],
    uploadedText: ["重新上传", "上传成功"],
    successText: ["发布成功", "作品发布成功"],
    successUrl: "/creator-micro/content/manage",
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
    fileInput: ['.bcc-upload input[type="file"]', 'input[type="file"]'],
    titleInput: ['.input-instance input[placeholder="请输入稿件标题"]', 'input[placeholder*="稿件标题"]'],
    // 新版投稿页的简介是 Quill。
    descriptionEditor: [".desc-container .ql-editor", 'div[contenteditable="true"]'],
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
    // 新版描述框是 contenteditable 的 div，placeholder 为「作品描述…」。
    descriptionEditor: ["div[placeholder*='作品描述']", 'div[contenteditable="true"]'],
    // 左侧 div.publish-button 只是导航项，点了没反应；真正的是底部主按钮。
    submitSelector: ["div[class*='button-primary']"],
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
    // 整页在 wujie 微前端的影子树里（wujie-app.wujie_iframe.shadowRoot），
    // automation 的深度查询会走进去，所以这里写影子树内部的普通选择器即可。
    titleInput: ["div.input-editor"],
    descriptionEditor: ["div.input-editor", 'div[contenteditable="true"]'],
    submitSelector: ["div.form-btns button"],
    submitText: ["^发表$"],
    // 发表成功后跳到作品列表；比匹配 toast 稳（toast 只活 2-3 秒）。
    successUrl: "/platform/post/list",
    successText: ["已保存", "发表成功"],
  },
  wxGzh: {
    id: "wxGzh",
    name: "公众号",
    hosts: ["mp.weixin.qq.com"],
    supports: ["article"],
    // 首页只是"先落到哪"：登录后地址栏里才会带上 token，编辑页要用它拼。
    url: {
      article: "https://mp.weixin.qq.com/",
      video: undefined,
      image_text: undefined,
    },
    editorUrl: (token) =>
      `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&lang=zh_CN&token=${token}`,
    // 后台自己的「保存为草稿」就是调 cgi-bin 接口；直接调比点 DOM 稳，
    // 也不会误触「群发」（不可撤销 + 有次数限制）。
    draftApi: "wechat",
    titleInput: ["#activity-name", 'textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'],
    // 正文在 iframe#ueditor_0 里；automation 会下钻到 iframe 的 body。
    descriptionEditor: [
      "iframe#ueditor_0",
      'iframe[id^="ueditor_"]',
      '#js_editor_area [contenteditable="true"]',
      ".ProseMirror",
    ],
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
