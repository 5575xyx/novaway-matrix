// ZCode 官方插件市场的目录。
//
// 运行时优先拉取线上 manifest（46+ 插件，带中英文名/图标/分类）；
// 下面的 `ZCODE_MARKETPLACE` 是离线兜底（FreeCodeZ 的官方快照，26 个），
// 网络不可用时至少还能看到一部分目录。
//
// 插件以 zip 发布：安装时下载解压到本地配置目录，再把其中的 skills / MCP 注册到配置。
export type ZcodeMarketplaceEntry = {
  name: string
  displayName?: string
  displayNameEn?: string
  description: string
  descriptionEn: string
  version: string
  author?: string
  category?: string
  keywords: string[]
  icon?: string
  url: string
  sha256?: string
  requiresPaidPlan?: boolean
  components?: string[]
}

/** 官方市场 manifest 地址（与 ZCode 默认市场源一致）。 */
export const ZCODE_MARKETPLACE_URL = "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json"

/** 线上 manifest 的原始条目（只声明我们读取的字段）。 */
export type ZcodeMarketplaceManifestEntry = {
  name?: unknown
  displayName?: unknown
  displayName_i18n?: unknown
  description?: unknown
  description_i18n?: unknown
  version?: unknown
  author?: unknown
  icon?: unknown
  category?: unknown
  componentTypes?: unknown
  requiresPaidPlan?: unknown
  keywords?: unknown
  source?: unknown
}

const asText = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

/**
 * 解析官方 manifest。
 *
 * 源是外部输入，必须防御性解析：没有 `source.url` 的条目丢弃（无法安装），
 * 中文名/描述缺失时回退英文，再回退条目名。
 */
export function parseZcodeMarketplace(value: unknown): ZcodeMarketplaceEntry[] {
  if (typeof value !== "object" || value === null) return []
  const record = value as { plugins?: unknown }
  if (!Array.isArray(record.plugins)) return []
  const entries: ZcodeMarketplaceEntry[] = []
  const seen = new Set<string>()
  for (const item of record.plugins) {
    if (typeof item !== "object" || item === null) continue
    const raw = item as Record<string, unknown>
    const name = asText(raw.name)
    const source = raw.source
    if (!name || seen.has(name) || typeof source !== "object" || source === null) continue
    const url = asText((source as Record<string, unknown>).url)
    if (!url) continue
    seen.add(name)
    const i18n = (value: unknown) =>
      typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
    const displayName = i18n(raw.displayName_i18n)
    const description = i18n(raw.description_i18n)
    const author =
      typeof raw.author === "object" && raw.author !== null ? (raw.author as Record<string, unknown>) : undefined
    entries.push({
      name,
      displayName: asText(displayName?.["zh-CN"]) ?? asText(displayName?.en) ?? asText(raw.displayName) ?? name,
      displayNameEn: asText(displayName?.en) ?? asText(raw.displayName) ?? name,
      description: asText(description?.["zh-CN"]) ?? asText(description?.en) ?? asText(raw.description) ?? "",
      descriptionEn: asText(description?.en) ?? asText(raw.description) ?? "",
      version: asText(raw.version) ?? "0.0.0",
      author: asText(author?.name) ?? asText(raw.author),
      category: asText(raw.category),
      keywords: Array.isArray(raw.keywords) ? raw.keywords.filter((tag): tag is string => typeof tag === "string") : [],
      icon: asText(raw.icon),
      url,
      sha256: asText((source as Record<string, unknown>).sha256),
      requiresPaidPlan: raw.requiresPaidPlan === true,
      components: Array.isArray(raw.componentTypes)
        ? raw.componentTypes.filter((tag): tag is string => typeof tag === "string")
        : [],
    })
  }
  return entries
}

/** 离线兜底目录（FreeCodeZ 官方快照）。 */
export const ZCODE_MARKETPLACE: ZcodeMarketplaceEntry[] = [
  {
    name: "cloudbase-skills",
    description:
      "腾讯云 CloudBase 开发技能与 MCP 集成，覆盖 Web、微信小程序、数据库、云函数、云托管、云存储和 AI 项目的开发、部署与排障。",
    descriptionEn:
      "CloudBase development skills and MCP integration for building, deploying, and troubleshooting Web, WeChat Mini Program, database, cloud function, CloudRun, storage, and AI projects.",
    version: "0.1.0",
    author: "TencentCloudBase",
    category: "developer-tools",
    icon: "https://docs.cloudbase.net/en/img/favicon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/cloudbase-skills/0.1.0/plugin.zip",
    sha256: "d60429f6ed70ef7e16b4f1a11b9afccd28dbef1118eb760f3d045bf7726c7f7c",
    keywords: ["cloudbase", "tencent-cloud", "wechat", "serverless", "mcp"],
  },
  {
    name: "mimosa",
    description:
      "面向 ZCode 的本地优先代码安全防线，提供写入前 Hook、任务收尾复查、Git 门禁、命令、安全扫描 Skill，以及用于密封深扫的可选 MCP 服务。",
    descriptionEn:
      "Local-first security guardrails for ZCode with pre-write hooks, end-of-turn review, Git gates, commands, a security-scan skill, and an optional MCP server for sealed deep scans.",
    version: "1.0.3",
    author: "Mimosa",
    category: "developer-tools",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/mimosa/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/mimosa/1.0.3/plugin.zip",
    sha256: "63fa21a04a30511a8b9aa72d45cd4e964ed832bb677ca81d211efd337ee4684c",
    keywords: ["security", "code-scanning", "hooks", "mcp", "sdlc"],
  },
  {
    name: "github",
    description:
      "基于 GitHub CLI 的 GitHub 工作流，覆盖提交、Pull Request、Issue、Release、Actions、仓库、Codespaces 等资源。",
    descriptionEn:
      "GitHub CLI workflows for commits, pull requests, issues, releases, Actions, repositories, Codespaces, and other GitHub resources.",
    version: "0.1.2",
    author: "Z.ai",
    category: "developer-tools",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/github/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/github/0.1.2/plugin.zip",
    sha256: "7320f15886d83625ed8eec944a7a2ab09fe99d64a42131ccec427eeecfd769b6",
    keywords: ["git", "github", "github-cli", "gh", "pull-request", "issues", "actions", "codespaces"],
  },
  {
    name: "video-agent-kit",
    description:
      "自动化视频剪辑工具包: 标准云端语音转录与合成、完整视频抽帧理解、局部复看、时间线、预览渲染、QC 和 TTS。",
    descriptionEn:
      "自动化视频剪辑工具包: 标准云端语音转录与合成、完整视频抽帧理解、局部复看、时间线、预览渲染、QC 和 TTS。",
    version: "0.4.3",
    author: "Z.ai",
    category: "productivity",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/video-agent/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/video-agent-kit/0.4.3/plugin.zip",
    sha256: "c085e64a9b57492455578dd4df293fcb197e1e5811dce4b40270e17bd518f1cb",
    keywords: ["video-editing", "video-agent", "visual-inspection", "timeline", "ffmpeg"],
  },
  {
    name: "video2code",
    description:
      "基于 ZCode 内置 Browser Use WebView 录制 WebM 并用 ffmpeg 转成 MP4/URL 复刻；无需 Playwright 或外部 Chromium",
    descriptionEn:
      "基于 ZCode 内置 Browser Use WebView 录制 WebM 并用 ffmpeg 转成 MP4/URL 复刻；无需 Playwright 或外部 Chromium",
    version: "0.6.0",
    author: "Z.ai",
    category: "productivity",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/video2code/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/video2code/0.6.0/plugin.zip",
    sha256: "9cbb927f5f039b28f93be35cbec3166792246fddf5ec58e16dfad6a38a07a5b7",
    keywords: ["video2code", "replication", "webapp", "motion"],
  },
  {
    name: "accounting-and-reporting",
    description:
      "【企业财务】核算与报告:月结关账检查与阻断项、总账与明细账勾稽及交易级差异归因、科目映射与重分类、内部管理报表编制、三表勾稽复核",
    descriptionEn:
      "Accounting close and statutory reporting off the company's own ledger: month-end close checks, ledger reconciliation to transaction-level root cause, account mapping for consolidation, and statutory statements delivered as review-ready drafts",
    version: "0.1.1",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/accounting-reporting/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/accounting-and-reporting/0.1.1/plugin.zip",
    sha256: "6b37a08359b7a42e8b1af88c0f955293269934894df26b5f88e1a02877ee9fd5",
    keywords: ["accounting", "month-end-close", "reconciliation", "statutory-reporting", "consolidation"],
  },
  {
    name: "assess-credit",
    description: "【二级市场】固收研究:债券档案与估值、发行主体信用、收益率曲线与信用利差、信用风险跟踪",
    descriptionEn:
      "Fixed-income and credit research: bond profiles with valuation and duration/convexity/spread, issuer credit assessment, yield-curve and credit-spread analysis, and credit-risk watchlists for onshore bonds",
    version: "0.1.2",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/fixed-income-research/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/assess-credit/0.1.2/plugin.zip",
    sha256: "be83d254ee13cbac24e3fc97a52e91d9c353fa43d5b24e0afc7029c66b29208d",
    keywords: ["fixed-income", "credit-research", "bonds", "yield-curve", "credit-spread"],
  },
  {
    name: "find-clients",
    description: "【一级市场与银行】对公营销:按区域/产业链/园区筛选目标客户、园区与集群扫描、商机线索、客户全景画像",
    descriptionEn:
      "Corporate-banking client acquisition: prospect screening by region, industry chain, park and cluster, business-opportunity scanning, and full client portraits combining registry, relationships, opportunity signals and risk",
    version: "0.1.2",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/corporate-client-acquisition/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/find-clients/0.1.2/plugin.zip",
    sha256: "d0d798b6d23fbaf360a2d72e8f5f6d6654e5ba34cb24916259c76023ff386c71",
    keywords: ["corporate-banking", "prospecting", "client-acquisition", "industry-chain", "kyc"],
  },
  {
    name: "model-deals",
    description: "【一级市场与银行】交易测算:并购增厚/摊薄、资金来源与用途及形式资本结构、可比交易、募投与摊薄",
    descriptionEn:
      "Transaction structuring and modeling: accretion/dilution analysis, sources and uses with pro-forma capital structure, precedent-transaction comps, and capital-raise dilution modeling for M&A, IPO, placements, and rights issues",
    version: "0.1.1",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/trade-calculator/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/model-deals/0.1.1/plugin.zip",
    sha256: "89ea6e6697eed1c664842a4fd24b0e7f4f759aac4e8cc496a12c92110502cf79",
    keywords: ["m-and-a", "deal-modeling", "accretion-dilution", "ipo", "capital-structure"],
  },
  {
    name: "pick-funds",
    description: "【二级市场】基金选品:多条件筛选、基金与经理画像、持仓风格与重合度分析",
    descriptionEn:
      "Fund and fund-manager research: multi-criteria fund screening, fund and manager profiles, holdings and style analysis, and shortlist comparisons for funds, ETFs, and LOFs",
    version: "0.1.1",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/fund-research/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/pick-funds/0.1.1/plugin.zip",
    sha256: "b8c372f8c476be3bedfde000553d66f70799d1be8a7452a662be84d1bce071f0",
    keywords: ["funds", "etf", "fund-screening", "manager-research", "holdings-analysis"],
  },
  {
    name: "read-macro",
    description: "【二级市场】自上而下:宏观仪表盘、指数估值分位与盈利归因、大类资产配置观点、政策与产业规划跟踪",
    descriptionEn:
      "Top-down macro and strategy work: macro dashboards across growth/inflation/liquidity/credit, index valuation percentiles and earnings attribution, cross-asset allocation views, and policy and industrial-plan tracking",
    version: "0.1.1",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/macro-strategy/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/read-macro/0.1.1/plugin.zip",
    sha256: "0c759fac6019d9413373f495b3476dfb5cec57c2ccf907dab1f5c091145fa513",
    keywords: ["macro", "strategy", "asset-allocation", "index-valuation", "policy-tracking"],
  },
  {
    name: "run-fpa",
    description:
      "【企业财务】财务部与FP&A:管理报表、13周滚动现金流预测、预算差异分析、情景与盈亏平衡、投入决策测算、上市同业对标",
    descriptionEn:
      "Corporate finance and FP&A: management reporting off a closed ledger, rolling cash-flow forecasts, budget-versus-actual variance analysis, scenario and break-even analysis, and peer benchmarking against listed comparables",
    version: "0.1.1",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/business-analysis/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/run-fpa/0.1.1/plugin.zip",
    sha256: "fb4f384ff9f17cbc7432ca08733f668ae693377c4d6051176fcb69de08c5c60c",
    keywords: ["fpa", "corporate-finance", "budgeting", "cash-forecast", "management-reporting"],
  },
  {
    name: "vet-companies",
    description: "【一级市场与银行】企业排查:尽调报告、关联方与供应链图谱、失信涉诉质押风险快扫",
    descriptionEn:
      "Counterparty and company due diligence: structured DD reports, related-party and supply-chain mapping, and risk scans (litigation, dishonesty records, pledges, penalties) for Chinese enterprises",
    version: "0.1.2",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/corporate-due-diligence/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/vet-companies/0.1.2/plugin.zip",
    sha256: "345b82432863480ba0c9300c957426e4da4c5d4c82d8135bfd36ef6035239bcb",
    keywords: ["due-diligence", "kyc", "risk-screening", "related-parties", "counterparty"],
  },
  {
    name: "watch-positions",
    description: "【二级市场】持仓跟踪:自选股清单、带异动归因的盘后复盘、持仓事件分级提醒",
    descriptionEn:
      "Watchlist and portfolio monitoring: after-close recaps, position event alerts (announcements, pledges, lockup expiries), and intraday move attribution for A/H/US names",
    version: "0.1.1",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/portfolio-tracking/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/watch-positions/0.1.1/plugin.zip",
    sha256: "88ad5f72d182380b9b37225ba9773781f6f0a239e7edfa01a490c275e0c6cae6",
    keywords: ["portfolio-monitoring", "watchlist", "market-recap", "event-alerts", "attribution"],
  },
  {
    name: "write-research",
    description: "【二级市场】研究产出:深度研报、行业分析、财报点评、DCF/LBO/三表估值模型",
    descriptionEn: "End-to-end investment research reports, sector analysis, earnings updates, and valuation models",
    version: "0.1.1",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/equity-research/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/write-research/0.1.1/plugin.zip",
    sha256: "1637f24728302dab0821023cb0fa8c5f096047f053ccccefa4d7775404dbc9a0",
    keywords: ["equity-research", "valuation", "dcf", "lbo", "earnings"],
  },
  {
    name: "gitlab",
    description: "基于官方 GitLab CLI 的 Merge Request、Issue、CI/CD、仓库、Release 与 API 工作流。",
    descriptionEn:
      "GitLab CLI workflows based on GitLab's official Agent Skills for merge requests, issues, CI/CD, repositories, releases, and API operations.",
    version: "0.1.3",
    author: "Z.ai",
    category: "developer-tools",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/gitlab/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/gitlab/0.1.3/plugin.zip",
    sha256: "398816e8782b1aa40b8f1f920805242c3a8688764c3073ef4576f0ae1d602c8a",
    keywords: ["gitlab", "glab", "merge-request", "issue", "ci-cd", "gitlab-api"],
  },
  {
    name: "alibaba-cloud-cli",
    description: "阿里云 CLI 工作流：配置凭证与 profile，并安全执行云资源查询和操作。",
    descriptionEn:
      "Alibaba Cloud CLI workflows for credential setup, profile checks, and safe cloud resource operations.",
    version: "0.1.2",
    author: "Z.ai",
    category: "developer-tools",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/alibaba-cloud-cli/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/alibaba-cloud-cli/0.1.2/plugin.zip",
    sha256: "b0fb2362da466315a4f24c1910b6b40e27202e9c52226b3fb08f48b47122fb49",
    keywords: ["alibaba-cloud", "aliyun", "aliyun-cli", "cloud", "ecs", "oss", "ram"],
  },
  {
    name: "lark-cli",
    description: "Lark CLI 工作流：覆盖文档、表格、多维表格、日历、消息等 SaaS 资源，并引导应用配置与 OAuth 登录。",
    descriptionEn:
      "Lark CLI workflows for docs, sheets, Base, calendar, messaging, and other SaaS resources with guided setup and OAuth login.",
    version: "0.1.2",
    author: "Z.ai",
    category: "productivity",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/lark-cli/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/lark-cli/0.1.2/plugin.zip",
    sha256: "b53747950cf99c93da69ef72e481bff0090ab6f132c96db393053fbc282fe487",
    keywords: ["feishu", "lark", "lark-cli", "docs", "sheets", "base", "calendar", "messaging"],
  },
  {
    name: "tencent-meeting-cli",
    description: "腾讯会议 CLI 工作流：OAuth2 授权、会议管理、录制管理和参会报告查询。",
    descriptionEn:
      "Tencent Meeting CLI workflows with OAuth2 setup, meeting management, recordings, and attendee reports.",
    version: "0.1.3",
    author: "Z.ai",
    category: "productivity",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/tencent-meeting-cli/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/tencent-meeting-cli/0.1.3/plugin.zip",
    sha256: "a4516d203a5ccf9a22319d41700995d7952ad1d56f8cc64a08e371fc61047af8",
    keywords: ["tencent-meeting", "tencentmeeting", "meeting", "cli", "oauth2"],
  },
  {
    name: "dingtalk-cli",
    description: "钉钉 Workspace CLI 工作流：OAuth/设备授权、验证组织账号，并按需安装上游 Skills。",
    descriptionEn:
      "DingTalk Workspace CLI workflows with OAuth/device authorization, profile checks, and optional upstream Skills.",
    version: "0.1.1",
    author: "Z.ai",
    category: "productivity",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/dingtalk-cli/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/dingtalk-cli/0.1.1/plugin.zip",
    sha256: "ea35300430e9bacadfe1857a865c041ca72b149e9ae06b20ec78cbec9f5fa948",
    keywords: ["dingtalk", "dws", "workspace", "chat", "docs", "calendar", "tasks"],
  },
  {
    name: "wecom-cli",
    description:
      "企业微信 CLI 工作流：覆盖消息、文档、表格、邮件、日历、会议、通讯录和待办，并支持扫码授权与状态检查。",
    descriptionEn:
      "WeCom CLI workflows for messages, docs, sheets, mail, calendar, meetings, contacts, and todos with QR authentication.",
    version: "0.1.1",
    author: "Z.ai",
    category: "productivity",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/wecom-cli/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/wecom-cli/0.1.1/plugin.zip",
    sha256: "2d9b192856b0769ff66322baa168090855347ad82c57493b2a42c7c5b18329c5",
    keywords: ["wecom", "wechat-work", "wecom-cli", "message", "docs", "sheets", "calendar", "todo"],
  },
  {
    name: "hexin",
    description: "同花顺股票、海外股票、指数、基金与债券数据 MCP 服务。",
    descriptionEn: "MCP services for RoyalFlush iFinD stock, global stock, index, fund, and bond data.",
    version: "0.1.0",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/hexin/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/hexin/0.1.0/plugin.zip",
    sha256: "dc3431e8e13d5396424f5d997786e377e3b5c2ecff6946a6e4fb34bfdb02416a",
    keywords: ["hexin", "finance", "mcp"],
  },
  {
    name: "wind",
    description: "万得股票、海外股票、指数、基金、债券、宏观经济与公告研报数据 MCP 服务。",
    descriptionEn: "MCP services for Wind stock, global stock, index, fund, bond, economic, and document data.",
    version: "0.1.0",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/wind/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/wind/0.1.0/plugin.zip",
    sha256: "10ee09ffc1647c5987c917947fc6aca4a150b467135dd18793ef76ad13d2a772",
    keywords: ["wind", "finance", "mcp"],
  },
  {
    name: "tianyancha",
    description: "天眼查企业信息查询 MCP 服务。",
    descriptionEn: "MCP service for Tianyancha company information queries.",
    version: "0.1.0",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/tianyancha/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/tianyancha/0.1.0/plugin.zip",
    sha256: "e2072ff3740babd313a358a21422af6354ea4cb1c1a9eb6aa3255a0c28109c53",
    keywords: ["tianyancha", "finance", "mcp"],
  },
  {
    name: "finance-search",
    description: "SEC EDGAR 文件检索与财经网页、新闻搜索 MCP 服务。",
    descriptionEn: "MCP services for SEC EDGAR filing search and financial web and news search.",
    version: "0.1.0",
    author: "Z.ai",
    category: "finance",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/finance-search/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/finance-search/0.1.0/plugin.zip",
    sha256: "78ef8ffaf5c24bdb203108aeddc66176735cb914e2e802b5ff9d28e465e923a2",
    keywords: ["finance-search", "finance", "mcp"],
  },
  {
    name: "obsidian",
    description:
      "来自 kepano/obsidian-skills 的 Obsidian 创作技能：Obsidian 风格 Markdown 笔记、Bases 数据库视图、JSON Canvas 白板、Obsidian CLI 库操作、Defuddle 网页正文提取、Knap 模板批量生成笔记；并集成 axtonliu/axton-obsidian-visual-skills 的可视化技能：Mermaid/Excalidraw 图表生成与文本转画布布局。附 setup 技能，检测并安装 Obsidian CLI、defuddle 与 knap。",
    descriptionEn:
      "Obsidian authoring skills from kepano/obsidian-skills: Obsidian Flavored Markdown notes, Bases database views, JSON Canvas boards, vault automation via Obsidian CLI, clean web extraction with Defuddle, and Knap template rendering — plus visualization skills from axtonliu/axton-obsidian-visual-skills: Mermaid and Excalidraw diagram generation and text-to-canvas layout. A setup skill verifies and installs the Obsidian CLI, defuddle, and knap.",
    version: "0.1.2",
    author: "Z.ai",
    category: "productivity",
    icon: "https://cdn-zcode.z.ai/zcode/official-plugin/assets/obsidian/icon.png",
    url: "https://cdn-zcode.z.ai/zcode/official-plugin/plugins/obsidian/0.1.2/plugin.zip",
    sha256: "16ce018f2249ba4f6f4ff838dd964f0bfcdcd730118cca49242259e39eb60a3f",
    keywords: [
      "obsidian",
      "markdown",
      "bases",
      "canvas",
      "notes",
      "defuddle",
      "knap",
      "mermaid",
      "excalidraw",
      "visualization",
    ],
  },
]

// ---------------------------------------------------------------------------
// Claude 官方插件市场（anthropics/claude-plugins-official）
// ---------------------------------------------------------------------------

/**
 * Claude 市场用 git 仓库分发（整仓 / 子目录 / git-url），没有 zip。
 * 安装走主进程的浅克隆，装完把 skills / MCP / commands / agents 一并接上，
 * 所以这里只需要把条目归一化成「从哪克隆、克隆后取哪个子目录」。
 */
// raw.githubusercontent.com 在国内常被重置；jsDelivr 与 ghproxy 都能稳定取到。
// 按顺序尝试，第一个成功的即为目录来源。
export const CLAUDE_MARKETPLACE_URLS = [
  "https://cdn.jsdelivr.net/gh/anthropics/claude-plugins-official@main/.claude-plugin/marketplace.json",
  "https://ghproxy.net/https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
] as const
export const CLAUDE_MARKETPLACE_URL = CLAUDE_MARKETPLACE_URLS[0]
export const CLAUDE_MARKETPLACE_REPO = "https://github.com/anthropics/claude-plugins-official.git"

export type ClaudeMarketplaceEntry = {
  name: string
  displayName: string
  description: string
  author?: string
  category?: string
  /** 克隆来源。`subdir` 为空表示整仓就是插件根。 */
  gitUrl: string
  gitRef?: string
  subdir?: string
}

/**
 * 解析 Claude marketplace.json。
 *
 * `source` 有三种形态：
 * - `"./plugins/x"`：相对于市场仓库自身的子目录；
 * - `{ source: "git-subdir", url, path, ref }`：外部仓库的子目录；
 * - `{ source: "url", url, ref }` / 字符串 URL：整仓。
 */
export function parseClaudeMarketplace(value: unknown): ClaudeMarketplaceEntry[] {
  if (typeof value !== "object" || value === null) return []
  const record = value as { plugins?: unknown }
  if (!Array.isArray(record.plugins)) return []
  const entries: ClaudeMarketplaceEntry[] = []
  const seen = new Set<string>()
  for (const item of record.plugins) {
    if (typeof item !== "object" || item === null) continue
    const raw = item as Record<string, unknown>
    const name = asText(raw.name)
    if (!name || seen.has(name)) continue
    const source = raw.source
    let gitUrl: string | undefined
    let gitRef: string | undefined
    let subdir: string | undefined
    if (typeof source === "string") {
      if (/^https?:|^git@/.test(source)) gitUrl = source
      else {
        gitUrl = CLAUDE_MARKETPLACE_REPO
        subdir = source.replace(/^\.\//, "")
      }
    } else if (typeof source === "object" && source !== null) {
      const src = source as Record<string, unknown>
      gitUrl = asText(src.url)
      gitRef = asText(src.ref)
      subdir = asText(src.path)
    }
    if (!gitUrl) continue
    seen.add(name)
    const author =
      typeof raw.author === "object" && raw.author !== null ? (raw.author as Record<string, unknown>) : undefined
    entries.push({
      name,
      displayName: asText(raw.displayName) ?? name,
      description: asText(raw.description) ?? "",
      author: asText(author?.name) ?? asText(raw.author),
      category: asText(raw.category),
      gitUrl,
      gitRef,
      subdir,
    })
  }
  return entries
}
