/**
 * 发布前预检。
 *
 * 借鉴社区里的「发布前审」skill（yuwen-publish-precheck、media-publish-check、
 * traffic-compass）：被平台拒稿或限流，代价远高于多花两秒自查一次。
 *
 * 这里只做**确定性**的部分 —— 极限词、引流词、功效承诺、标题/正文长度、素材形态。
 * 「标题吸不吸引人」「像不像 AI 写的」这类判断留给模型（见 bundled skill 的预检清单），
 * 代码里硬编码只会变成一堆误报。
 *
 * 分级约定：
 * - `error`：平台一定发不出去（空标题发公众号、视频给了两个文件），必须挡住；
 * - `warning`：大概率限流/被驳回，但用户可以自己决定（如极限词、微信号引流）；
 * - `hint`：提醒，不拦。
 */

export type PrecheckLevel = "error" | "warning" | "hint"

export interface PrecheckIssue {
  /** 规则 id：便于测试与前端做稳定 key。 */
  rule: string
  level: PrecheckLevel
  message: string
  /** 命中的原文片段，给用户看"是哪句"。 */
  evidence?: string
  /** 能直接照做的改法。 */
  fix?: string
}

export interface PrecheckInput {
  kind: "video" | "image_text" | "article"
  title: string
  description: string
  filePaths: string[]
  tags?: string[]
  scheduleTime?: number
}

export interface PrecheckResult {
  /** 没有 error 级问题才为 true。 */
  ok: boolean
  issues: PrecheckIssue[]
}

/**
 * 各平台的硬性长度上限（按平台发布页的实际限制，宁可保守）。
 *
 * 超长在有的平台是"拒绝保存"，有的平台是"静默截断" —— 后者更糟：
 * 用户以为发出去了，其实标题被切了一半。所以统一按 warning 提示。
 */
export const PLATFORM_LIMITS: Record<string, { name: string; title: number; body: number }> = {
  wxGzh: { name: "公众号", title: 64, body: 20_000 },
  xhs: { name: "小红书", title: 20, body: 1_000 },
  douyin: { name: "抖音", title: 55, body: 1_000 },
  wxSph: { name: "视频号", title: 30, body: 1_000 },
  kwai: { name: "快手", title: 30, body: 500 },
  bilibili: { name: "B站", title: 80, body: 2_000 },
}

/** 按码点计数：emoji 在 UTF-16 里是 2，直接 `.length` 会把 9 个字算成 18。 */
export function charCount(value: string): number {
  return Array.from(value).length
}

/**
 * 《广告法》第九条禁用词的高频子集。
 *
 * 只收"几乎一定是极限用语"的组合，避免把「最近」「最后」这类正常词也判成违规
 * （社区里不少词表直接收「最」，误报率高得没法用）。
 */
const ABSOLUTE_WORDS: Array<{ re: RegExp; label: string; fix: string }> = [
  { re: /最(好|佳|优|强|低|高|大|先进|专业|权威|便宜|划算|受欢迎|值得)/g, label: "极限词「最…」", fix: "改成具体事实，例如「比同类少 30%」" },
  { re: /(全国|全球|世界|行业|销量|排名|口碑)第[一1]/g, label: "极限词「…第一」", fix: "给出可核验的数据来源，或删掉排名表述" },
  { re: /(第一名|第一品牌|首选品牌|领导品牌|销量冠军)/g, label: "排名类极限词", fix: "删掉排名，换成品类或使用场景" },
  { re: /(顶级|顶尖|极致|唯一|独家|首创|史无前例|万能|绝对|永久有效|百分百|100%有效)/g, label: "绝对化用语", fix: "改为限定条件下的描述" },
  { re: /(国家级|世界级|全球首发|国家免检|国家认证)/g, label: "资质类禁用表述", fix: "删掉，除非能出示对应资质文件" },
]

/** 站外引流：各平台都会限流，小红书/抖音尤其严。 */
const DIVERSION_WORDS: Array<{ re: RegExp; label: string; fix: string }> = [
  { re: /(微信号|加微信|加 ?[vV]|vx|V信|威信|薇信)/gi, label: "站外引流（微信）", fix: "删掉联系方式，把用户留在平台内互动" },
  { re: /(扫码|二维码|进群|群聊|私信我|私信领取|扣1|扣一|链接在简介|主页有链接|看我主页)/g, label: "引流话术", fix: "改成平台内可完成的动作（收藏、关注、评论）" },
]

/** 医疗 / 金融 / 减肥类的功效承诺：轻则限流，重则封号。 */
const PROMISE_WORDS: Array<{ re: RegExp; label: string; fix: string }> = [
  { re: /(治愈|根治|包治|药到病除|一贴见效|无副作用|永久脱毛|包瘦|立刻见效)/g, label: "医疗功效承诺", fix: "改成体验描述，不要承诺疗效" },
  { re: /(稳赚|保本|零风险|躺赚|暴富|日入过万|月入十万|翻倍收益|无风险套利)/g, label: "收益承诺", fix: "删掉收益数字；理财类内容需要资质" },
]

/** 需要在发布页勾「AI 生成」标识的平台（不勾被判定为隐瞒，限流更狠）。 */
const AI_LABEL_PLATFORMS = new Set(["douyin", "xhs", "wxSph"])

function scan(
  text: string,
  patterns: Array<{ re: RegExp; label: string; fix: string }>,
  rule: string,
  level: PrecheckLevel,
): PrecheckIssue[] {
  const issues: PrecheckIssue[] = []
  const seen = new Set<string>()
  for (const pattern of patterns) {
    // 一段文案里可能踩好几处，全列出来用户才好一次改完。
    for (const match of text.matchAll(pattern.re)) {
      const evidence = match[0]
      const key = `${rule}:${evidence}`
      if (seen.has(key)) continue
      seen.add(key)
      issues.push({
        rule,
        level,
        message: `${pattern.label}：${evidence}`,
        evidence,
        fix: pattern.fix,
      })
      if (issues.filter((issue) => issue.rule === rule).length >= 8) return issues
    }
  }
  return issues
}

export function platformNames(platforms: string[]): string {
  return platforms.map((id) => PLATFORM_LIMITS[id]?.name ?? id).join("、")
}

/**
 * 预检一次发布输入。
 *
 * `platforms` 是本次要发的平台 id 列表 —— 长度限制和提示都按它取并集，
 * 所以批量和单发可以共用同一份规则。
 */
export function precheckPublish(input: PrecheckInput, platforms: string[]): PrecheckResult {
  const issues: PrecheckIssue[] = []
  const title = (input.title ?? "").trim()
  const body = (input.description ?? "").trim()
  const files = input.filePaths ?? []
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)

  // 1) 内容与素材形态：这些是平台一定发不出去的。
  if (!title && !body) {
    issues.push({ rule: "content-empty", level: "error", message: "标题和正文都是空的", fix: "至少写一段正文" })
  }
  if (input.kind !== "article" && files.length === 0) {
    issues.push({
      rule: "files-missing",
      level: "error",
      message: input.kind === "video" ? "还没有选择视频文件" : "还没有选择图片",
      fix: "先选素材再发布",
    })
  }
  if (input.kind === "video" && files.length > 1) {
    issues.push({
      rule: "video-multiple",
      level: "error",
      message: `视频发布只能带 1 个文件，现在选了 ${files.length} 个`,
      fix: "只保留一个视频",
    })
  }
  if (input.kind === "article" && files.length > 0) {
    issues.push({
      rule: "article-with-files",
      level: "warning",
      message: "文章类内容不会使用所选的视频/图片素材",
      fix: "确认无误即可，或清空素材",
    })
  }
  if (platforms.includes("wxGzh") && input.kind === "article" && !title) {
    issues.push({
      rule: "wechat-title-required",
      level: "error",
      message: "公众号文章必须有标题",
      fix: "填一个标题再发布",
    })
  }

  // 2) 长度：超了要么被拒，要么被静默截断（更糟）。
  for (const id of platforms) {
    const limit = PLATFORM_LIMITS[id]
    if (!limit) continue
    const titleLength = charCount(title)
    const bodyLength = charCount(body)
    if (title && titleLength > limit.title) {
      issues.push({
        rule: `title-too-long:${id}`,
        level: "warning",
        message: `${limit.name}标题上限约 ${limit.title} 字，现在是 ${titleLength} 字`,
        fix: "删减标题，或改成平台上的短标题",
      })
    }
    if (body && bodyLength > limit.body) {
      issues.push({
        rule: `body-too-long:${id}`,
        level: "warning",
        message: `${limit.name}正文上限约 ${limit.body} 字，现在是 ${bodyLength} 字`,
        fix: "拆成多篇，或删减正文",
      })
    }
  }
  if (title && charCount(title) > 30) {
    issues.push({
      rule: "title-long",
      level: "warning",
      message: `标题 ${charCount(title)} 字，信息流里通常只显示前 20 字`,
      fix: "把结论放前 15 字内",
    })
  }

  // 3) 违规词：整段（标题 + 正文 + 标签）一起扫，用户常常把引流话术写在标签里。
  const fullText = [title, body, tags.join(" ")].join("\n")
  issues.push(...scan(fullText, ABSOLUTE_WORDS, "absolute-words", "warning"))
  issues.push(...scan(fullText, DIVERSION_WORDS, "diversion", "warning"))
  issues.push(...scan(fullText, PROMISE_WORDS, "promise", "warning"))

  // 4) 标签：重复、过多、过长都会影响分发。
  const deduped = [...new Set(tags)]
  const duplicates = deduped.filter((tag) => tags.filter((item) => item === tag).length > 1)
  if (duplicates.length > 0) {
    issues.push({
      rule: "tags-duplicate",
      level: "warning",
      message: `标签重复：${duplicates.join("、")}`,
      fix: "去掉重复标签",
    })
  }
  if (tags.length > 10) {
    issues.push({
      rule: "tags-too-many",
      level: "hint",
      message: `带了 ${tags.length} 个标签，平台通常只认前几个`,
      fix: "保留 3-6 个最相关的",
    })
  }
  const longTags = tags.filter((tag) => charCount(tag) > 20)
  if (longTags.length > 0) {
    issues.push({
      rule: "tags-too-long",
      level: "hint",
      message: `标签过长：${longTags.join("、")}`,
      fix: "标签控制在 20 字内",
    })
  }

  // 5) 定时：过去的时间点不如直接发。
  if (input.scheduleTime && input.scheduleTime < Date.now()) {
    issues.push({
      rule: "schedule-past",
      level: "warning",
      message: "定时时间已经过去",
      fix: "改成将来的时间，或直接发布",
    })
  }

  // 6) AI 标识：纯提醒，不拦。
  const aiPlatforms = platforms.filter((id) => AI_LABEL_PLATFORMS.has(id))
  if (aiPlatforms.length > 0) {
    issues.push({
      rule: "ai-label",
      level: "hint",
      message: `${platformNames(aiPlatforms)} 要求标注 AI 生成内容`,
      fix: "发布页如果有「AI 生成」开关，记得打开",
    })
  }

  return {
    ok: !issues.some((issue) => issue.level === "error"),
    issues,
  }
}

/** 预检结论压成一句话，写进发布结果的 message / 错误信息。 */
export function summarizeIssues(issues: PrecheckIssue[]): string {
  return issues.map((issue) => (issue.fix ? `${issue.message}（${issue.fix}）` : issue.message)).join("；")
}
