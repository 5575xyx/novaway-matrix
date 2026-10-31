import { findBuiltinExtension, type BuiltinExtension } from "@/components/builtin-extensions-data"
import type { OfficeOccupation } from "@/context/settings"
import type { HomeActionId } from "./zen-office"

/**
 * 办公模式的「插件」目录 —— 对齐 ZCode 的 officeSuggestedPrompts + Plugin catalog。
 *
 * ZCode 办公模式的推荐提示词不是一句孤立的话，每一条都挂在某个插件（Plugin）上：
 * 插件没装/没开，提示词就只能提示你去装。我们这边的「插件」就是**内置扩展**
 * （`builtin-extensions-data.ts`）：技能型写 `config.skills.disabled`，浏览器/电脑控制
 * 写各自的开关。同一个 id 同时被扩展设置页、输入卡的插件行、推荐提示词使用，
 * 因此「设置里关掉某个插件 → 对应提示词变灰」是自然成立的，不需要再维护一份状态。
 */
export type OfficePluginCategory = "office" | "creation" | "finance" | "utility"

export type LocalizedText = { cn: string; en: string }

export type OfficePromptItem = {
  id: string
  pluginID: string
  /** 列表面板里的一行标题。 */
  title: LocalizedText
  /** 点下去填进输入框的内容。 */
  prompt: LocalizedText
}

export type OfficePlugin = {
  id: string
  category: OfficePluginCategory
  prompts: OfficePromptItem[]
}

export const OFFICE_PLUGIN_CATEGORIES: Array<{ id: OfficePluginCategory | "all"; labelKey: string }> = [
  { id: "all", labelKey: "office.plugin.category.all" },
  { id: "office", labelKey: "office.plugin.category.office" },
  { id: "creation", labelKey: "office.plugin.category.creation" },
  { id: "finance", labelKey: "office.plugin.category.finance" },
  { id: "utility", labelKey: "office.plugin.category.utility" },
]

function prompt(id: string, pluginID: string, title: LocalizedText, body: LocalizedText): OfficePromptItem {
  return { id, pluginID, title, prompt: body }
}

export const OFFICE_PLUGINS: OfficePlugin[] = [
  {
    id: "documents",
    category: "office",
    prompts: [
      prompt(
        "doc-polish",
        "documents",
        { cn: "整理成 Word 文档", en: "Turn notes into a Word document" },
        {
          cn: "把我的笔记整理成一份排版清晰的 Word 文档，先给结论，再按小节展开。",
          en: "Turn my notes into a clearly formatted Word document: lead with the conclusion, then expand section by section.",
        },
      ),
      prompt(
        "doc-report",
        "documents",
        { cn: "写一份工作报告", en: "Write a work report" },
        {
          cn: "把当前资料整理成一份结构清晰的工作报告，先结论后过程，最后列出下一步行动。",
          en: "Turn the current material into a well-structured work report: conclusion first, then the process, ending with next steps.",
        },
      ),
    ],
  },
  {
    id: "presentations",
    category: "office",
    prompts: [
      prompt(
        "ppt-proposal",
        "presentations",
        { cn: "做一份客户提案", en: "Build a client proposal deck" },
        {
          cn: "生成一份 8 页客户提案 PPT，面向企业管理层，突出业务价值、落地路径和下一步行动。",
          en: "Create an 8-slide client proposal deck for an executive audience, focused on business value, rollout path and next steps.",
        },
      ),
      prompt(
        "ppt-intro",
        "presentations",
        { cn: "把资料转成产品介绍", en: "Turn material into a product deck" },
        {
          cn: "把资料转成产品介绍 PPT，面向非技术管理层，语言简洁有说服力，并给出演讲备注。",
          en: "Turn the material into a product intro deck for a non-technical audience, with concise persuasive copy and speaker notes.",
        },
      ),
    ],
  },
  {
    id: "spreadsheets",
    category: "office",
    prompts: [
      prompt(
        "sheet-trend",
        "spreadsheets",
        { cn: "分析 Excel 关键趋势", en: "Analyze key trends in Excel" },
        {
          cn: "分析这份 Excel，找出关键趋势并生成图表；数字必须来自资料，估算要标注口径。",
          en: "Analyze this spreadsheet, identify the key trends and build the charts. Every number must come from the data; label any estimate.",
        },
      ),
      prompt(
        "sheet-pivot",
        "spreadsheets",
        { cn: "整理成透视分析", en: "Build a pivot analysis" },
        {
          cn: "把原始数据整理成透视分析，包含关键指标、口径说明、结论和可执行建议。",
          en: "Turn the raw data into a pivot analysis with key metrics, definitions, conclusions and actionable recommendations.",
        },
      ),
    ],
  },
  {
    id: "meetings",
    category: "office",
    prompts: [
      prompt(
        "meeting-notes",
        "meetings",
        { cn: "整理会议纪要", en: "Summarize a meeting" },
        {
          cn: "把这次会议整理成纪要：结论、决议、行动项、负责人和截止时间，区分事实与未确认事项。",
          en: "Turn this meeting into minutes: conclusions, decisions, action items, owners and due dates, separating facts from open questions.",
        },
      ),
    ],
  },
  {
    id: "tasks",
    category: "office",
    prompts: [
      prompt(
        "task-breakdown",
        "tasks",
        { cn: "拆解成任务清单", en: "Break work into tasks" },
        {
          cn: "把这份需求拆成可执行的任务清单，标出依赖、优先级、风险和今天就能开始的事项。",
          en: "Break this request into an actionable task list with dependencies, priority, risks and what can start today.",
        },
      ),
    ],
  },
  {
    id: "communication",
    category: "office",
    prompts: [
      prompt(
        "mail-progress",
        "communication",
        { cn: "写一封进展汇报邮件", en: "Draft a progress email" },
        {
          cn: "给客户写一封进展汇报邮件，先给结论，再列已完成、风险和需要对方确认的事项，语气专业克制。",
          en: "Draft a progress email to the client: conclusion first, then done / risks / what we need from them, in a professional tone.",
        },
      ),
    ],
  },
  {
    id: "knowledge",
    category: "office",
    prompts: [
      prompt(
        "knowledge-summary",
        "knowledge",
        { cn: "总结这份资料", en: "Summarize this material" },
        {
          cn: "总结这份行业报告，提炼关键结论、术语和数据，并保留来源线索。",
          en: "Summarize this industry report: key conclusions, terminology and data, keeping the source references.",
        },
      ),
    ],
  },
  {
    id: "design",
    category: "creation",
    prompts: [
      prompt(
        "design-poster",
        "design",
        { cn: "设计一张活动海报", en: "Design an event poster" },
        {
          cn: "为新品发布设计一张活动海报，给出信息层级、构图、视觉基调和可直接使用的配色与字体值。",
          en: "Design a launch poster: information hierarchy, composition, visual tone and concrete color and type values I can hand to a designer.",
        },
      ),
    ],
  },
  {
    id: "visualize",
    category: "creation",
    prompts: [
      prompt(
        "viz-dashboard",
        "visualize",
        { cn: "做一个数据看板", en: "Build a data dashboard" },
        {
          cn: "做一个销售周报看板，包含核心指标、趋势图和排名表，直接用可交互的 HTML 页面呈现。",
          en: "Build a weekly sales dashboard with key metrics, trend charts and a ranking table, delivered as an interactive HTML page.",
        },
      ),
    ],
  },
  {
    id: "wxgzh-ops",
    category: "creation",
    prompts: [
      prompt(
        "wxgzh-topic",
        "wxgzh-ops",
        { cn: "公众号选题与初稿", en: "WeChat article topics and draft" },
        {
          cn: "给我几个本周公众号选题方向，说明各自的目标读者和切入角度，然后写出其中一篇的初稿。",
          en: "Suggest a few WeChat article topics for this week with target readers and angles, then draft the strongest one.",
        },
      ),
    ],
  },
  {
    id: "xiaohongshu-ops",
    category: "creation",
    prompts: [
      prompt(
        "xhs-note",
        "xiaohongshu-ops",
        { cn: "写一篇小红书笔记", en: "Write a Xiaohongshu note" },
        {
          cn: "为新品写一篇小红书笔记，包含标题、正文、话题标签和配图建议，语气自然口语化。",
          en: "Write a Xiaohongshu note for the new product: title, body, hashtags and image suggestions, in a natural conversational voice.",
        },
      ),
    ],
  },
  {
    id: "browser-use",
    category: "utility",
    prompts: [
      prompt(
        "browser-check",
        "browser-use",
        { cn: "检查本地网页问题", en: "Check my local site" },
        {
          cn: "帮我检查本地网页，找出布局和交互上的问题，并截图说明每一处。",
          en: "Check my local website for layout and interaction issues and screenshot each one.",
        },
      ),
    ],
  },
  {
    id: "computer-use",
    category: "utility",
    prompts: [
      prompt(
        "computer-files",
        "computer-use",
        { cn: "找出占空间的文件", en: "Find space-hogging files" },
        {
          cn: "帮我看看电脑上哪些文件占用了主要空间，按目录列出前几名并说明哪些可以安全清理。",
          en: "Find which files take up the most space on this computer, list the top directories and explain what is safe to clean up.",
        },
      ),
    ],
  },
  {
    id: "skill-tools",
    category: "utility",
    prompts: [
      prompt(
        "skill-make",
        "skill-tools",
        { cn: "把流程做成技能", en: "Turn a workflow into a skill" },
        {
          cn: "把我经常重复的工作流程做成一个可复用的技能，包含触发条件、步骤和需要用户确认的地方。",
          en: "Turn my recurring workflow into a reusable skill with triggers, steps and the points where I need to confirm.",
        },
      ),
    ],
  },
  {
    id: "memory-service",
    category: "utility",
    prompts: [
      prompt(
        "memory-pref",
        "memory-service",
        { cn: "记住我的输出偏好", en: "Remember my output preferences" },
        {
          cn: "记住我的写作偏好：先给结论、少用形容词、重要数字标注来源，以后默认按这个风格输出。",
          en: "Remember my writing preferences: conclusion first, few adjectives, cite the source for every important number, and use this style by default.",
        },
      ),
    ],
  },
]

/**
 * 插件 → 办公场景。
 *
 * 场景决定这一轮的办公上下文（office-agent-prompt 会按场景注入要求）。点了「做一份客户提案」
 * 却仍停在上一次选的「文档整理」，模型收到的上下文和用户刚点的提示词是对不上的 ——
 * 所以推荐提示词必须能把场景一起带过去。没有对应场景的（浏览器、电脑控制等）留空。
 */
const PLUGIN_SCENE: Record<string, HomeActionId> = {
  documents: "document",
  presentations: "ppt",
  spreadsheets: "data",
  meetings: "document",
  tasks: "document",
  communication: "document",
  knowledge: "knowledge",
  design: "design",
  visualize: "web",
}

const FINANCE_PLUGINS: OfficePlugin[] = [
  {
    id: "spreadsheets",
    category: "finance",
    prompts: [
      prompt(
        "fin-cashflow",
        "spreadsheets",
        { cn: "未来 13 周现金流预测", en: "13-week cash flow forecast" },
        {
          cn: "根据这份收支数据，做一份未来 13 周的现金流预测，列出关键假设、风险区间和最紧的几周。",
          en: "Use this income and expense data to forecast cash flow for the next 13 weeks, listing key assumptions, risk ranges and the tightest weeks.",
        },
      ),
    ],
  },
  {
    id: "knowledge",
    category: "finance",
    prompts: [
      prompt(
        "fin-due-diligence",
        "knowledge",
        { cn: "做一份企业尽调", en: "Run company due diligence" },
        {
          cn: "帮我对这家公司做一份尽调，重点看关联关系、股权结构和经营风险，结论与推断分开写。",
          en: "Run due diligence on this company: related parties, ownership structure and operating risks. Keep conclusions separate from inferences.",
        },
      ),
    ],
  },
  {
    id: "documents",
    category: "finance",
    prompts: [
      prompt(
        "fin-review",
        "documents",
        { cn: "整理财务复盘报告", en: "Write a finance review" },
        {
          cn: "把这期财务数据整理成一份复盘报告：先给结论，再讲收支结构、偏差原因和下一步动作，数字标注口径。",
          en: "Turn this period's finance data into a review report: conclusion first, then revenue/cost structure, variance causes and next actions, with every number labelled by its definition.",
        },
      ),
    ],
  },
]

OFFICE_PLUGINS.push(...FINANCE_PLUGINS)

/** 一条提示词 + 它所属插件的展示信息，界面直接消费。 */
export type OfficeSuggestedItem = {
  id: string
  pluginID: string
  plugin: BuiltinExtension
  /** 该插件对应的办公场景；点击时可以顺带把场景切过去。 */
  scene?: HomeActionId
  /** 这条提示词属于哪一组（同一个插件可以有财务组、办公组两份提示词）。 */
  category: OfficePluginCategory
  label: string
  prompt: string
}

export function officePluginByID(id: string) {
  return OFFICE_PLUGINS.find((item) => item.id === id)
}

export function localizedText(value: LocalizedText, locale: string) {
  return locale === "zh" || locale === "zht" ? value.cn : value.en
}

/**
 * 所有可用的推荐提示词。
 *
 * 排序规则照搬 ZCode 的 `getRecommendedPromptPool(isOfficeMode, occupation)`：
 * - 财务职业：财务组排在最前；其他职业：财务组**整个不出现**（提示词本身依赖财务口径，
 *   给所有人看只是噪音）；
 * - 后面的其余条目保持目录顺序 —— 换的是优先级，不是内容集合。
 */
export function officeSuggestedItems(
  locale: string,
  options: {
    category?: OfficePluginCategory | "all"
    occupation?: OfficeOccupation
    onlyEnabled?: (id: string) => boolean
  } = {},
): OfficeSuggestedItem[] {
  const category = options.category ?? "all"
  const occupation = options.occupation ?? "general"
  const preferred: OfficePluginCategory = occupation === "finance" ? "finance" : "office"

  const eligible = OFFICE_PLUGINS.filter((plugin) => plugin.category !== "finance" || occupation === "finance").filter(
    (plugin) => category === "all" || plugin.category === category,
  )

  const ordered = [
    ...eligible.filter((plugin) => plugin.category === preferred),
    ...eligible.filter((plugin) => plugin.category !== preferred),
  ]

  const out: OfficeSuggestedItem[] = []
  for (const plugin of ordered) {
    if (options.onlyEnabled && !options.onlyEnabled(plugin.id)) continue
    const extension = findBuiltinExtension(plugin.id)
    if (!extension) continue
    for (const item of plugin.prompts) {
      const text = localizedText(item.prompt, locale)
      out.push({
        id: item.id,
        pluginID: plugin.id,
        plugin: extension,
        scene: PLUGIN_SCENE[plugin.id],
        category: plugin.category,
        label: text,
        prompt: text,
      })
    }
  }
  return out
}

/**
 * 插件选择器用：按分类过滤，附带内置扩展定义（开关落点在那里）。
 *
 * 同一个插件会同时出现在「办公文档」和「财务」两组里（同一个技能、不同的提示词），
 * 选择器按**插件**列出开关，必须去重，否则同一行开关会出现两次。
 */
export function officePluginEntries(category: OfficePluginCategory | "all" = "all") {
  const seen = new Set<string>()
  const out: Array<{ plugin: OfficePlugin; extension: BuiltinExtension }> = []
  for (const plugin of OFFICE_PLUGINS) {
    if (category !== "all" && plugin.category !== category) continue
    if (seen.has(plugin.id)) continue
    const extension = findBuiltinExtension(plugin.id)
    if (!extension) continue
    seen.add(plugin.id)
    out.push({ plugin, extension })
  }
  return out
}
