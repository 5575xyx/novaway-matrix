/**
 * 投喂给队长的上下文也要有账（§6.4）。
 *
 * 队长判错，很多时候不是判断力差，而是它看到的 brief 被截断了、而没人记录这件事。
 * 所以每次派发都在**同一个纯函数**里既生成提示词、又生成这份清单：模型看到的字与
 * 事后审计的字来自同一份输出，不可能对不上。
 *
 * 截断必然发生（验收可能几十条、打回意见可能越滚越长），这里不假装不会截断，
 * 而是把「省了哪一段、省了几条、为什么省」写进清单，并把摘要写进提示词本身 ——
 * 模型知道自己少看了什么，复盘的人也知道该怪谁。
 */

/** 被省略的一段。记条数而不记条目本身：清单是账，不是提示词的副本。 */
export type Omission = {
  kind: "acceptance" | "member" | "feedback" | "brief"
  count: number
  /** 为什么省：超出条数上限 / 超出字符预算 / 单条过长。 */
  reason: string
}

export type Manifest = {
  /** 实际投喂的文本（截断后的），不是用户原始意图。 */
  brief: string
  /** 本轮验收项 `id + version`；全文在 `team_acceptance`，不重复存。 */
  acceptance: Array<{ id: string; version: number }>
  rosterVersion?: string
  /** 打回意见原文（截断后的）。 */
  feedback: string[]
  omitted: Omission[]
  /**
   * 是否存在截断。为真时界面必须显示、提示词里也必须说明 ——
   * 「悄悄少给几条」是不允许的。
   */
  truncated: boolean
  builtAt: number
}

export type Input = {
  goal: string
  /**
   * 用户声明的范围与约束（§5.3 `brief`）。
   *
   * 以前 `POST /run` 收下 `brief` 就存进库里，却从没进过队长的提示词 ——
   * 用户写的「只改 src/team」等于没写。现在它与目的一样是**投喂内容**：
   * 截断照样记账（`kind: "brief"`），模型知道自己少看了哪几条。
   */
  brief?: Brief
  acceptance: ReadonlyArray<{ id: string; version?: number; text: string; expected?: string }>
  members: ReadonlyArray<string>
  feedback: ReadonlyArray<string>
  rosterVersion?: string
}

/** 范围与约束。字段都是可选的：不填就是不限定，不编默认值。 */
export type Brief = {
  /** 这次要看/改的范围，每行一条（例如「当前 diff」「src/team」「PR #123」）。 */
  scope?: string[]
  /** 相关文件路径，每行一个。 */
  files?: string[]
  /** 硬约束，每行一条（例如「不要改测试」）。 */
  constraints?: string[]
  /** 补充背景，一段话。 */
  context?: string
}

/**
 * 把库里存的自由 JSON 读成 Brief。
 *
 * 运行表里的 `brief` 是 `Record<string, unknown>`（早期没有类型）。这里只收
 * 字符串与字符串数组，其余字段原样忽略 —— 旧数据不该因为多了一个键就派发失败，
 * 但它也不能把任意内容混进提示词。
 */
export function normalizeBrief(value: unknown): Brief | undefined {
  if (!value || typeof value !== "object") return undefined
  const list = (key: string): string[] | undefined => {
    const raw: unknown = Reflect.get(value, key)
    if (!Array.isArray(raw)) return undefined
    const items = raw.filter((item): item is string => typeof item === "string").map((item) => item.trim())
    const kept = items.filter((item) => item.length > 0)
    return kept.length > 0 ? kept : undefined
  }
  const context: unknown = Reflect.get(value, "context")
  const scope = list("scope")
  const files = list("files")
  const constraints = list("constraints")
  const brief: Brief = {
    ...(scope ? { scope } : {}),
    ...(files ? { files } : {}),
    ...(constraints ? { constraints } : {}),
    ...(typeof context === "string" && context.trim() ? { context: context.trim() } : {}),
  }
  return brief.scope || brief.files || brief.constraints || brief.context ? brief : undefined
}

export type Limits = {
  acceptance: number
  members: number
  feedback: number
  feedbackChars: number
  /** 范围 / 文件 / 约束各自的条数上限。 */
  brief: number
  /** 范围里单条的长度上限。 */
  briefChars: number
  /** 补充背景的字符上限。 */
  contextChars: number
  totalChars: number
}

/**
 * 缺省上限。数字不是拍脑袋：验收 40 条已经远超一次运行能验证的规模；
 * 打回意见留 12 条是因为超过之后模型只会照着最近几条改，其余纯属噪声。
 */
export const DEFAULT_LIMITS: Limits = {
  acceptance: 40,
  members: 20,
  feedback: 12,
  feedbackChars: 400,
  // 范围/约束是用户手写的，通常只有几行；给 12 是防粘贴整份方案。
  brief: 12,
  briefChars: 400,
  contextChars: 2_000,
  totalChars: 12_000,
}

const trim = (value: string, max: number) => (value.length <= max ? value : value.slice(0, Math.max(0, max - 1)) + "…")

type Assembled = {
  prompt: string
  omitted: Omission[]
  acceptance: Array<{ id: string; version: number }>
  feedback: string[]
}

/** 范围与约束里的一类条目：逐条截字、按条数上限取舍，并把省掉的记成 `brief`。 */
function briefList(items: readonly string[] | undefined, cap: { count: number; chars: number }, label: string, reason: string) {
  const omitted: Omission[] = []
  if (!items || items.length === 0) return { lines: [] as string[], omitted }
  const trimmed = items.map((item) => trim(item.trim(), cap.chars))
  const overlong = items.filter((item, index) => trimmed[index] !== item.trim()).length
  if (overlong > 0)
    omitted.push({ kind: "brief", count: overlong, reason: reason + "：" + label + " 单条超过 " + cap.chars + " 字" })
  const lines = trimmed.slice(0, Math.max(0, cap.count))
  if (trimmed.length > lines.length)
    omitted.push({
      kind: "brief",
      count: trimmed.length - lines.length,
      reason: reason + "：" + label + " 条数上限 " + cap.count,
    })
  return { lines, omitted }
}

/**
 * 按给定上限拼一份提示词，并把省掉的部分记下来。
 *
 * 顺序固定（目标 → 范围与约束 → 验收 → 打回意见 → 成员），超预算时从**低优先级**开始丢：
 * 先丢旧的打回意见，再丢后面的成员，再丢范围与约束，最后才动验收。目标永不删。
 */
function assemble(input: Input, cap: Limits, reason: string): Assembled {
  const omitted: Omission[] = []

  const keepAcceptance = input.acceptance.slice(0, Math.max(0, cap.acceptance))
  if (input.acceptance.length > keepAcceptance.length)
    omitted.push({
      kind: "acceptance",
      count: input.acceptance.length - keepAcceptance.length,
      reason: reason + "：条数上限 " + cap.acceptance,
    })

  // 单条过长的打回意见先截字；再只保留最近若干条（旧意见已经被新意见覆盖）。
  const trimmedFeedback = input.feedback.map((item) => trim(item, cap.feedbackChars))
  const overlong = input.feedback.filter((item, index) => trimmedFeedback[index] !== item).length
  if (overlong > 0)
    omitted.push({ kind: "feedback", count: overlong, reason: reason + "：单条超过 " + cap.feedbackChars + " 字" })
  const feedback = trimmedFeedback.slice(Math.max(0, trimmedFeedback.length - cap.feedback))
  if (trimmedFeedback.length > feedback.length)
    omitted.push({
      kind: "feedback",
      count: trimmedFeedback.length - feedback.length,
      reason: reason + "：条数上限 " + cap.feedback,
    })

  const members = input.members.slice(0, Math.max(0, cap.members))
  if (input.members.length > members.length)
    omitted.push({
      kind: "member",
      count: input.members.length - members.length,
      reason: reason + "：条数上限 " + cap.members,
    })

  // 范围与约束：用户自己写的，原样投喂；超长/超条数一律记账。
  const scope = briefList(input.brief?.scope, { count: cap.brief, chars: cap.briefChars }, "范围", reason)
  const files = briefList(input.brief?.files, { count: cap.brief, chars: cap.briefChars }, "相关文件", reason)
  const constraints = briefList(
    input.brief?.constraints,
    { count: cap.brief, chars: cap.briefChars },
    "约束",
    reason,
  )
  for (const part of [scope, files, constraints]) omitted.push(...part.omitted)
  const rawContext = input.brief?.context?.trim() ?? ""
  const contextText = trim(rawContext, cap.contextChars)
  if (contextText !== rawContext)
    omitted.push({ kind: "brief", count: 1, reason: reason + "：补充背景超过 " + cap.contextChars + " 字" })
  const briefSections: string[] = []
  if (scope.lines.length) briefSections.push("范围：", ...scope.lines.map((item) => "- " + item))
  if (files.lines.length) briefSections.push("相关文件：", ...files.lines.map((item) => "- " + item))
  if (constraints.lines.length) briefSections.push("约束：", ...constraints.lines.map((item) => "- " + item))
  if (contextText) briefSections.push("补充背景：" + contextText)

  const acceptanceLines = keepAcceptance.length
    ? keepAcceptance.map(
        (item) => "- [" + item.id + "] " + item.text + (item.expected ? "（预期：" + item.expected + "）" : ""),
      )
    : ["- （未声明验收，按目标自检）"]

  const sections: string[] = [
    "你是一个团队的队长，负责把下面的任务分派给成员、自己判定是否可以交付。",
    "",
    "【总目标】" + input.goal,
    // 范围与约束紧跟目标：它约束的是「怎么做」，不能排在验收后面被当成补充说明。
    ...(briefSections.length ? ["【范围与约束】", ...briefSections] : []),
    "【本次验收】",
    ...acceptanceLines,
    ...(feedback.length ? ["", "上一轮未达标的部分：", ...feedback.map((item) => "- " + item)] : []),
  ]
  if (members.length)
    sections.push(
      "",
      "【团队成员】",
      ...members,
      "把互不重叠的角度分派给成员（用 task 工具），自己做拆解、汇总与自检；只有确实没人能干的部分才自己做。",
      // 归属靠这句：工时按会话记账，队长的 task 调用把成员姓名写进 name，
      // 这次工作才会记在名册里那个人名下（§10.3）。不写就是「未归属」，不猜。
      '分派时把成员的姓名写进 task 的 name 参数（例如 name="小林"）：这是这次工作记在谁名下的依据。',
    )
  // 截断说明写进提示词：模型必须知道自己少看了什么，否则「没看到」会被当成「没有」。
  if (omitted.length)
    sections.push(
      "",
      "【上下文截断】本次投入的上下文被截断过：" +
        omitted.map((item) => item.kind + " 少了 " + item.count + " 条（" + item.reason + "）").join("；") +
        "。判定时请把这部分缺失考虑进去。",
    )
  sections.push(
    "",
    "不要修改验收标准。完成后只输出一个 JSON 对象：",
    '{"summary":"一句话交付说明","claims":[{"acceptanceID":"...","text":"...","evidence":"可复核的证据（命令/路径/输出片段）"}],"artifacts":[{"name":"...","version":1}],"done":true}',
  )

  return {
    prompt: sections.join("\n"),
    omitted,
    acceptance: keepAcceptance.map((item) => ({ id: item.id, version: item.version ?? 1 })),
    feedback: [...feedback],
  }
}

/**
 * 生成「提示词 + 清单」。
 *
 * 超过总字符预算时**不硬切字符串**（那会把 JSON 格式说明切掉，模型只会输出半截），
 * 而是收紧各段条数重拼：先砍打回意见，再砍成员，再砍范围与约束，最后才砍验收，
 * 并把砍掉的记成截断。
 */
export function build(input: Input, limits: Partial<Limits> = {}): { manifest: Manifest; prompt: string } {
  const cap: Limits = { ...DEFAULT_LIMITS, ...limits }
  let attempt = assemble(input, cap, "超出条数上限")
  let tightened: Limits = { ...cap }
  let tightening = false
  // 最多收紧几次：每轮至少砍掉一半，几十轮之内一定收敛；上限只是防御。
  for (let i = 0; attempt.prompt.length > cap.totalChars && i < 16; i++) {
    tightening = true
    if (tightened.feedback > 0) tightened = { ...tightened, feedback: Math.floor(tightened.feedback / 2) }
    else if (tightened.members > 0) tightened = { ...tightened, members: Math.floor(tightened.members / 2) }
    // 用户的约束优先于「列全成员」，但低于验收：验收丢了，判定就没有依据。
    else if (tightened.brief > 0) tightened = { ...tightened, brief: Math.floor(tightened.brief / 2) }
    else if (tightened.acceptance > 1) tightened = { ...tightened, acceptance: Math.floor(tightened.acceptance / 2) }
    else break
    attempt = assemble(input, tightened, "超出总字符预算 " + cap.totalChars)
  }

  return {
    prompt: attempt.prompt,
    manifest: {
      brief: attempt.prompt,
      acceptance: attempt.acceptance,
      ...(input.rosterVersion ? { rosterVersion: input.rosterVersion } : {}),
      feedback: attempt.feedback,
      omitted: attempt.omitted,
      // 任何一处省略都算截断：界面要显示，报告里要说明。
      truncated: attempt.omitted.length > 0 || tightening,
      builtAt: Date.now(),
    },
  }
}
