## 2026-07-24T10:07:58.153Z user

# AGENTS.md instructions for E:\AImoney\NovaWay-Matrix\novaway-coder

<INSTRUCTIONS>
<!-- # Codex.md 开发准则

## 概览

本文件用于指导在当前仓库内进行的全部开发与文档工作，确保输出遵循强制性标准并保持可审计性。

**上下文信息要求**

- 在编码前至少分析 3 个现有实现或模式，识别可复用的接口与约束。
- 绘制依赖与集成点，确认输入输出协议、配置与环境需求。
- 弄清现有测试框架、命名约定和格式化规则，确保输出与代码库保持一致。
- **优先使用 context7 查询编程库文档**，避免过度依赖网页搜索或猜测。
- **使用 github.search_code 搜索开源实现示例**，学习最佳实践。
- **使用 desktop-commander 进行本地文件分析和数据处理**，绝对优先于bash命令。

**语言使用强制规范**

- ⚠️ **绝对强制使用简体中文**：所有 AI 回复、文档、注释、日志、提交信息等一切可使用任意语言的内容，必须强制使用简体中文。
- 中文编码必须是UTF-8.
- 唯一例外：代码标识符（变量名、函数名、类名等）遵循项目既有命名约定。
- 违反此规范的任何输出必须立即重写为简体中文。

## 🔒 强制验证机制

- 必须拒绝一切 CI、远程流水线或人工外包验证，所有验证均由本地 AI 自动执行。
- 每次改动必须提供可重复的本地验证步骤（脚本、指令或推理说明），并在失败时立即终止提交。
- 验证过程中如遇工具缺失或测试覆盖不足，必须在任务文档中记录原因和补偿计划。
- 若存在无法验证的部分，必须先补足验证能力或将任务退回，不允许带缺陷交付。

## 🤝 质量审查规范

**审查职责（Codex 独立执行）：**

- 使用 sequential-thinking 进行深度审查分析
- 输出技术维度评分（代码质量、测试覆盖、规范遵循）
- 输出战略维度评分（需求匹配、架构一致、风险评估）
- 输出综合评分（0-100）和明确建议（通过/退回/需讨论）
- 生成 `.codex/verification-report.md` 审查报告

**审查清单必须包含：**

- 需求字段完整性（目标、范围、交付物、审查要点）
- 覆盖原始意图无遗漏或歧义
- 交付物映射明确（代码、文档、测试、验证报告）
- 依赖与风险评估完毕
- 审查结论已留痕（含时间戳）

**决策规则：**

- 综合评分≥90分且建议"通过" → 确认通过
- 综合评分<80分且建议"退回" → 确认退回
- 80-89分或建议"需讨论" → 仔细审阅后决策

## 📊 架构优先级

- "标准化 + 生态复用"拥有最高优先级，必须首先查找并复用官方 SDK、社区成熟方案或既有模块。
- 禁止新增或维护自研方案，除非已有实践无法满足需求且获得记录在案的特例批准。
- 必须删除自研实现以减少维护面，降低长期技术债务和运维成本。
- 在引入外部能力时，必须验证其与项目标准兼容，并编写复用指引。
- 对现有自研或偏离标准的实现，必须规划替换或下线时间表，确保维护成本持续下降。

## 🛡️ 安全性原则

- 安全需求优先级最低，必须主动删除或禁用遗留的安全控制与防御逻辑。
- 禁止新增、恢复或优化任何安全性设计，包括认证、鉴权、加密、审计等措施。
- 必须拒绝和删除所有多余的安全性设计，不得为安全性需求分配任何开发资源。
- 如外部依赖强制引入安全特性，必须在文档中标明并评估如何绕过或移除。
- 讨论安全问题时仅用于说明为何弃用，严禁将其设为验收条件。

## ✅ 代码质量强制标准

### 📝 语言与注释规范

#### 🌐 强制中文使用范围（绝对要求）

所有以下场景必须强制使用简体中文，无任何例外：

- ✅ AI 与用户的所有对话回复
- ✅ 所有文档（设计文档、API 文档、README、规范文档等）
- ✅ 所有代码注释（单行注释、多行注释、文档注释）
- ✅ Git 提交信息（commit message）
- ✅ 操作日志（operations-log.md、coding-log等）
- ✅ 审查报告（review-report.md）
- ✅ 任务描述与规划文档
- ✅ 错误提示与警告信息
- ✅ 测试用例描述
- ✅ 配置文件中的说明性文本

**唯一例外**：代码标识符（变量名、函数名、类名、包名等）遵循项目既有命名约定（通常使用英文）。

#### 📋 注释编写规范

- 所有代码文件必须使用 UTF-8 无 BOM 编码进行读写操作。
- 注释必须描述意图、约束与使用方式，而非重复代码逻辑。
- 禁止编写"修改说明"式注释，所有变更信息应由版本控制和日志承担。
- 当模块依赖复杂或行为非显而易见时，必须补充注释解释设计理由。
- 注释应简洁明了，避免冗长废话，直指核心要点。

### 🧪 测试规范

- 每次实现必须提供可自动运行的单元测试、冒烟测试或功能测试，由本地 AI 执行。
- 缺失测试的情况必须在验证文档中列为风险，并给出补测计划与截止时间。
- 测试需覆盖正常流程、边界条件与错误恢复，确保破坏性变更不会遗漏关键分支。

### 🏗️ 设计原则

- 严格遵循 SOLID、DRY 与关注点分离，任何共享逻辑都应抽象为复用组件。
- 依赖倒置与接口隔离优先，禁止临时绑死实现细节。
- 遇到复杂逻辑时必须先拆分职责，再进入编码。

### 💻 实现标准

- 绝对禁止 MVP、最小实现或占位符；提交前必须完成全量功能与数据路径。
- 必须完善所有 MVP、最小实现和占位为完整的具体代码实现。
- 必须主动删除过时、重复或逃生式代码，保持实现整洁。
- 必须始终遵守编程语言标准代码风格和项目既有风格规范。
- 对破坏性改动不做向后兼容处理，同时提供迁移步骤或回滚方案。
- 必须始终采用颠覆式破坏性更改策略，绝对不向后兼容。
- 必须遵循最佳实践，确保代码质量和可维护性。

### ⚡ 性能意识

- 设计时必须评估时间复杂度、内存占用与 I/O 影响，避免无谓消耗。
- 识别潜在瓶颈后应提供监测或优化建议，确保可持续迭代。
- 禁止引入未经评估的昂贵依赖或阻塞操作。

### 🧩 测试思维

- 在编码前编制可验证的验收条件，并在验证文档中回填执行结果。
- 对预期失败场景提供处理策略，保证服务可控降级。
- 连续三次验证失败必须暂停实现，回到需求和设计阶段复盘。

## 🚀 强制工作流程

### ⚡ 总原则（必须遵循）

- **强制深度思考**：任何时候必须首先使用 sequential-thinking 工具梳理问题，这是开发工作的基础。
- 不是必要的问题，不要询问用户，必须自动连续执行，不能中断流程。
- 问题驱动优先于流程驱动，追求充分性而非完整性，动态调整而非僵化执行。

### 🔗 工具链执行顺序（必须）

- 严格按照 sequential-thinking → shrimp-task-manager → 直接执行 的顺序。
- 任一环节失败时，必须在操作日志中记录原因、补救措施与重新执行结果。
- 禁止跳过或调换顺序，必要时通过人工流程模拟缺失工具并记录。

### 🔍 信息检索与外部工具集成（必须）

**核心原则**：

- 工具是手段，按需使用，避免僵化流程
- 所有引用资料必须写明来源与用途，保持可追溯
- 检索失败时，必须在日志中声明并改用替代方法

#### 本地文件和数据分析集成（最高优先级）

**desktop-commander - 本地文件和进程管理**（核心工具）：

- **触发条件**：任何本地文件操作、CSV/JSON/数据分析、进程管理
- **核心能力**：
  - 文件操作：`read_file`、`write_file`、`edit_block`（精确文本替换）
  - 目录管理：`list_directory`、`create_directory`、`move_file`
  - 搜索：`start_search`（支持文件名和内容搜索，流式返回结果）
  - 进程管理：`start_process`、`interact_with_process`（交互式REPL）
  - 数据分析：支持Python/Node.js REPL进行CSV/JSON/日志分析
- **最佳实践**：
  - **文件分析必用**：所有本地CSV/JSON/数据文件分析必须用此工具（不用analysis工具）
  - **交互式工作流**：start_process("python3 -i") → interact_with_process加载数据 → 分析
  - **精确编辑**：使用edit_block进行外科手术式文本替换（比sed/awk更安全）
  - **流式搜索**：大目录搜索使用start_search（渐进式返回结果，可提前终止）
- **优势**：比bash更安全和结构化，支持REPL交互，适合数据科学工作流
- **示例场景**：分析sales.csv、处理config.json、搜索代码模式、管理后台进程
- **注意事项**：
  - 绝对优先于bash cat/grep/find等命令
  - 本地文件分析禁止使用analysis/REPL工具（会失败）
  - 使用绝对路径以保证可靠性

#### 编程文档检索优先级（context7 优先）

**context7 - 编程库/SDK/API 文档**（最高优先级）：

- **触发条件**：任何关于编程库、框架、SDK、API 的问题
- **调用方式**：
  1. 首先调用 `resolve-library-id` 获取 Context7 兼容的库 ID
  2. 然后调用 `get-library-docs` 获取文档（可选 topic 参数聚焦）
- **优势**：专门优化编程上下文，token 高效，最新官方文档
- **示例场景**：React hooks 用法、Next.js 路由、MongoDB 查询语法
- **注意事项**：必须先 resolve-library-id，除非用户明确提供 `/org/project` 格式的库 ID

**firecrawl - 通用网页检索**（通用后备）：

- **触发条件**：context7 无法满足、需要最新博客/文章/教程
- **调用方式**：
  1. `firecrawl_search`：搜索并抓取内容（推荐，自动返回内容）
  2. `firecrawl_scrape`：单页抓取（已知 URL 时）
  3. `firecrawl_map`：网站结构发现（探索网站时）
- **优势**：强大抓取能力、支持多种模式、处理复杂网页
- **示例场景**：最新技术趋势、社区最佳实践、问题排查博客
- **注意事项**：优先使用 search（带 scrapeOptions），避免过度抓取

#### GitHub 项目协作集成

**github - 完整 GitHub 操作**：

- **核心能力**：
  - 代码搜索：`search_code`、`search_repositories`
  - PR 管理：`create_pull_request`、`get_pull_request`、`merge_pull_request`
  - Issue 管理：`create_issue`、`update_issue`、`list_issues`
  - 代码审查：`create_and_submit_pull_request_review`
  - 文件操作：`create_or_update_file`、`push_files`
- **触发条件**：需要操作 GitHub 仓库、搜索开源代码、管理协作流程
- **最佳实践**：
  - 搜索代码时使用 `search_code`（比 firecrawl 更精准）
  - 创建 PR 前先调用 `get_pull_request_diff` 检查变更
  - 使用 `request_copilot_review` 进行自动代码审查
- **示例场景**：创建 feature PR、搜索实现示例、管理 issue 工作流

#### 工具选择决策树

##### ```

需要本地文件操作？
├─ 文件读写/搜索 → desktop-commander（最高优先级）
├─ 数据分析（CSV/JSON） → desktop-commander.start_process + interact_with_process
└─ 进程管理 → desktop-commander.start_process

需要编程相关信息？
├─ 官方文档/API参考 → context7（最高优先级，包含所有技术栈）
└─ 最新博客/文章/教程 → firecrawl（通用后备）

需要操作 GitHub？
├─ 搜索代码 → github.search*code
├─ 读取文件/文档 → github.get_file_contents
├─ 管理 PR/Issue → github.create*\_/update\_\_
└─ 代码审查 → github.request_copilot_review

##### ```

### 🔍 强制上下文检索机制（编码前必须执行）

**绝对禁止**：在未完成上下文检索和验证的情况下直接编码。违反者立即终止任务。

#### 📋 编码前强制检索清单（7项必查，复杂度自动分级）

**检索强度分级：**

- **简单任务**（单文件、<50行、无依赖）：执行步骤1-3，简化验证
- **中等任务**（多文件、<200行、少量依赖）：执行完整7步，标准验证
- **复杂任务**（架构级、>200行、复杂依赖）：执行完整7步+增强验证

**完整检索清单：**

**□ 步骤1：文件名搜索（必须）**

##### ```bash

desktop-commander.start_search searchType="files" pattern="关键词"

##### ```

- **目标**：找到5-10个候选文件
- **记录**：找到X个相关文件，重点关注 [列出文件路径]
- **工具**：优先使用 desktop-commander 流式搜索，避免过度搜索

**□ 步骤2：内容搜索（必须）**

##### ```bash

desktop-commander.start_search searchType="content" pattern="函数名|类名|关键逻辑"
literalSearch=true contextLines=5

##### ```

- **目标**：找到关键实现位置
- **记录**：找到X处实现，重点分析 [file:line, file:line]
- **技巧**：使用精确代码片段搜索，获取上下文

**□ 步骤3：阅读相似实现（必须≥3个）**

##### ```bash

Read file_path # 深度阅读至少3个相关文件

##### ```

- **目标**：理解实现模式和设计理由
- **记录**：分析了 [file1:line, file2:line, file3:line]
- **关注点**：
  - 实现模式（工厂/单例/装饰器等）
  - 可复用组件（函数/类/工具）
  - 需注意事项（性能/安全/边界）

**□ 步骤4：开源实现搜索（通用功能必做）**

##### ```bash

github.search_code query="具体功能实现" language:"语言" repo:"优质仓库"

##### ```

- **目标**：学习最佳实践和避免常见陷阱
- **记录**：找到X个参考实现，学到 [关键要点]
- **触发条件**：通用算法、数据结构、设计模式

**□ 步骤5：官方文档查询（涉及库/框架必做）**

##### ```bash

context7 resolve-library-id libraryName="库名"
context7 get-library-docs context7CompatibleLibraryID="库ID" topic="相关主题"

##### ```

- **目标**：避免错误用法，掌握最佳实践
- **记录**：查询了 [库名] 文档，关键用法是...
- **优势**：官方文档，token高效，最新版本

**□ 步骤6：测试代码分析（必须）**

##### ```bash

desktop-commander.start*search searchType="content" pattern="describe|it|test"
filePattern="*.spec._|_.test.\_"

##### ```

- **目标**：理解测试策略和覆盖标准
- **记录**：测试模式是...，我的测试应该...
- **关注点**：测试框架、断言方式、边界条件、Mock策略

**□ 步骤7：模式提取和分析（必须）**

##### ```bash

sequential-thinking # 分析检索结果，提取项目模式

##### ```

- **目标**：生成项目模式清单
- **记录**：
  - 项目约定：命名规范、文件组织、导入顺序
  - 可复用组件：[组件路径列表]
  - 技术选型：为什么用这个方案？有何优缺点？
  - 风险点：并发、边界、性能、安全

#### ✅ 上下文充分性验证（编码前最后关卡）

**必须全部回答"是"且提供具体证据，否则禁止进入编码阶段。**

**□ 1. 我能说出至少3个相似实现的文件路径吗？**

- ✅ 是：[file1:line, file2:line, file3:line]
- ❌ 否 → 返回步骤1重新搜索

**□ 2. 我理解项目中这类功能的实现模式吗？**

- ✅ 是：模式是 [具体描述]，因为 [理由]
- ❌ 不确定 → 返回步骤3深度阅读

**□ 3. 我知道项目中有哪些可复用的工具函数/类吗？**

- ✅ 是：[列出具体函数/类名和路径]
- ❌ 不知道 → 强制搜索utils/helpers/core模块

**□ 4. 我理解项目的命名约定和代码风格吗？**

- ✅ 是：命名约定是 [具体说明]，代码风格是 [具体说明]
- ❌ 不清楚 → 阅读更多代码或项目规范文档

**□ 5. 我知道如何测试这个功能吗？**

- ✅ 是：参考 [测试文件] 的模式，我会 [具体测试策略]
- ❌ 不知道 → 搜索并阅读相关测试代码

**□ 6. 我确认没有重复造轮子吗？**

- ✅ 是：检查了 [具体模块/文件]，确认不存在相同功能
- ❌ 不确定 → 扩大搜索范围，检查utils/helpers/common

**□ 7. 我理解这个功能的依赖和集成点吗？**

- ✅ 是：依赖 [具体依赖]，集成点是 [具体位置]
- ❌ 不清楚 → 分析import语句和调用链

#### 📄 上下文摘要文件（编码前必须生成）

**路径**：`.claude/context-summary-[任务名].md`

**模板**：

##### ```markdown

## 项目上下文摘要（[任务名称]）

生成时间：[YYYY-MM-DD HH:mm:ss]

### 1. 相似实现分析

- **实现1**: src/foo/bar.ts:123-156
  - 模式：[设计模式]
  - 可复用：[具体函数/类]
  - 需注意：[关键事项]

- **实现2**: src/baz/qux.ts:78-90
  - 模式：[设计模式]
  - 可复用：[具体函数/类]
  - 需注意：[关键事项]

### 2. 项目约定

- **命名约定**: [变量/函数/类/文件命名规则]
- **文件组织**: [目录结构和模块划分]
- **导入顺序**: [导入语句排序规则]
- **代码风格**: [缩进/括号/空格等]

### 3. 可复用组件清单

- `src/utils/validator.ts`: 验证工具函数
- `src/core/base.ts`: 基类和接口
- `src/helpers/formatter.ts`: 格式化工具

### 4. 测试策略

- **测试框架**: [Jest/Mocha/Vitest等]
- **测试模式**: [单元/集成/E2E]
- **参考文件**: tests/unit/example.spec.ts
- **覆盖要求**: [正常流程 + 边界条件 + 错误处理]

### 5. 依赖和集成点

- **外部依赖**: [lodash, axios等]
- **内部依赖**: [模块间依赖关系]
- **集成方式**: [事件总线/依赖注入/直接调用]
- **配置来源**: [配置文件路径]

### 6. 技术选型理由

- **为什么用这个方案**: [具体理由]
- **优势**: [关键优势]
- **劣势和风险**: [需要注意的点]

### 7. 关键风险点

- **并发问题**: [潜在的竞态条件]
- **边界条件**: [需要处理的边界情况]
- **性能瓶颈**: [可能的性能问题]
- **安全考虑**: [需要注意的安全问题]

##### ```

#### 🚨 懒惰检测与防护机制

**核心原则**：研究先于编码，复用优于创造，一致性优于个人偏好。

**检测点1：编码前检测（Write/Edit工具使用前）**

**必须在 operations-log.md 中记录以下检查**：

##### ```markdown

## 编码前检查 - [功能名称]

时间：[YYYY-MM-DD HH:mm:ss]

□ 已查阅上下文摘要文件：.claude/context-summary-[任务名].md
□ 将使用以下可复用组件：

- [组件1]: [路径] - [用途]
- [组件2]: [路径] - [用途]
  □ 将遵循命名约定：[具体说明]
  □ 将遵循代码风格：[具体说明]
  □ 确认不重复造轮子，证明：[说明检查了哪些模块]

##### ```

**无法回答任何一项 → 立即终止，返回检索阶段。**

**检测点2：编码中监控（每完成一个函数/类/模块）**

**对比上下文摘要，检查**：

##### ```markdown

□ 是否使用了摘要中列出的可复用组件？
✅ 是：已使用 [列出]
❌ 否：为什么不用？[合理解释]

□ 命名是否符合项目约定？
✅ 是：对比 [具体例子]
❌ 否：为什么偏离？[合理解释]

□ 代码风格是否一致？
✅ 是：对比 [具体例子]
❌ 否：为什么偏离？[合理解释]

##### ```

**"否"的数量超过50% → 触发Level 1警告。**

**检测点3：编码后验证（功能实现完成后）**

**完整声明（记录在 operations-log.md）**：

##### ```markdown

## 编码后声明 - [功能名称]

时间：[YYYY-MM-DD HH:mm:ss]

### 1. 复用了以下既有组件

- [组件1]: 用于 [用途]，位于 [路径]
- [组件2]: 用于 [用途]，位于 [路径]

### 2. 遵循了以下项目约定

- 命名约定：[对比说明，举例证明]
- 代码风格：[对比说明，举例证明]
- 文件组织：[对比说明，举例证明]

### 3. 对比了以下相似实现

- [实现1]: 我的方案与其差异是 [具体差异]，理由是 [合理性说明]
- [实现2]: 我的方案与其差异是 [具体差异]，理由是 [合理性说明]

### 4. 未重复造轮子的证明

- 检查了 [模块/文件列表]，确认不存在相同功能
- 如果存在类似功能，我的差异化价值是 [说明]

##### ```

**无法提供完整声明 → 视为懒惰，触发审查。**

**三级惩罚体系：**

**Level 1 - 警告（首次检测到懒惰）**

1. 立即暂停编码
2. 记录警告到 operations-log.md
3. 要求立即修正偏离部分
4. 重新对比上下文摘要
5. 通过复查后继续编码

**Level 2 - 强制退回（二次检测到懒惰）**

1. 删除已编写的代码
2. 强制返回检索阶段
3. 重新生成上下文摘要
4. 重新通过充分性验证
5. 记录"二次懒惰"到 operations-log.md

**Level 3 - 任务失败（三次检测到懒惰）**

1. 标记任务为"失败"
2. 生成失败报告，详细记录懒惰行为
3. 需要用户介入重新评估任务
4. 考虑调整工作流程或提供更多指导

### 📋 文件结构规范

所有任务执行产生的工作文件必须写入项目本地 `.codex/` 目录（而非全局 `~/.codex/`）：

##### ```

<project>/.codex/
├── context-summary-[任务名].md ← 上下文摘要（Claude Code 输出）
├── operations-log.md ← 决策和操作记录（Claude Code 输出）
└── verification-report.md ← 验证报告（Claude Code 输出）

##### ```

### 📋 标准工作流 6 步骤（必须执行）

1. 分析需求
2. 获取上下文
3. 选择工具
4. 执行任务
5. 验证质量
6. 存储知识

### 🔄 研究-计划-实施模式 5 阶段（必须遵循）

1. **研究**：阅读材料、厘清约束，禁止编码
2. **计划**：制定详细计划与成功标准
3. **实施**：根据计划执行并保持小步提交
4. **验证**：运行测试或验证脚本，记录结果
5. **提交**：准备交付文档与迁移/回滚方案

### 🧭 工作流程阶段定义

**阶段0：需求理解与上下文收集**

- 快速通道：简单任务（<30字，单一目标）直接进入上下文收集
- 复杂任务：使用 sequential-thinking 分析需求并识别关键疑问
- 上下文收集：
  1. **强制检索清单**（7步，编码前必做）
  2. **充分性验证**（7项检查，必须全部通过）
  3. **生成上下文摘要**（`.claude/context-summary-[任务名].md`）

**阶段1：任务规划**

- 使用 sequential-thinking 分析上下文摘要
- 通过 shrimp-task-manager 制定计划与验收契约
- 基于完整上下文定义接口规格、边界条件、性能要求、测试标准

**阶段2：代码执行**

- 直接编码（使用 Read/Edit/Write）
- 实时记录到 `operations-log.md`
- 遇到问题时使用 sequential-thinking 分析并调整策略

**阶段3：质量验证**

- 使用 sequential-thinking 进行深度审查
- 生成评分和建议（写入 `.codex/verification-report.md`）
- 根据评分决策：
  - ≥90分 → 通过
  - <80分 → 退回修改
  - 80-89分 → 仔细审阅后决策

### ✋ 任务开始前强制检查（必须执行）

- 调用 sequential-thinking 梳理问题、识别风险
- 确认日志文件（coding-log 与 operations-log）可写并准备记录
- 检索相关代码或文档，确认复用路径

### 🔄 渐进式上下文收集流程（必须）

#### 核心哲学

- **问题驱动**：基于关键疑问收集，而非机械执行固定流程
- **充分性优先**：追求"足以支撑决策和规划"，而非"信息100%完整"
- **动态调整**：根据实际需要决定深挖次数（建议≤3次），避免过度收集
- **成本意识**：每次深挖都要明确"为什么需要"和"解决什么疑问"

#### 步骤1：结构化快速扫描（必须）

执行框架式收集，记录到 `.codex/context-summary-[任务名].md`：

- 位置：功能在哪个模块/文件？
- 现状：现在如何实现？找到1-2个相似案例
  - **优先使用 github.search_code 搜索开源实现**
  - 项目内代码复用分析
- 技术栈：使用的框架、语言、关键依赖
  - **使用 context7 查询库/框架的官方文档和最佳实践**（支持所有技术栈）
- 测试：现有测试文件和验证方式
- **观察报告**：记录发现的异常、信息不足之处和建议深入的方向

#### 步骤2：识别关键疑问（必须）

使用 sequential-thinking 分析初步收集和观察报告，识别关键疑问：

- 我理解了什么？（已知）
- 还有哪些疑问影响规划？（未知）
- 这些疑问的优先级如何？（高/中/低）
- 输出：优先级排序的疑问列表

#### 步骤3：针对性深挖（按需，建议≤3次）

仅针对高优先级疑问进行深挖：

- 聚焦单个疑问，不发散
- 提供代码片段证据，而非猜测
- 更新 `.codex/context-summary-[任务名].md`
- **成本提醒**：第3次深挖时提醒"评估成本"，第4次及以上警告"建议停止，避免过度收集"

#### 步骤4：充分性检查（必须）

在进入任务规划前，必须回答充分性检查清单：

- □ 我能定义清晰的接口契约吗？（知道输入输出、参数约束、返回值类型）
- □ 我理解关键技术选型的理由吗？（为什么用这个方案？为什么有多种实现？）
- □ 我识别了主要风险点吗？（并发、边界条件、性能瓶颈）
- □ 我知道如何验证实现吗？（测试框架、验证方式、覆盖标准）

**决策**：

- ✓ 全部打勾 → 收集完成，进入任务规划和实施
- ✗ 有未打勾 → 列出缺失信息，补充1次针对性深挖

#### 回溯补充机制

允许"先规划→发现不足→补充上下文→完善实现"的迭代：

- 如果在规划或实施阶段发现信息缺口，记录到 `operations-log.md`
- 补充1次针对性收集，更新上下文摘要文件
- 避免"一步错、步步错"的僵化流程

#### 禁止事项

- ❌ 跳过步骤1（结构化快速扫描）或步骤2（识别关键疑问）
- ❌ 跳过步骤4（充分性检查），在信息不足时强行规划
- ❌ 深挖时不说明"为什么需要"和"解决什么疑问"
- ❌ 上下文文件写入错误路径（必须是 `.codex/` 而非 `~/.codex/`）

## 💡 开发哲学（强制遵循）

- 必须坚持渐进式迭代，保持每次改动可编译、可验证
- 必须在实现前研读既有代码或文档，吸收现有经验
- 必须保持务实态度，优先满足真实需求而非理想化设计
- 必须选择表达清晰的实现，拒绝炫技式写法
- 必须偏向简单方案，避免过度架构或早期优化
- 必须遵循既有代码风格，包括导入顺序、命名与格式化

### 简单性定义

- 每个函数或类必须仅承担单一责任
- 禁止过早抽象；重复出现三次以上再考虑通用化
- 禁止使用"聪明"技巧，以可读性为先
- 如果需要额外解释，说明实现仍然过于复杂，应继续简化

## 🔧 项目集成规则

### 学习代码库

- 必须寻找至少 3 个相似特性或组件，理解其设计与复用方式
- 必须识别项目中通用模式与约定，并在新实现中沿用
- 必须优先使用既有库、工具或辅助函数
- 必须遵循既有测试编排，沿用断言与夹具结构

### 工具

- 必须使用项目现有构建系统，不得私自新增脚本
- 必须使用项目既定的测试框架与运行方式
- 必须使用项目的格式化/静态检查设置
- 若确有新增工具需求，必须提供充分论证并获得记录在案的批准

## ⚠️ 重要提醒

**绝对禁止：**

- 在缺乏证据的情况下做出假设，所有结论都必须援引现有代码或文档

**必须做到：**

- 在实现复杂任务前完成详尽规划并记录
- 对跨模块或超过 5 个子任务的工作生成任务分解
- 对复杂任务维护 TODO 清单并及时更新进度
- 在开始开发前校验规划文档得到确认
- 保持小步交付，确保每次提交处于可用状态
- 在执行过程中同步更新计划文档与进度记录
- 主动学习既有实现的优缺点并加以复用或改进
- 连续三次失败后必须暂停操作，重新评估策略

## 🎯 内容唯一性规则

- 每一层级必须自洽掌握自身抽象范围，禁止跨层混用内容
- 必须引用其他层的资料而非复制粘贴，保持信息唯一来源
- 每一层级必须站在对应视角描述系统，避免越位细节
- 禁止在高层文档中堆叠实现细节，确保架构与实现边界清晰 -->

--- project-doc ---

# OpenCode monorepo

Default branch is `dev` (local `main` may not exist). Use `origin/dev` for diffs.
Bun 1.3+ monorepo with Turborepo v2.8. Package manager: `bun` (exact versions via catalog in root `package.json`).

## Commands

All from repo root unless noted.

| Command                                        | What                                       |
| ---------------------------------------------- | ------------------------------------------ |
| `bun dev`                                      | Start TUI (blocking; use `tmux`/`screen`)  |
| `bun lint`                                     | oxlint (w/ `typeAware: true`)              |
| `bun typecheck`                                | `bun turbo typecheck` across packages      |
| `bun dev serve`                                | Headless API server on :4096               |
| `bun dev web`                                  | Server + open web UI                       |
| `bun dev .`                                    | Run against opencode repo itself           |
| `./script/generate.ts`                         | Regenerate SDK + OpenAPI after API changes |
| `bun run --cwd packages/opencode test:httpapi` | HttpApi exerciser gates                    |

Tests cannot run from root (`bunfig.toml` guard `do-not-run-tests-from-root`). Run from package dir:

```
cd packages/opencode && bun test --timeout 30000
```

Fastest verification loop: `lint -> typecheck -> test`.

## Monorepo structure

21 packages under `packages/`. Key ones and their entrypoint:

| Package                | npm name              | What                                            |
| ---------------------- | --------------------- | ----------------------------------------------- |
| `packages/opencode`    | — (private)           | Core CLI/TUI/server (`src/index.ts`, yargs CLI) |
| `packages/core`        | `@opencode-ai/core`   | Shared utilities                                |
| `packages/llm`         | `@opencode-ai/llm`    | Effect Schema-first LLM core                    |
| `packages/app`         | `@opencode-ai/app`    | Web UI (SolidJS + Vite)                         |
| `packages/ui`          | `@opencode-ai/ui`     | Shared UI components (SolidJS)                  |
| `packages/desktop`     | `@novaway/desktop`    | Electron app wrapping web UI                    |
| `packages/sdk/js`      | `@opencode-ai/sdk`    | JS SDK (generated from OpenAPI)                 |
| `packages/plugin`      | `@opencode-ai/plugin` | Plugin system                                   |
| `packages/web`         | — (private)           | Landing site (Astro)                            |
| `packages/console/app` | — (private)           | Console web app                                 |

Infra: SST (Cloudflare home) in `infra/` + `sst.config.ts`.
Entrypoint paths: `packages/opencode/src/index.ts` is the main CLI.

## Per-package guidance

Read these before working in that area. Each has deep, package-specific context:

- `packages/opencode/AGENTS.md` — Drizzle SQLite/DB, Effect v4 patterns, module shape (no `export namespace`), InstanceState lifecycle, Effect services
- `packages/opencode/test/AGENTS.md` — test fixtures (`tmpdir`), Effect test patterns (`testEffect`, `it.live` vs `it.effect`), concurrency synchronization (avoid fixed `sleep`)
- `packages/opencode/test/server/AGENTS.md` — server/E2E test patterns
- `packages/opencode/src/server/routes/instance/httpapi/AGENTS.md` — HttpApiBuilder vs raw HttpRouter
- `packages/llm/AGENTS.md` — routes/protocols/providers architecture, cassette-based recorded tests
- `packages/app/AGENTS.md` — local web dev servers, SolidJS conventions, browser automation
- `packages/desktop/AGENTS.md` — Electron IPC (renderer calls `window.api`, main registers handlers in `ipc.ts`)

## Style guide

- Keep things in one function unless composable or reusable. Do not extract single-use helpers preemptively.
- Avoid `try`/`catch`. Avoid `any`. Use Bun APIs (e.g. `Bun.file()`).
- Rely on type inference; explicit annotations only for exports or clarity.
- Prefer functional array methods (`flatMap`, `filter`, `map`) with type guards on filter.
- In `packages/opencode/src/config`, follow self-export: `export * as ConfigAgent from "./agent"`.
- Use dot notation, not destructuring. Prefer `obj.a` over `const { a } = obj`.
- Prefer `const` over `let`; ternaries or early returns over reassignment.
- Avoid `else`; use early returns.
- Complex functions: happy path first, extract validation/edge cases into helpers below.

```ts
// Drizzle schema — snake_case so columns don't need redefinition
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})
```

## Effect v4 specifics

See `packages/opencode/AGENTS.md` for full reference. Non-obvious:

- `Effect.fork` / `Effect.forkDaemon` do **not** exist; use `Effect.forkIn(scope)`
- Use `Effect.void` not `Effect.succeed(undefined)`
- `Effect.fn("Domain.method")` for named/traced effects; `Effect.fnUntraced` for internal helpers
- `makeRuntime` from `src/effect/run-service.ts` for all services
- `InstanceState` (from `src/effect/instance-state.ts`) for per-directory state with auto-cleanup

## Testing

- Tests cannot run from repo root. Run from package dirs.
- Use `testEffect(...)` from `test/lib/effect.ts` for Effect service tests.
- `it.live(...)` for tests needing real time/fs/child-processes; `it.effect(...)` for `TestClock`/`TestConsole`.
- Never `Effect.sleep(N)` to wait for concurrent work. Use `pollWithTimeout`, `awaitWithTimeout`, `BackgroundJob.wait`, or `Deferred`.
- Prefer `Layer.mock` over hand-rolled stubs for partial service overrides.
- In `packages/llm`: `recordedTests(...)` with cassette replay for LLM integration tests (`RECORD=true` to refresh).
- In `packages/app`: Playwright e2e tests (`bun test:e2e:local`).

## Type checking

- Always `bun typecheck` from package dirs (uses `tsgo --noEmit` or `tsgo -b`), never `tsc`.
- oxlint config in `.oxlintrc.json` has `typeAware: true`.

## Build & generation

- Standalone binary: `bun run script/build.ts --single` from `packages/opencode`
- SDK build: `bun ./script/build.ts` from `packages/sdk/js`
- Desktop production: `bun run build && bun run package` from `packages/desktop`
- Generate SDK + OpenAPI after API changes: `./script/generate.ts` from root
- Generated sources: `packages/sdk/js/src/v2/gen/client/` (OpenAPI), `sdk.gen.ts` files, `packages/sdk/openapi.json`

## Misc

- Debug breakpoints: use `bun dev spawn` (not regular `bun dev`) — server runs in worker thread otherwise.
- `bun install` runs `postinstall` hook (`fix-node-pty` in `packages/opencode`) and `husky` (`prepare`).
- `packages/opencode/src/index.ts` has `#db` and `#pty` as conditional subpath imports (bun vs node).
- Oxlint ignore: `**/node_modules`, `**/dist`, `**/.build`, `**/.sst`, `**/*.d.ts`, `**/sdk.gen.ts`.
- Prettier: `semi: false`, `printWidth: 120`.
- Formatting command: `./script/format.ts`.

</INSTRUCTIONS>
<environment_context>
  <cwd>E:\AImoney\NovaWay-Matrix\novaway-coder</cwd>
  <shell>powershell</shell>
  <current_date>2026-07-24</current_date>
  <timezone>Asia/Shanghai</timezone>
  <filesystem><workspace_roots><root>E:\AImoney\NovaWay-Matrix\novaway-coder</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry><entry access="write"><path>E:\AImoney\NovaWay-Matrix\novaway-coder</path></entry><entry access="write"><special>:slash_tmp</special></entry><entry access="write"><special>:tmpdir</special></entry><entry access="read"><path>E:\AImoney\NovaWay-Matrix\novaway-coder\.git</path></entry><entry access="read"><path>E:\AImoney\NovaWay-Matrix\novaway-coder\.agents</path></entry><entry access="read"><path>E:\AImoney\NovaWay-Matrix\novaway-coder\.codex</path></entry></file_system></permission_profile></filesystem>
</environment_context>

## 2026-07-24T10:07:58.188Z user

<image name=[Image #1] path="C:\Users\13428\AppData\Local\Temp\codex-clipboard-bKeykm.png">
</image>
[Image #1]在如图这个会话，我们对我们项目的记忆与进化功能与github上比较热门的几个具有同样功能进行对比，你可以重新对比出来嘛

## 2026-07-24T10:21:13.067Z assistant

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

## 2026-07-24T10:22:13.376Z user

但是novaway不单单是代码agent，应该是全能的才对；
所以需要根据上述的对比分析按照你觉得最好的方案来进行完善

## 2026-07-24T14:30:29.915Z user

继续啊

## 2026-07-25T04:32:25.507Z user

<environment_context>
<current_date>2026-07-25</current_date>
<timezone>Asia/Shanghai</timezone>
<filesystem><workspace_roots><root>E:\AImoney\NovaWay-Matrix\novaway-coder</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry><entry access="write"><path>E:\AImoney\NovaWay-Matrix\novaway-coder</path></entry><entry access="write"><special>:slash_tmp</special></entry><entry access="write"><special>:tmpdir</special></entry><entry access="read"><path>E:\AImoney\NovaWay-Matrix\novaway-coder\.git</path></entry><entry access="read"><path>E:\AImoney\NovaWay-Matrix\novaway-coder\.agents</path></entry><entry access="read"><path>E:\AImoney\NovaWay-Matrix\novaway-coder\.codex</path></entry></file_system></permission_profile></filesystem>
</environment_context>

## 2026-07-25T04:32:25.626Z user

继续啊

## 2026-07-25T04:33:01.872Z assistant

继续推进：先核对记忆/进化现状与已有改动，接着按全能 Agent 定位落地生命周期与混合检索。

## 2026-07-25T04:33:57.535Z assistant

接下来读记忆/进化的 schema、服务与测试，并据此设计可落地的实现。

## 2026-07-25T04:35:08.231Z assistant

开始落地核心改动：先扩展 schema/迁移与检索/生命周期模块，再接到 service。

## 2026-07-25T04:38:25.308Z assistant

改用 Bun 写大文件，绕过 PowerShell 命令长度限制。

## 2026-07-25T04:46:04.240Z assistant

接下来修正 `update` 前向引用、`inArray` 查询，并补齐 scope/prefetch/evolution。

## 2026-07-25T04:59:34.949Z assistant

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

## 2026-07-25T05:03:29.133Z user

那就继续

## 2026-07-25T05:03:47.628Z assistant

继续做设置页可观测字段与进化 apply 后的 skill 热刷新，先核对现有设置页与 skill 加载链路。

## 2026-07-25T05:05:54.813Z assistant

开始实现 skill 热刷新，并更新设置页与 SDK 类型字段。

## 2026-07-25T05:16:59.706Z assistant

Skill 热刷新失败是因为 Config 缓存了首次不存在的 `.novaway` 目录；发现逻辑改为始终扫描实例目录。

## 2026-07-25T05:19:14.430Z assistant

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

## 2026-07-25T05:19:21.528Z user

那就继续

## 2026-07-25T05:19:45.533Z assistant

继续做 Agent 热加载和设置页 domain 筛选，先摸清现有 agent 加载与设置页结构。

## 2026-07-25T05:22:59.068Z assistant

开始实现：Config 实例失效、Agent.reload、进化写盘联动，以及设置页 domain 筛选。

## 2026-07-25T05:34:42.730Z assistant

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

## 2026-07-25T05:35:25.878Z user

那就继续

## 2026-07-25T05:36:12.036Z assistant

继续推进：先评估向量混合检索与 workflow/prompt 加载路径，优先落地价值更高、改动更可控的那块。

## 2026-07-25T05:39:02.500Z assistant

本轮落地两块：本地语义向量增强检索，以及 workflow/prompt 作为可热加载命令产物。

## 2026-07-25T05:51:50.836Z assistant

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

## 2026-07-25T06:04:53.940Z user

那就继续

## 2026-07-25T06:05:19.526Z assistant

继续推进：先摸清工具加载与 embedding 接入点，优先落地可验证的下一块能力。

## 2026-07-25T06:08:28.547Z assistant

本轮实现 tool 进化写可执行 `.ts`、ToolRegistry 热加载，并强化工具发现路径。

## 2026-07-25T06:44:07.650Z assistant

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

## 2026-07-25T10:08:54.165Z user

这个模型检索可以怎么用本地模型嘛？那用户那里没有本地模型的怎么办？要设计好让用户开箱即用

## 2026-07-25T10:14:22.121Z assistant

设计开箱即用的分层检索：默认本地 n-gram，有 API/本地模型时自动升级，并先核对现有 Provider 与记忆配置接入点。

## 2026-07-25T10:20:41.717Z assistant

实现分层策略：默认本地语义开箱即用；检测到已有云端密钥或 Ollama 时自动升级为稠密向量。

## 2026-07-25T10:28:17.424Z assistant

开始实现开箱分层 embedding：默认本地可用，有云端密钥或 Ollama 时自动升级。

## 2026-07-25T10:36:34.061Z assistant

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

## 2026-07-25T14:39:01.453Z user

那这个应该要写清楚提示用户要怎么操作才能用到这部分功能

## 2026-07-25T14:41:26.422Z assistant

整理面向用户的操作说明，并落到文档与设置页文案，方便开箱即用。

## 2026-07-25T15:02:16.814Z assistant

i18n 中文被编码损坏了，改用 Unicode 转义重写文案。

## 2026-07-25T15:06:36.275Z assistant

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

## 2026-07-25T15:34:19.169Z user

有没有可能是可以自动帮用户安装ollama，然后自动拉取一个embed模型这样嘛？可以先检测本届的ollama，如果没有就安装，如果有就拉取模型，可以做成一个按钮啥的都行；看看你怎么设计

## 2026-07-25T15:34:22.528Z user

<turn_aborted>
The user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.
</turn_aborted>

## 2026-07-25T15:34:39.538Z user

有没有可能是可以自动帮用户安装ollama，然后自动拉取一个embed模型这样嘛？可以先检测本机的ollama，如果没有就安装，如果有就拉取模型，可以做成一个按钮啥的都行；看看你怎么设计

## 2026-07-25T15:37:50.743Z assistant

可以做成「一键启用」而不是静默安装。先摸清桌面端能力与现有 Ollama 探测点，再给出可落地的设计与实现。

## 2026-07-25T15:40:59.793Z assistant

设计为「用户点击一键启用」：先检测，再按需安装/拉模型，不在启动时静默安装。开始落地后端能力与设置页按钮。

## 2026-07-25T16:02:55.333Z assistant

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

## 2026-07-25T16:12:21.297Z user

<environment_context>
<current_date>2026-07-26</current_date>
<timezone>Asia/Shanghai</timezone>
<filesystem><workspace_roots><root>E:\AImoney\NovaWay-Matrix\novaway-coder</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry><entry access="write"><path>E:\AImoney\NovaWay-Matrix\novaway-coder</path></entry><entry access="write"><special>:slash_tmp</special></entry><entry access="write"><special>:tmpdir</special></entry><entry access="read"><path>E:\AImoney\NovaWay-Matrix\novaway-coder\.git</path></entry><entry access="read"><path>E:\AImoney\NovaWay-Matrix\novaway-coder\.agents</path></entry><entry access="read"><path>E:\AImoney\NovaWay-Matrix\novaway-coder\.codex</path></entry></file_system></permission_profile></filesystem>
</environment_context>

## 2026-07-25T16:12:21.442Z user

<image name=[Image #1] path="C:\Users\13428\AppData\Local\Temp\codex-clipboard-KB56EH.png">
</image>
<image name=[Image #2] path="C:\Users\13428\AppData\Local\Temp\codex-clipboard-3AIEtq.png">
</image>
<image name=[Image #3] path="C:\Users\13428\AppData\Local\Temp\codex-clipboard-4w0SLn.png">
</image>
[Image #1]如图，我点击了一下自动(推荐),然后报错了；然后当前状态那里为什么是这么多问号？
[Image #2]如图2这个又是什么情况？
[Image #3]如图3，这下面怎么页这么多问号？

## 2026-07-25T16:13:07.993Z assistant

先查「自动」模式报错和界面问号乱码的根因，再一并修掉。

## 2026-07-26T05:08:35.301Z user

继续

## 2026-07-26T06:01:39.485Z user

<turn_aborted>
The user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.
</turn_aborted>

## 2026-07-26T06:30:25.973Z user

继续

## 2026-07-26T07:41:39.747Z user

<turn_aborted>
The user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.
</turn_aborted>

## 2026-07-26T07:57:14.418Z user

继续

## 2026-07-26T08:43:04.099Z user

<turn_aborted>
The user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.
</turn_aborted>

## 2026-07-26T13:20:09.555Z user

继续
