## 1 2026-07-24T10:21:13.067Z

可以。我已经根据截图中的会话 ID 找回了上一轮对比内容，并结合**当前工作区代码**及 **2026 年 7 月 24 日**的 GitHub 项目状态重新核对了一遍。

这次不只是复述旧结论：你们的代码在上一轮之后已经增加了范围分类、中文召回、进化写盘、预览、事件刷新等能力，因此结论也需要更新。

---

# 一、重新选择的对比项目

GitHub Star 只是截至 **2026 年 7 月 24 日**的热度快照，会随时间变化。

| 项目             |      当前热度 | 核心定位                                      |
| ---------------- | ------------: | --------------------------------------------- |
| **Hermes Agent** | 约 21.9 万 ⭐ | 具备记忆、技能创建和持续改进能力的完整 Agent  |
| **Mem0**         | 约 6.29 万 ⭐ | 通用 Agent 长期记忆基础设施                   |
| **Graphiti**     | 约 2.91 万 ⭐ | 双时态知识图谱与混合记忆检索                  |
| **Supermemory**  | 约 1.87 万 ⭐ | 多模态、时序化、可处理矛盾的记忆 API          |
| **Letta Code**   |    约 2900 ⭐ | 面向编程 Agent 的持久记忆、技能和自我改进系统 |

Hermes 的热度和功能闭环最接近“越用越会做事”的目标；Mem0、Graphiti 和 Supermemory 更偏记忆引擎。citeturn0view0turn1view0turn2view0turn3view0

Letta 当前主要开发已经转向 Letta Code，其定位和 NovaWay 最接近：都是编程 Agent，都强调跨会话记忆、技能和持续改进。citeturn4view0

这次不再把 Zep 单独列为一项，因为 Graphiti 本身就是 Zep 生态中主要的开源记忆引擎，分别评分容易重复计算。

---

# 二、NovaWay 当前已经实现到什么程度

以下结论基于**当前工作区，包括尚未提交的修改**。

## 1. 记忆存储与范围

目前已经支持：

- 全局记忆 `global`
- 项目记忆 `project`
- 会话记忆 `session`
- 用户画像 `target=user`
- 项目/普通记忆 `target=memory`
- 标签、摘要、重要性、来源消息、创建者
- 归档、删除、更新
- SQLite 权威存储
- 可选 Markdown 文件镜像

对应实现：

- `packages/opencode/src/memory/schema.ts`
- `packages/opencode/src/memory/memory.sql.ts`
- `packages/opencode/src/memory/service.ts:391-455`
- `packages/opencode/src/memory/scope.ts`

范围自动分类也已经加入：

- 用户偏好默认归入全局
- 项目规范默认归入项目
- 可通过“仅本会话”“全局”“本项目”等措辞强制指定

这部分已经是比较完整的产品级数据模型。

---

## 2. 自动学习链路

目前有三条写入路径：

### 显式记忆

识别：

- “请记住……”
- “我的偏好是……”
- “从现在起……”
- `remember that...`

然后直接写入记忆。

实现：

- `packages/opencode/src/memory/service.ts:213-228`
- `packages/opencode/src/memory/service.ts:473-488`

### 每轮 LLM 审查

对用户和助手本轮内容调用结构化 LLM，最多提取三条：

- 用户偏好
- 项目约定
- 长期目标
- 稳定事实
- 失败经验

默认配置下，候选会自动应用到长期记忆。

实现：

- `packages/opencode/src/session/prompt.ts:1753-1838`
- `packages/opencode/src/session/prompt.ts:2230-2270`

### 压缩与会话结束钩子

Compaction 和会话结束时也会触发记忆审查候选。

实现：

- `packages/opencode/src/session/compaction.ts:412-424`
- `packages/opencode/src/session/session.ts:555-584`
- `packages/opencode/src/memory/service.ts:609-693`

不过这里需要注意：

> 每轮审查是真正的 LLM 语义提炼；当前压缩和会话结束服务主要仍依赖显式记忆模式，不是完整的“全会话 LLM 反思总结”。

---

## 3. 记忆召回

目前召回链路包括：

- 寒暄、短确认、斜杠命令跳过记忆
- 中文连续文本二元分词
- 内容、摘要、标签关键词命中
- 重要性加权
- 全局用户画像加权
- 全局用户画像保底槽位
- 默认最多 5 条
- 默认最多 1200 字符
- 只向模型注入摘要索引
- 需要全文时由模型调用 `memory` 工具进一步搜索

实现：

- `packages/opencode/src/memory/prefetch.ts`
- `packages/opencode/src/memory/context.ts`
- `packages/opencode/src/memory/service.ts:457-470`
- `packages/opencode/src/tool/memory.ts`
- `packages/opencode/src/session/prompt.ts:2146-2177`

相比上一轮对比，这部分已经明显改善，尤其是：

- 中文查询不再完全依赖空格分词
- 全局用户画像有保底召回
- Token 预算更加明确
- 不再每轮全量注入长期记忆

但它本质上仍然是：

> **规则门控 + 字面关键词匹配 + 重要性排序**

目前没有：

- Embedding
- 向量索引
- FTS5/BM25
- 混合检索
- 交叉编码器重排
- 实体关系检索

---

## 4. 自我进化

当前进化候选支持：

- `skill`
- `agent`
- `workflow`
- `prompt`
- `tool`
- `project`

并且已经具备：

- 每 N 轮自动生成候选
- 会话结束候选
- 全局/项目范围判断
- 编辑候选
- 内容预览
- 文件级 dry-run
- Unified Diff
- Patch 上下文校验
- 应用到磁盘
- 驳回
- 应用状态与来源统计

实现：

- `packages/opencode/src/evolution/schema.ts`
- `packages/opencode/src/evolution/service.ts`
- `packages/opencode/src/session/prompt.ts:1841-1939`
- `packages/opencode/src/session/prompt.ts:2273-2302`

写盘目录包括：

```text
全局：
~/.config/novaway/skills/
~/.config/novaway/agents/
~/.config/novaway/workflows/
...

项目：
<项目>/.novaway/skills/
<项目>/.novaway/agents/
<项目>/.novaway/workflows/
...
```

其中：

- `skill` 写入了技能加载器能发现的目录
- `agent` 写入了 Agent 配置加载器能发现的目录
- `workflow`、`prompt`、`project` 当前更接近知识文档
- `tool` 当前写入 Markdown，但 NovaWay 的真正自定义工具通常需要 TypeScript 文件

因此进化闭环现在是：

> **发现经验 → 生成候选 → 人工审查 → dry-run → 写入文件**

但还没有完全达到：

> **写入 → 自动加载 → 执行验证 → 统计效果 → 根据效果继续改进或回滚**

---

## 5. 产品与管理闭环

这是 NovaWay 当前很明显的优势：

- 统一“记忆与进化”设置页
- 待审、已应用、已驳回状态
- 来源统计
- 全局/项目范围筛选
- 右上角会话指示器
- SSE 事件刷新
- HTTP API
- 生成的 JavaScript SDK
- CLI 管理命令
- 预览、编辑和 dry-run

主要文件：

- `packages/app/src/components/settings-memory-evolution.tsx`
- `packages/app/src/components/memory-evolution-panel.tsx`
- `packages/app/src/context/global-sync/memory-evolution-events.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/memory.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/evolution.ts`
- `packages/opencode/src/cli/cmd/memory.ts`

很多开源记忆引擎算法很强，但并没有你们这样完整的桌面产品管理链路。

---

# 三、六个项目横向比较

下面的 1～5 分是针对“编程 Agent 记忆与进化”的架构适配评估，**不是官方 Benchmark**。

| 能力维度           | NovaWay | Hermes | Mem0 | Graphiti | Supermemory | Letta Code |
| ------------------ | :-----: | :----: | :--: | :------: | :---------: | :--------: |
| 自动记忆提炼       |    4    |   5    |  4   |    4     |      5      |     4      |
| 记忆检索深度       |    2    |   4    |  5   |    5     |      5      |     4      |
| 中文基础召回       |    3    |   3    |  4   |    4     |      4      |     3      |
| 时序与矛盾处理     |    2    |   3    | 3.5  |    5     |      5      |     4      |
| 用户/项目/会话分层 |    4    |   4    |  5   |    4     |      5      |     5      |
| 技能自我进化       |    3    |   5    |  1   |    1     |      1      |     5      |
| 进化版本与回滚     |   2.5   |   3    |  1   |    1     |      1      |     5      |
| 人工审查与可控性   |    5    |   3    |  3   |    2     |      4      |     4      |
| 编程项目感知       |    5    |   5    |  3   |    2     |      4      |     5      |
| 本地优先           |    5    |   5    |  4   |    3     |      3      |     5      |
| UI/API/CLI 完整度  |    5    |   4    |  5   |    3     |      5      |     4      |
| 公开记忆评测       |    2    |   3    |  5   |    5     |      4      |     3      |

## 简要结论

### NovaWay

强在：

- 编程项目感知
- 产品内闭环
- 人工审查
- 本地存储
- 范围管理
- Token 控制
- 进化文件预览与写盘

弱在：

- 语义检索
- 记忆生命周期
- 时序事实
- 进化效果验证
- 公开质量评测

### Hermes Agent

Hermes 当前最接近真正的“越用越会做事”：

- 四层记忆
- FTS5 跨会话搜索
- 自动写入提示
- Agent 可创建和持续修改 Skill
- Skill 可在后续任务中自动匹配和调用

因此 Hermes 的优势不只是“记住事实”，而是把经验转化为后续可复用的操作能力。citeturn0view0

### Mem0

Mem0 强在：

- User、Agent、Session、App 等命名空间
- 语义搜索
- 图记忆
- 实体链接
- 时序理解
- 公开 Benchmark 与性能数据

一个重要更新是：Mem0 最新 README 说明其从 **2026 年 4 月**开始采用 **ADD-only** 记忆模式，新事实不会直接覆盖或删除旧事实，而由检索阶段处理时间语义。这意味着上一轮“Mem0 自动 UPDATE/DELETE 旧记忆”的概括现在已经不准确。citeturn1view0

### Graphiti

Graphiti 在“事实会发生变化”方面最强：

- Episode
- 实体与关系
- 有效时间
- 写入时间
- 双时态查询
- 语义、BM25、图遍历混合检索
- 不需要每次全图重算

如果 NovaWay 需要正确处理：

> “项目以前使用 pnpm，但从本月起改为 Bun。”

Graphiti 的数据模型最值得借鉴。citeturn3view0

### Supermemory

Supermemory 强调：

- 多模态内容
- 自动知识抽取
- 混合检索
- 矛盾信息处理
- 记忆过期
- 用户画像
- MCP 和 OAuth 集成

其 README 还公布了 LongMemEval、LoCoMo 等评测结果，不过这些数字属于项目方自报，适合参考，不应当作独立第三方结论。citeturn2view0

### Letta Code

Letta Code 与 NovaWay 的目标最接近：

- 本地 Markdown 记忆
- Git 版本控制
- 自动更新记忆
- 持久 Agent 身份
- Skill 与共享记忆
- Subagent
- 跨会话继续学习

尤其值得借鉴的是 MemFS：

> 记忆是文件，文件有 Git 历史，Agent 能更新，而且用户可以检查和回滚。

这比单纯的数据库 `archived` 字段更适合“自我进化”的可审计需求。citeturn4view0

---

# 四、和上一轮对比相比，NovaWay 已经进步的部分

上一轮我给出的主要建议是：

1. 改善中文和按需召回
2. 增加全局用户画像
3. 增加学习可观测性
4. 让进化候选真正写入 Skill
5. 完善全局/项目范围
6. 加入 dry-run 与文件应用

目前第 1～6 项已经有不同程度的实现：

| 上一轮建议         | 当前状态                             |
| ------------------ | ------------------------------------ |
| 中文召回           | 已增加 CJK 二元分词                  |
| 用户画像保底       | 已增加全局用户记忆槽位               |
| Token 预算         | 已有门控、条数和字符预算             |
| 范围分类           | 已有 global/project/session 自动分类 |
| 学习可观测         | 已有指标、状态、来源、事件刷新       |
| 进化写盘           | 已有 Skill/Agent 等目录写入          |
| 候选编辑           | 已实现                               |
| 文件预览           | 已实现                               |
| Dry-run            | 已实现                               |
| Unified Diff       | 已实现                               |
| Patch 失败保持待审 | 已实现                               |

因此，当前 NovaWay 已经不再是简单的“记忆功能原型”，而是：

> **具备产品级管理闭环的编程 Agent 记忆与进化系统。**

---

# 五、当前最关键的真实差距

## P0：混合检索

当前最大短板仍然是召回质量。

建议架构：

```text
查询
 ├─ CJK/关键词召回
 ├─ SQLite FTS5/BM25 召回
 ├─ Embedding 向量召回
 └─ 范围与重要性加权
        ↓
      RRF 融合
        ↓
   去重与字符预算
```

不建议直接删除当前关键词实现，而是把它作为混合检索的一路。

---

## P0：记忆生命周期

当前有手工归档，但没有自动识别：

- 新事实是否与旧事实冲突
- 旧事实是否失效
- 新事实是补充还是替代
- 同一事实出现多次是否提高置信度

建议增加：

```text
fact_key
confidence
valid_from
valid_to
supersedes_id
last_confirmed_at
version
```

记忆提炼结果不应只有“候选内容”，还应包含：

```ts
operation: "add" | "update" | "archive" | "confirm"
```

---

## P0：进化执行闭环

目前“写盘”已经存在，但还差：

```text
候选生成
  → dry-run
  → 写入临时目录
  → 加载校验
  → lint/typecheck/test
  → 运行任务验证
  → 成功后发布
  → 热刷新 Skill/Agent
  → 记录成功率
  → 失败自动回滚
```

尤其要补：

- Skill 写入后的热刷新
- Agent 配置合法性检查
- Workflow/Prompt/Tool 的真实运行时消费路径
- Tool 候选生成可执行 `.ts`，而不是只写 `.md`
- 进化前后效果比较
- Git 或数据库版本回滚

---

## P1：会话级反思

当前每轮有 LLM 提炼，但会话结束和压缩阶段还不够深入。

建议会话结束时生成三类结果：

1. **事实记忆**：用户和项目的新事实
2. **Episode 摘要**：这次任务做了什么、结果如何
3. **经验候选**：哪些方法可以沉淀为 Skill/Workflow

这样才是真正的：

> 经历一次任务，积累一次经验。

---

## P1：质量评测

当前单元测试主要验证：

- CRUD
- 状态流转
- 范围分类
- 召回门控
- 文件应用
- Patch
- API/UI 逻辑

这些能证明功能正确，但不能证明“记得准”。

建议建立最少 50～100 条本地评测：

- 偏好保持
- 项目约定召回
- 中文同义表达召回
- 改口后的事实更新
- 全局记忆不污染项目
- 项目 A 不污染项目 B
- 无关记忆不注入
- 长会话压缩后仍能回忆
- 错误经验不重复采用
- Skill 应用后任务成功率提高

指标建议：

```text
Recall@5
Precision@5
MRR
无关注入率
冲突事实正确率
Token 消耗
候选接受率
进化后任务成功率
```

---

# 六、最终定位判断

NovaWay 不应该复制成第二个 Mem0 或 Graphiti。

最适合的定位是：

> **面向编程 Agent 的项目感知型记忆与技能进化系统：本地优先、范围明确、人工可审、能够将成功经验沉淀成真正可执行的 Skill。**

可以组合借鉴：

| 借鉴对象         | 借鉴内容                                  |
| ---------------- | ----------------------------------------- |
| Hermes           | Skill 创建、使用、反馈、再改进闭环        |
| Mem0             | 记忆抽取协议、命名空间、检索评测          |
| Graphiti         | 双时态事实和冲突生命周期                  |
| Supermemory      | 混合检索、矛盾处理、用户画像              |
| Letta Code       | 文件化记忆、Git 版本、自动更新与回滚      |
| NovaWay 自身保留 | UI、项目范围、人工审查、dry-run、桌面集成 |

---

# 最终结论

和上一轮相比，NovaWay 已经从：

> **能记、能提候选、能显示**

提升到了：

> **能自动学习、按范围存储、按需召回、人工审查、编辑预览、生成补丁并写入 Skill/Agent 文件。**

但还不能说已经达到头部项目的完整水平，主要还差三件事：

1. **FTS5 + Embedding 混合检索**
2. **冲突、时序、替代、版本化的记忆生命周期**
3. **进化写盘后的自动验证、热加载、效果评估和回滚**

所以目前最准确的评价是：

> **NovaWay 的产品闭环和 Coding Agent 集成已经领先许多通用记忆项目；但底层记忆检索、时序管理和可验证自进化仍落后于各领域头部方案。**

本轮只进行了代码和公开项目的重新分析，没有修改工作区文件，也没有运行测试。

## 7 2026-07-25T04:59:34.949Z

已按**全能 Agent**定位继续完善，核心能力已落地并通过定向测试。

## 本次落地

### 1. 领域无关记忆

- 新增 `domain`：`general / coding / office / personal / research / ops`
- 范围默认改为：无项目约定信号时走 **global**，不再默认绑仓库
- 相关：[`packages/opencode/src/memory/domain.ts`](packages/opencode/src/memory/domain.ts)、[`packages/opencode/src/memory/scope.ts`](packages/opencode/src/memory/scope.ts)

### 2. 记忆生命周期（冲突可替代）

- 字段：`fact_key`、`confidence`、`version`、`supersedes_id`、`valid_from/valid_to`、`last_confirmed_at`
- 操作：`add / update / archive / confirm`
- 同 `factKey` 更新会归档旧事实并写新版本（如 pnpm → bun）
- 迁移：[`packages/opencode/migration/20260725090000_memory_lifecycle_fts/migration.sql`](packages/opencode/migration/20260725090000_memory_lifecycle_fts/migration.sql)

### 3. 混合检索

- SQLite **FTS5 trigram** + 原有关键词/中文 bigram 融合排序
- prefetch 展示领域与置信度
- 相关：[`packages/opencode/src/memory/search.ts`](packages/opencode/src/memory/search.ts)、[`packages/opencode/src/memory/service.ts`](packages/opencode/src/memory/service.ts)

### 4. 进化闭环增强

- 候选增加 `domain`、`validation_status`、`validation_note`
- `applyToDisk` 成功标记 `validated`，失败标记 `failed` 并保留原因

### 5. 自动提炼协议升级

- LLM 候选 schema 支持 `factKey / operation / domain / confidence`
- 审查提示改为全能场景（办公/研究/运维/个人，不限代码）

## 验证

```text
bun test test/memory/ test/evolution/service.test.ts
→ 55 pass, 0 fail
```

## 还没做完的（下一刀）

- 真·向量 embedding 检索
- 进化写盘后的 **Skill 热加载 / 自动校验 / 回滚**
- 设置页展示 domain / 事实版本 / 验证状态
- OpenAPI/SDK 全量再生

如果你要继续，我建议下一步直接做：**设置页可观测字段 + 进化 apply 后 skill 热刷新**。

## 11 2026-07-25T05:19:14.430Z

本轮已继续完成两块：

## 1. 设置页可观测字段

记忆候选 / 已写入记忆 / 右上角面板现在会展示：

- **领域**（通用/编程/办公/个人/研究/运维）
- **操作**（新增/更新/归档/确认）
- **置信度**
- **版本 + factKey + 是否替代旧事实**

进化候选额外展示：

- **领域**
- **验证状态**（待验证/已验证/验证失败）
- **验证说明**（`validationNote`）

涉及：

- [`packages/app/src/components/settings-memory.tsx`](packages/app/src/components/settings-memory.tsx)
- [`packages/app/src/components/settings-evolution.tsx`](packages/app/src/components/settings-evolution.tsx)
- [`packages/app/src/components/memory-evolution-panel.tsx`](packages/app/src/components/memory-evolution-panel.tsx)
- helpers + SDK types + openapi 字段补齐

## 2. 进化写盘后 Skill 热刷新

- 新增 `Skill.reload()`：失效当前实例 skill 缓存并重新扫描
- 发现逻辑改为**始终扫描**当前实例 `.novaway`，避免“首次无目录后写盘发现不了”
- `Evolution.applyToDisk` 对 `kind=skill` 会尝试热刷新，并把结果写入 `validationNote`

涉及：

- [`packages/opencode/src/skill/index.ts`](packages/opencode/src/skill/index.ts)
- [`packages/opencode/src/evolution/service.ts`](packages/opencode/src/evolution/service.ts)

## 验证

```text
settings-memory-evolution.helpers.test.ts  → 7 pass
memory lifecycle/review + evolution suite → 通过
skill reload 用例 → 通过
applyToDisk validation status 用例 → 通过
```

## 仍可继续的下一刀

- Agent 配置写盘后的热加载
- 设置页增加 domain 筛选
- 向量 embedding 混合检索

需要的话我直接接着做 **Agent 热加载 + domain 筛选**。

## 14 2026-07-25T05:34:42.730Z

本轮已完成：

## 1. Agent 热加载

- `Config.invalidate()` 现在会同时失效**实例级配置缓存**（才能重新发现新写入的 agent markdown）
- 新增 `Agent.reload()`：`config.invalidate()` + agent 状态重建
- `Evolution.applyToDisk` 对 `kind=agent` 会尝试热刷新，并写入 `validationNote`

涉及：

- [`packages/opencode/src/config/config.ts`](packages/opencode/src/config/config.ts)
- [`packages/opencode/src/agent/agent.ts`](packages/opencode/src/agent/agent.ts)
- [`packages/opencode/src/evolution/service.ts`](packages/opencode/src/evolution/service.ts)

## 2. 设置页 domain 筛选

记忆页、进化页都加了领域筛选芯片：

- 全部领域 / 通用 / 编程 / 办公 / 个人 / 研究 / 运维
- 显示各领域数量
- 候选与已写入记忆都会按 domain 过滤

涉及：

- [`packages/app/src/components/settings-memory.tsx`](packages/app/src/components/settings-memory.tsx)
- [`packages/app/src/components/settings-evolution.tsx`](packages/app/src/components/settings-evolution.tsx)
- helpers + 测试

## 验证

```text
agent reload rediscovers newly written agents  → pass
skill reload rediscovers newly written skills → pass
applyToDisk validation (skill/agent)          → pass
settings-memory-evolution.helpers.test.ts     → 8 pass
memory factKey supersede                      → pass
```

## 现状小结

| 能力                       | 状态 |
| -------------------------- | ---- |
| 全能领域记忆               | 有   |
| 冲突替代 / 版本            | 有   |
| FTS 混合检索               | 有   |
| Skill 热刷新               | 有   |
| Agent 热刷新               | 有   |
| 设置页可观测 + domain 筛选 | 有   |
| 向量 embedding             | 未做 |
| Workflow/tool 运行时激活   | 未做 |

如果继续，建议下一刀做 **向量混合检索** 或 **workflow/prompt 产物的真实加载路径**。

## 17 2026-07-25T05:51:50.836Z

本轮继续完成了两块高价值能力：

## 1. 本地语义混合检索（无需外部 Embedding API）

新增 [`packages/opencode/src/memory/vector.ts`](packages/opencode/src/memory/vector.ts)：

- 词 token + 字符 n-gram 稀疏向量
- 余弦相似度
- 接入 hybrid 排序：关键词 + FTS5 + **本地语义** + 置信度/时效

效果：

- 同语言近义表达可召回（即使没有精确关键词命中）
- 中文近义句可区分无关文本
- 搜索时候选池放大到 200，减少“语义相关但排在后面被截断”

## 2. Workflow / Prompt 真正可激活

以前进化写到 `.novaway/workflows|prompts` 后，运行时基本不消费。

现在：

- `ConfigCommand.load` 会加载 `commands` + **workflows** + **prompts**
- 作为 **slash command** 可用
- 新增 `Command.reload()`
- `Evolution.applyToDisk` 对 `workflow/prompt` 会尝试热激活，并写 `validationNote`

## 验证

```text
memory/vector.test.ts                         → pass
config/command-evolution-load.test.ts         → pass
evolution workflow/skill/agent validation     → pass
skill/agent reload                            → pass
memory lifecycle                              → pass
```

## 当前能力总览

| 能力                       | 状态                             |
| -------------------------- | -------------------------------- |
| 全能领域记忆               | 有                               |
| 冲突替代 / 版本            | 有                               |
| FTS + 本地语义混合检索     | 有                               |
| Skill / Agent 热加载       | 有                               |
| Workflow / Prompt 命令激活 | 有                               |
| 设置页可观测 + domain 筛选 | 有                               |
| 外部 Embedding 模型检索    | 未做（可后续接 OpenAI/本地模型） |
| Tool 进化生成可执行 `.ts`  | 未做                             |

如果继续，下一刀最合适的是：

1. **接真实 embedding 模型**（在本地语义之上加一路）
2. 或 **tool 进化产物生成/注册可执行工具**

## 20 2026-07-25T06:44:07.650Z

本轮继续完成了 **Tool 进化闭环**（可执行工具生成 + 热加载）。

## 1. Tool 写盘改为可执行模块

- `kind=tool` 现在写入 `.novaway/tools/*.ts`（不再是 `.md`）
- 若候选已是可执行 TS（`export default` + `args` + `execute`）→ **原样写入**
- 若是自然语言描述 → **自动生成** `@opencode-ai/plugin` 工具模板

## 2. ToolRegistry 热加载

- 新增 `ToolRegistry.reload()`
- 发现路径增强：始终扫描当前实例的 `.novaway` / `.opencode`
- `Evolution.applyToDisk` 对 tool 会尝试热刷新，并写 `validationNote`

## 3. 进化提示词升级

- `kind=tool` 时优先要求生成可运行 TS 工具模块
- `workflow/prompt` 继续作为可激活命令模板

## 验证

```text
evolution/service.test.ts  → 24 pass
  - materializes executable tool modules
  - keeps executable typescript content intact
  - workflow as command artifact
memory/vector + command load → pass
```

## 当前记忆/进化闭环

| 产物     | 写盘                 | 热加载/激活            |
| -------- | -------------------- | ---------------------- |
| skill    | `skills/**/SKILL.md` | Skill.reload           |
| agent    | `agents/*.md`        | Agent.reload           |
| workflow | `workflows/*.md`     | Command.reload         |
| prompt   | `prompts/*.md`       | Command.reload         |
| tool     | `tools/*.ts`         | ToolRegistry.reload    |
| memory   | SQLite + 可选 md     | FTS + 本地语义混合检索 |

## 仍未做

- **外部 Embedding 模型**检索（当前是本地 n-gram 语义）
- tool 进化生成更复杂业务逻辑（现有：可执行模板 + 原样 TS 透传）

若继续，下一刀最合适是接 **真实 embedding 模型**（在本地语义之上加一路）。

## 24 2026-07-25T10:36:34.061Z

可以，而且**不应该要求用户先装本地模型**。这轮已按「开箱即用」做成三层策略。

## 设计原则

| 用户环境                     | 实际行为                                       |
| ---------------------------- | ---------------------------------------------- |
| 什么都没有                   | **本地语义**（n-gram）+ 关键词 + FTS，马上能用 |
| 已有 OpenAI API Key          | **自动升级**云端 embedding                     |
| 本机有 Ollama 且装了嵌入模型 | **自动升级**本地稠密向量                       |
| 用户强制关掉                 | 只保留关键词/FTS                               |

核心：  
**默认不依赖任何模型；有模型就自动变强，没有也不影响使用。**

## 配置（默认 auto）

```jsonc
{
  "memory": {
    "embedding_mode": "auto", // auto | local | provider | ollama | off
    "embedding_provider": "openai",
    "embedding_model": "text-embedding-3-small",
    "embedding_ollama_url": "http://localhost:11434",
    // "embedding_ollama_model": "nomic-embed-text" // 可选，不填会自动探测
  },
}
```

- **`auto`（默认）**：本地语义始终可用；若检测到 `OPENAI_API_KEY` 或本机 Ollama 嵌入模型，再启用稠密向量
- **`local`**：永远只用本地语义（适合完全离线）
- **`provider` / `ollama`**：强制指定后端；失败会**回退本地**，不打断记忆写入
- **`off`**：关闭语义增强

## 实现位置

- 配置：[`packages/opencode/src/config/memory.ts`](packages/opencode/src/config/memory.ts)
- 解析/探测：[`packages/opencode/src/memory/embedder.ts`](packages/opencode/src/memory/embedder.ts)
- 本地语义：[`packages/opencode/src/memory/vector.ts`](packages/opencode/src/memory/vector.ts)
- 混合排序：关键词 + FTS + 本地语义/稠密向量
- 写入时 best-effort 生成向量；失败不影响记忆落库

## 用户侧怎么理解

1. **新用户零配置**：装完就能记、能召回
2. **已有聊天 API Key 的用户**：同一套 Key 自动增强记忆检索，不必再配一套
3. **喜欢本地的用户**：装 Ollama + `nomic-embed-text` 等即可，无需改业务配置
4. **企业离线**：`embedding_mode: "local"` 即可锁定

## 验证

离线测试已通过：无 Key、无 Ollama 时稳定回退本地；有稠密向量时排序会优先语义匹配。

---

**一句话**：本地模型是「增强项」不是「门槛」；没有本地模型，系统照样开箱能用。

## 27 2026-07-25T15:06:36.275Z

已经写清楚，并落到产品里了。

## 用户在哪里看

1. **设置页**  
   **设置 → 记忆与进化 → 智能召回**
   - 有 4 步操作说明
   - 可直接切换召回模式（自动 / 仅本地 / 云端 / Ollama / 关闭）
   - 每种模式下方有一句话说明

2. **完整文档**  
   [`docs/memory-retrieval-guide.md`](docs/memory-retrieval-guide.md)

---

## 给用户的最短操作说明

### 路径 1：什么都不配（默认）

1. 打开 **启用持久记忆**
2. 对话说：`请记住：我偏好简洁中文`
3. **新开会话**再问偏好

→ 已在用本地语义召回，**不需要本地模型**。

### 路径 2：云端增强（已有 OpenAI Key）

1. 配置 `OPENAI_API_KEY`（或已有 Provider）
2. 召回模式保持 **自动（推荐）**
3. **重启** NovaWay

→ 新写入记忆会自动用云端向量增强。

### 路径 3：本机 Ollama 增强

```bash
ollama pull nomic-embed-text
```

1. 确保 Ollama 在跑（默认 `http://localhost:11434`）
2. 召回模式保持 **自动** 或选 **Ollama 本地向量**
3. **重启** NovaWay

→ 没有 Ollama 时会自动退回本地语义，不影响使用。

### 路径 4：强制离线

在设置里选 **仅本地语义**，或配置：

```jsonc
{ "memory": { "embedding_mode": "local" } }
```

---

## 设计口径（可直接对用户说）

- **本地模型不是门槛**，是增强项
- **默认 auto**：没模型也能用，有模型自动变强
- 失败会回退，不会把记忆功能弄挂

如果你希望，我可以再在首次打开「记忆与进化」时加一条轻量引导气泡（只出现一次）。

## 30 2026-07-25T16:02:55.333Z

可以，而且**应该做成「一键按钮」**，不要开机静默安装。

## 设计结论

| 做法                       | 建议                                       |
| -------------------------- | ------------------------------------------ |
| 启动时自动装 Ollama        | **不建议**（权限、网络、安全、失败难解释） |
| 设置页「一键启用本地向量」 | **推荐**                                   |
| 先检测再动作               | **必须**                                   |
| 装不上时给手动指引         | **必须**                                   |
| 失败回退本地语义           | **必须**（保证开箱能用）                   |

### 状态机

```text
点击「一键启用本地向量」
  ├─ 检测 Ollama CLI
  │    ├─ 没有 → 尝试安装（winget / brew / install.sh）
  │    │         失败 → 提示下载页/命令（needs_manual）
  │    └─ 有
  ├─ 检测服务是否运行
  │    └─ 未运行 → 尝试 ollama serve
  ├─ 检测嵌入模型
  │    └─ 没有 → ollama pull nomic-embed-text
  └─ 成功 → 写入 embedding_mode=ollama，本地向量就绪
```

## 已落地

1. **后端** [`packages/opencode/src/memory/ollama-setup.ts`](packages/opencode/src/memory/ollama-setup.ts)
   - 检测 / 安装 / 启动 / 拉模型
2. **API**
   - `GET /memory/embedding/status`
   - `POST /memory/embedding/setup-local`
3. **设置页**
   - 显示当前状态
   - **「一键启用本地向量」** 按钮
   - 步骤日志 + 成功后自动切到 `ollama` 模式
4. **文档** [`docs/memory-retrieval-guide.md`](docs/memory-retrieval-guide.md) 第 8 节

## 用户怎么用

1. 打开 **设置 → 记忆与进化 → 智能召回**
2. 看状态：未安装 / 未启动 / 缺模型 / 已就绪
3. 点 **一键启用本地向量**
4. 等步骤完成（安装可能要权限/网络）
5. 看到「本地向量已就绪」后，新记忆会走更强召回

## 各系统安装策略

- **Windows**：`winget install Ollama.Ollama`
- **macOS**：`brew install ollama`
- **Linux**：官方 `install.sh`
- 自动失败：给官网下载链接和可复制命令

## 安全边界

- **只有用户点按钮才安装/拉模型**
- 不在启动时偷偷装
- 任一步失败都不影响基础记忆（仍可用本地 n-gram）

---

**一句话**：可以自动装 Ollama、自动拉 embed 模型，但应是「用户授权的一键流程」，不是后台静默安装。这个方案已经按这个原则实现了。
