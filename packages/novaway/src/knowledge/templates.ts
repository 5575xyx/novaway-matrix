/**
 * 知识库集合模板。
 *
 * 新建集合时可以直接选一个模板：预置名称、描述、以及几条**示例评测用例**，
 * 让用户导入自己的资料后立刻有"该长什么样"的参照。
 *
 * 示例用例的 expected 用占位符（`__first__` 等），在创建时按实际文档替换；
 * 没有对应文档的用例会被跳过，不会写进列表。
 */
export type CollectionTemplate = {
  id: string
  name: string
  description: string
  icon: "review" | "code-lines" | "table" | "chart" | "brain"
  /** 建议的集合描述，创建时写入。 */
  hint: string
  /** 示例用例：query 里的 {{doc}} 会被替换成实际文档标题。 */
  examples: Array<{ query: string; hint: string }>
  /** 可选示例文档：勾选「附带示例」时写入，帮用户先看到检索效果。 */
  sample: { title: string; content: string }
}

export const COLLECTION_TEMPLATES: CollectionTemplate[] = [
  {
    id: "product",
    name: "产品文档",
    description: "PRD、需求说明、交互与接口约定",
    icon: "review",
    hint: "放产品需求、功能说明、接口约定，AI 回答功能问题时据此引用。",
    examples: [
      { query: "{{doc}} 的核心流程是什么", hint: "面向流程类问题" },
      { query: "{{doc}} 有哪些限制", hint: "面向约束/边界类问题" },
    ],
    sample: {
      title: "示例 · 需求说明模板",
      content: [
        "# 需求说明模板",
        "",
        "## 背景",
        "说明为什么要做这件事，以及不做会有什么问题。",
        "",
        "## 目标",
        "- 用户能完成的核心任务",
        "- 可衡量的成功标准",
        "",
        "## 核心流程",
        "1. 用户进入入口",
        "2. 填写必要信息",
        "3. 系统校验并保存",
        "4. 给出明确的结果反馈",
        "",
        "## 限制与边界",
        "- 单次最多处理 50 条",
        "- 不支持离线编辑",
        "- 权限不足时给出可执行的提示",
      ].join(String.fromCharCode(10)),
    },
  },
  {
    id: "runbook",
    name: "运维手册",
    description: "部署、回滚、告警处理与值班流程",
    icon: "code-lines",
    hint: "放部署步骤、回滚方案、告警处置，线上出问题时优先检索这里。",
    examples: [
      { query: "{{doc}} 怎么回滚", hint: "回滚路径" },
      { query: "{{doc}} 失败时怎么排查", hint: "故障排查" },
    ],
    sample: {
      title: "示例 · 服务部署手册",
      content: [
        "# 服务部署手册",
        "",
        "## 前置检查",
        "- 确认发布分支已通过 CI",
        "- 确认数据库迁移已评审",
        "",
        "## 部署步骤",
        "1. 拉取镜像并校验版本号",
        "2. 先灰度 10% 流量",
        "3. 观察错误率与延迟 10 分钟",
        "4. 全量发布",
        "",
        "## 回滚",
        "1. 将流量切回上一个稳定版本",
        "2. 确认错误率恢复",
        "3. 记录回滚原因与影响范围",
        "",
        "## 失败排查",
        "- 启动失败：先看健康检查日志",
        "- 5xx 上升：检查下游依赖与连接池",
        "- 延迟升高：检查慢查询与 GC",
      ].join(String.fromCharCode(10)),
    },
  },
  {
    id: "faq",
    name: "客服 FAQ",
    description: "常见问题、话术与退款政策",
    icon: "brain",
    hint: "放常见问答与政策条款，客服机器人回答用户问题时引用。",
    examples: [
      { query: "{{doc}} 怎么说", hint: "话术类问题" },
      { query: "关于 {{doc}} 用户最常见的疑问", hint: "FAQ 类问题" },
    ],
    sample: {
      title: "示例 · 退款政策问答",
      content: [
        "# 退款政策问答",
        "",
        "## 未发货可以退款吗？",
        "可以。在订单详情页点击「申请退款」，通常 1 个工作日内原路退回。",
        "",
        "## 已发货可以退款吗？",
        "商品签收后 7 天内支持无理由退款，需保持商品完好。",
        "",
        "## 退款多久到账？",
        "原路退回，银行卡 1-3 个工作日，第三方支付 1-7 个工作日。",
        "",
        "## 客服话术",
        "「您好，您的退款申请已受理，预计 1-3 个工作日原路退回，请留意到账通知。」",
      ].join(String.fromCharCode(10)),
    },
  },
  {
    id: "data",
    name: "数据字典",
    description: "表结构、指标定义与口径说明",
    icon: "table",
    hint: "放表结构、指标口径、字段含义，写查询时先在这里确认定义。",
    examples: [
      { query: "{{doc}} 的口径是什么", hint: "指标口径" },
      { query: "{{doc}} 包含哪些字段", hint: "字段说明" },
    ],
    sample: {
      title: "示例 · 核心指标口径",
      content: [
        "# 核心指标口径",
        "",
        "## 活跃用户（DAU）",
        "统计自然日内有任意一次有效请求的去重用户数，剔除内部账号与压测流量。",
        "",
        "## 付费转化率",
        "支付成功用户数 / 当日活跃用户数，按自然日统计，不含退款回冲。",
        "",
        "## 表结构示例",
        "| 字段 | 类型 | 说明 |",
        "| --- | --- | --- |",
        "| user_id | string | 用户唯一标识 |",
        "| event_time | timestamp | 事件时间，UTC |",
        "| amount | decimal | 支付金额，单位元 |",
      ].join(String.fromCharCode(10)),
    },
  },
  {
    id: "research",
    name: "调研资料",
    description: "竞品分析、访谈记录与结论摘要",
    icon: "chart",
    hint: "放调研报告与访谈记录，写方案时用来回溯依据。",
    examples: [
      { query: "{{doc}} 的主要结论", hint: "结论检索" },
      { query: "{{doc}} 提到了哪些竞品", hint: "竞品检索" },
    ],
    sample: {
      title: "示例 · 竞品调研摘要",
      content: [
        "# 竞品调研摘要",
        "",
        "## 调研范围",
        "覆盖 3 个直接竞品与 2 个替代方案，访谈 8 位用户。",
        "",
        "## 主要结论",
        "- 用户最在意的是导入速度与检索准确率",
        "- 价格敏感度低于预期，稳定性权重更高",
        "- 团队协作是明显空白点",
        "",
        "## 竞品对比",
        "| 竞品 | 优势 | 短板 |",
        "| --- | --- | --- |",
        "| 竞品 A | 文档解析强 | 价格高 |",
        "| 竞品 B | 上手快 | 不支持中文 |",
        "| 竞品 C | 协作完善 | 导入慢 |",
      ].join(String.fromCharCode(10)),
    },
  },
]

export function findTemplate(id: string | undefined) {
  if (!id) return
  return COLLECTION_TEMPLATES.find((item) => item.id === id)
}

/**
 * 把模板的示例用例落到真实文档上。
 * 文档不足时返回空数组 —— 宁可不生成，也不要写入指向不存在文档的用例。
 */
export function templateCases(template: CollectionTemplate, documents: readonly { id: string; title: string }[]) {
  const result: Array<{ query: string; expected: string[]; notes: string }> = []
  for (const [index, document] of documents.slice(0, 3).entries()) {
    for (const example of template.examples) {
      result.push({
        query: example.query.replace(/\{\{doc\}\}/g, document.title),
        expected: [document.id],
        notes: template.name + " · " + example.hint + (index > 0 ? " #" + (index + 1) : ""),
      })
    }
  }
  return result
}
