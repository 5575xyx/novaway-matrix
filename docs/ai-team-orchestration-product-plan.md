# NovaWay 编排体验重构与生产化实施计划

> 版本：v1.0
>
> 参考重点：Claude Code Agent Teams
>
> 目标：将 NovaWay 从“编排控制台”重构为“目标驱动的 AI 任务工作台”，同时保留现有生产级编排、验证、预算、隔离和审计能力。

## 1. 项目背景与目标

NovaWay 当前已经具备较完整的编排底层能力：

- Mission；
- TeamRun；
- RunTeam；
- Assignment；
- Acceptance；
- Verification；
- Ledger；
- OpLog；
- 事件日志；
- 工作区隔离；
- 合并和重试；
- 预算与权限控制；
- 失败恢复。

但当前用户体验仍然偏向“后台调度控制台”，用户需要理解 TeamRun、Assignment、Verification 等内部对象，操作路径也更接近：

```text
创建团队 → 配置成员 → 创建运行 → 审批计划 → 查看派工 → 等待验证 → 合并结果
```

目标流程应调整为：

```text
输入目标 → 添加材料 → 自动澄清 → 生成计划 → 用户确认 → 团队执行 → 关键节点介入 → 交付产物 → 局部修改或继续执行
```

本次工作不应推翻现有编排引擎，而是增加一层面向用户的任务体验，将复杂的 Agent 协作能力隐藏在简单的任务工作台之后。

## 2. Claude Code Agent Teams 的借鉴范围

### 2.1 需要吸收的核心模型

Claude Code Agent Teams 的核心模型包括：

- Lead：主协调 Agent；
- Teammate：独立工作的成员 Agent；
- Shared Task List：共享任务列表；
- Direct Messaging：成员之间直接通信；
- Task Claim：成员认领任务；
- Parallel Work：互不依赖的任务并行执行；
- Shared Workspace：共享项目上下文；
- Team Lifecycle：创建、运行、暂停、停止；
- Lead Synthesis：主 Agent 汇总成员结果。

NovaWay 的对应关系：

| Claude Agent Teams  | NovaWay 内部模型          | NovaWay 用户界面 |
| ------------------- | ------------------------- | ---------------- |
| Lead                | Orchestrator / 主智能体   | 任务负责人       |
| Teammate            | RunTeam Member / Employee | 专业工作者       |
| Shared Task List    | Assignment 依赖图         | 工作步骤         |
| Direct Messaging    | Agent 内部消息            | 默认隐藏         |
| Task Claim          | Assignment claim          | 系统自动分配     |
| Parallel Work       | 并行 Assignment           | 多项工作同时进行 |
| Team Lifecycle      | TeamRun 生命周期          | 任务进度         |
| Lead Synthesis      | 汇总与验证                | 最终结果         |
| Teammate transcript | Agent 执行日志            | 高级详情         |
| Shutdown            | 停止团队                  | 停止任务         |

### 2.2 不应直接复制的部分

Claude Code Agent Teams 面向开发者和命令行用户，NovaWay 不应默认暴露以下概念：

- teammate；
- subagent；
- context window；
- session；
- pane；
- task claim；
- message routing；
- Agent transcript；
- Team shutdown；
- 内部任务 ID。

NovaWay 应将它们翻译为：

- 工作步骤；
- 当前进度；
- 结果预览；
- 需要确认的事项；
- 质量检查；
- 下一步动作。

原则是：底层采用 Agent Teams 类似的协作模型，上层必须完成一次业务语言翻译。

## 3. 总体产品架构

### 3.1 两层架构

#### 用户任务层

面向普通用户，默认展示：

- Task：用户任务；
- Goal：任务目标；
- Plan：用户可读计划；
- Step：工作步骤；
- Artifact：产物；
- Decision：等待用户决定；
- Review：质量检查；
- Activity：执行摘要。

#### 编排控制层

面向系统、高级用户和管理员，继续保留：

- Mission；
- TeamRun；
- RunTeam；
- Assignment；
- Acceptance；
- Verification；
- Ledger；
- OpLog；
- Event；
- Worktree；
- Merge state。

关系如下：

```text
Task
 ├── Mission
 ├── TeamRun
 │    ├── RunTeam
 │    ├── Assignment
 │    ├── Verification
 │    ├── Ledger
 │    └── Event
 └── Artifact Workspace
```

### 3.2 用户层任务实体

建议增加 `TaskWorkspace` 或 `UserTask` 作为 Mission 和 TeamRun 的外层聚合，不替换现有后端模型。

建议字段：

```ts
type UserTask = {
  id: string
  missionID?: string
  activeRunID?: string

  title: string
  goal: string
  mode: "quick" | "collaborative" | "controlled"

  status:
    | "draft"
    | "clarifying"
    | "planning"
    | "awaiting_confirmation"
    | "running"
    | "waiting_for_user"
    | "reviewing"
    | "completed"
    | "partially_completed"
    | "failed"
    | "paused"
    | "cancelled"

  progress?: number
  currentStepID?: string
  pendingDecisionID?: string

  createdAt: number
  updatedAt: number
  completedAt?: number
}
```

### 3.3 用户层工作步骤

```ts
type UserTaskStep = {
  id: string
  taskID: string
  title: string
  description?: string

  status: "pending" | "ready" | "running" | "completed" | "blocked" | "failed" | "skipped" | "needs_review"

  dependsOn: string[]
  progress?: number
  assignmentIDs: string[]
  artifactIDs: string[]
  verificationStatus?: "pending" | "passed" | "partial" | "failed"

  userAction?: {
    required: boolean
    type?: "choice" | "approval" | "input" | "upload"
    title?: string
  }
}
```

用户只看到 `UserTaskStep`，不直接看到 Assignment。

## 4. 目标用户流程

### 4.1 统一任务入口

首页核心入口改为：

> 你想完成什么？

支持：

- 自然语言目标；
- 文件上传；
- 文件夹或项目选择；
- 添加网页链接；
- 选择期望产物；
- 选择工作模式；
- 设置截止时间；
- 设置预算或自动执行权限。

不要求用户先选择 Team、Employee、Assignment 或 TeamRun。

### 4.2 自动识别和澄清

系统收到目标后判断：

- 任务是否明确；
- 是否缺少关键材料；
- 是否需要外部访问；
- 是否需要多个专业角色；
- 是否需要用户审批；
- 是否涉及高风险动作；
- 是否需要生成文件；
- 是否适合后台运行。

澄清分为：

1. 无需澄清：目标明确，直接生成计划；
2. 轻量澄清：只询问一至三个影响结果的关键问题；
3. 高风险澄清：涉及发布、删除、生产代码、外部写入或高额消耗时强制确认。

原则：只有影响最终结果或产生实际风险的问题，才询问用户。

### 4.3 用户可读计划

计划展示：

- 任务目标；
- 执行步骤；
- 最终产物；
- 预计耗时；
- 预计成本；
- 可能的限制；
- 需要用户确认的事项。

示例：

```text
任务目标
完成一份 AI 编程助手竞品分析报告。

执行计划
1. 收集和整理竞品资料
2. 对比任务入口和计划确认方式
3. 对比执行过程、用户干预和失败恢复
4. 对比产物、审查和导出能力
5. 分析 NovaWay 当前差距
6. 输出产品改造路线图

最终交付
- 中文竞品分析报告
- 竞品能力对照表
- NovaWay P0/P1/P2 改造建议
```

高级设置中再展示：

- 推荐员工；
- 并行策略；
- 预算估算；
- 工具权限；
- 验收标准；
- 验证方式。

### 4.4 团队自动组建

用户不手动配置团队。Orchestrator 根据任务自动生成内部团队，例如：

```text
主协调者
 ├── 研究员：收集资料
 ├── 分析员：建立能力对照
 ├── 产品专家：分析用户体验
 ├── 审查员：检查来源和结论
 └── 汇总者：生成最终报告
```

用户只需要看到：

> 已组建 5 个专业工作步骤，其中 3 个步骤将并行执行。

### 4.5 执行过程

执行页围绕“任务进展”设计：

顶部：

- 任务名称；
- 总体进度；
- 当前状态；
- 暂停；
- 停止；
- 是否需要用户操作。

主区域：

```text
✓ 收集任务资料
✓ 建立竞品范围
● 对比执行过程
○ 分析 NovaWay 差距
○ 生成最终报告
```

每个步骤可以展开查看：

- 正在做什么；
- 已完成什么；
- 使用了哪些材料；
- 当前结果摘要；
- 相关产物；
- 是否遇到问题。

### 4.6 用户干预

支持：

- 暂停任务；
- 继续任务；
- 修改方向；
- 重做步骤；
- 跳过步骤；
- 选择方案；
- 停止任务；
- 提供缺失材料。

不要求用户实时管理每一个 Agent，只在业务决策、高风险动作和关键输入缺失时打断用户。

### 4.7 产物交付

任务完成页不能只显示 `TeamRun completed`，必须显示：

- 最终产物；
- 结论摘要；
- 来源和证据；
- 质量检查；
- 未完成部分；
- 不确定项；
- 版本记录；
- 导出；
- 继续修改；
- 重新执行局部步骤。

## 5. 内部编排模型改造

### 5.1 Lead Orchestrator

主协调者负责：

- 理解用户目标；
- 生成计划；
- 拆分工作步骤；
- 创建和调整 Assignment；
- 维护依赖；
- 处理成员失败；
- 收集成员结果；
- 判断是否返工；
- 组织验证；
- 生成用户可读摘要；
- 交付最终产物。

### 5.2 Teammate / Employee

每个成员必须具有：

- 明确职责；
- 输入范围；
- 输出格式；
- 权限范围；
- 预算限制；
- 可访问资料；
- 退出条件；
- 验收条件。

成员报告必须包含：

```ts
type AssignmentReport = {
  assignmentID: string
  dispatchID: string
  attempt: number
  status: "succeeded" | "failed" | "blocked" | "needs_review"
  summary: string
  artifacts: ArtifactRef[]
  evidence: EvidenceRef[]
  blockers: Blocker[]
  confidence?: number
  verification?: VerificationResult
}
```

必须继续保持以下安全规则：

- 空对象不能默认为成功；
- 必须有显式状态；
- 必须有 assignmentID、dispatchID、attempt；
- 身份不一致时进入 needs_review；
- 报告不等于独立验证；
- 旧版 done 字段可以兼容但不能替代新格式。

### 5.3 Shared Task List

内部共享任务列表支持：

- pending；
- ready；
- claimed；
- running；
- completed；
- blocked；
- failed；
- needs_review；
- cancelled。

每个任务包含：

- 任务目标；
- 依赖；
- 当前负责人；
- 输入资料；
- 输出要求；
- 验收标准；
- 尝试次数；
- 最近错误；
- 相关产物；
- 是否允许重试。

### 5.4 Agent 内部通信

可以保留 Agent 直接通信，但必须满足：

- 消息关联 Assignment；
- 关键结论写入结构化报告；
- 不能只依赖聊天内容传递结果；
- 消息记录来源并可审计；
- 限制消息数量和 Token 预算；
- 防止成员无限循环讨论。

用户默认只看讨论摘要，高级详情才显示关键决策、分歧和最终采用方案。

### 5.5 主协调者汇总

汇总流程：

1. 收集结果；
2. 校验身份；
3. 检查证据；
4. 检测冲突；
5. 检查缺口；
6. 独立验证；
7. 判断返工；
8. 生成最终交付物。

冲突结果不能静默覆盖，必须显示依据、差异和处理方式。

## 6. 状态模型

### 6.1 用户任务状态

```text
draft
clarifying
planning
awaiting_confirmation
running
waiting_for_user
reviewing
completed
partially_completed
failed
paused
cancelled
```

### 6.2 内部运行状态

继续保留：

```text
planning
awaiting_approval
running
blocked
paused
needs_review
done
partial
failed
exceeded
cancelled
```

### 6.3 用户状态映射

| 内部状态          | 用户显示           |
| ----------------- | ------------------ |
| planning          | 正在制定执行方案   |
| awaiting_approval | 等待你确认执行计划 |
| running           | 正在执行           |
| blocked           | 需要你的帮助       |
| paused            | 任务已暂停         |
| needs_review      | 等待质量检查       |
| done              | 已完成             |
| partial           | 部分完成           |
| failed            | 执行失败           |
| exceeded          | 已达到预算限制     |
| cancelled         | 已停止             |

任何异常都必须进入可恢复状态，不能永久停留在 running。

## 7. 前端页面计划

### 7.1 任务首页

- 新建任务输入框；
- 最近任务；
- 运行中任务；
- 待处理任务；
- 模板入口；
- 常用任务类型。

不要把 TeamRun 作为首页一级入口。

### 7.2 计划页

- 目标摘要；
- 任务理解；
- 执行步骤；
- 产物预览；
- 风险提示；
- 预计耗时；
- 预计成本；
- 高级设置；
- 确认执行按钮。

操作：开始执行、修改计划、只执行选中步骤、进入严格控制模式。

### 7.3 执行页

- 任务标题；
- 总体进度；
- 当前步骤；
- 时间线；
- 产物预览；
- 用户待办；
- 暂停、继续、停止；
- 修改方向；
- 重试失败步骤；
- 高级详情。

### 7.4 用户决策页

不要展示“状态：blocked、原因：assignment blocked”，而应展示：

```text
需要你选择报告结构

A. 按竞品逐项分析
B. 按用户流程横向比较

你的选择将影响最终报告结构。
```

### 7.5 产物工作区

支持：

- 文件列表；
- 在线预览；
- 内容编辑；
- 来源查看；
- 版本查看；
- 质量报告；
- 局部重新生成；
- 重新验证；
- 导出；
- 分享；
- 从产物创建新任务。

### 7.6 高级编排详情

面向高级用户和管理员，显示：

- TeamRun；
- RunTeam；
- Assignment；
- 成员状态；
- Agent 消息；
- 工具调用；
- 预算；
- 验证；
- 合并；
- 工作区；
- 事件日志；
- 错误堆栈。

## 8. API 计划

### 8.1 用户任务

```text
POST   /tasks
GET    /tasks
GET    /tasks/:taskID
PATCH  /tasks/:taskID
DELETE /tasks/:taskID
```

### 8.2 计划

```text
POST   /tasks/:taskID/plan
PATCH  /tasks/:taskID/plan
POST   /tasks/:taskID/plan/confirm
POST   /tasks/:taskID/plan/reject
```

计划确认必须绑定：

- plan version；
- 用户身份；
- 确认时间；
- 预算快照；
- 权限快照；
- 任务输入版本。

### 8.3 执行控制

```text
POST /tasks/:taskID/start
POST /tasks/:taskID/pause
POST /tasks/:taskID/resume
POST /tasks/:taskID/stop
POST /tasks/:taskID/redirect
POST /tasks/:taskID/retry-step
POST /tasks/:taskID/skip-step
```

所有操作需要幂等键、当前状态校验、并发冲突处理和审计事件。

### 8.4 用户决策

```text
GET  /tasks/:taskID/decisions
POST /tasks/:taskID/decisions/:decisionID/resolve
```

### 8.5 产物

```text
GET  /tasks/:taskID/artifacts
GET  /artifacts/:artifactID
POST /artifacts/:artifactID/revise
POST /artifacts/:artifactID/regenerate
POST /artifacts/:artifactID/export
GET  /artifacts/:artifactID/versions
```

## 9. 安全、权限和成本

### 9.1 最小权限

每个成员和 Assignment 只获得完成当前步骤所需的权限：

- 文件读取；
- 文件写入；
- 网络访问；
- 外部连接器；
- 代码执行；
- 发布；
- 邮件；
- 数据库；
- 工具调用。

### 9.2 高风险动作审批

以下动作必须进入用户确认：

- 发布；
- 删除；
- 覆盖；
- 发送外部消息；
- 修改生产环境；
- 高额 API 消耗；
- 使用敏感资料；
- 访问未经授权的系统。

### 9.3 预算

继续保证：

- 调用前预占；
- 调用后结算；
- 失败时释放；
- 超额时停止；
- 并发更新不覆盖预算；
- 批准后的预算快照不能被执行中修改。

用户层显示预计成本和当前消耗，高级界面才显示 Ledger 细节。

### 9.4 外部操作幂等

继续保留 OpLog，记录：

- 操作 ID；
- 请求哈希；
- 当前状态；
- 成功结果；
- 失败原因；
- unknown 状态；
- 复核方法；
- 重试策略。

## 10. 验证和质量体系

### 10.1 计划质量

检查：

- 是否覆盖用户目标；
- 是否有明确交付物；
- 是否存在无效步骤；
- 是否存在循环依赖；
- 是否缺少必要输入；
- 是否超过预算；
- 是否存在高风险动作；
- 是否设置验收条件。

### 10.2 独立验证

验证：

- 完整性；
- 正确性；
- 来源；
- 结构；
- 格式；
- 业务要求；
- 风险；
- 未验证结论。

验证失败时优先触发局部返工，而不是直接让整个任务失败。

### 10.3 用户层质量显示

```text
质量检查
- 目标覆盖：通过
- 来源检查：通过
- 结构检查：通过
- 未验证结论：2 项
- 需要补充材料：1 项
```

## 11. 分阶段实施路线

### 阶段 0：产品和架构基线

交付物：

- 用户任务模型；
- 任务状态映射；
- 用户语言表；
- 页面信息架构；
- TeamRun 到 Task 的映射；
- Agent Teams 能力映射表；
- 事件分类方案；
- API 草案；
- 设计验收标准。

完成标准：明确用户层和控制层边界，不再把 TeamRun 作为默认入口。

### 阶段 1：统一任务入口

工作内容：

- 新建任务页面；
- 目标输入；
- 文件和链接添加；
- 产物类型选择；
- 三种执行模式；
- 草稿保存；
- 最近任务列表；
- TaskWorkspace 与 Mission 关联。

完成标准：用户不选择 Team、不填写 Assignment 也能创建和启动任务。

### 阶段 2：计划和澄清

工作内容：

- 任务理解；
- 澄清问题；
- 用户回答；
- 计划生成；
- 计划编辑；
- 计划版本；
- 计划确认和拒绝；
- 预算与权限预览。

完成标准：计划以用户语言展示，确认绑定版本，执行中不能篡改批准的计划和预算快照。

### 阶段 3：Lead 自动组队

工作内容：

- Lead Orchestrator；
- 成员选择；
- 工作步骤拆分；
- Assignment 创建；
- 依赖图；
- 并行调度；
- 成员上下文；
- 成员报告；
- 主协调者汇总。

完成标准：用户只输入目标即可完成复杂任务，系统能够自动拆分、并行、汇总和验证。

### 阶段 4：执行时间线和用户控制

工作内容：

- 用户级事件；
- 执行时间线；
- 进度聚合；
- 暂停和恢复；
- 停止；
- 重试步骤；
- 跳过步骤；
- 修改方向；
- 待用户决策；
- 后台通知。

完成标准：用户能知道当前进展、下一步和待处理事项，失败步骤可以单独重试。

### 阶段 5：产物工作区

工作内容：

- 产物列表；
- 预览；
- 版本；
- 编辑；
- 导出；
- 分享；
- 局部重新生成；
- 重新验证；
- 模板保存。

完成标准：任务完成后用户能直接得到可编辑、可审查、可导出的结果。

### 阶段 6：高级编排和诊断

工作内容：

- TeamRun 详情；
- Assignment 详情；
- Agent 消息；
- 工具调用；
- 预算；
- 验证；
- 合并；
- 工作区；
- 事件日志；
- 错误详情；
- 审计导出。

完成标准：高级用户和管理员能够完整追踪运行，普通用户默认不被内部字段干扰。

### 阶段 7：生产化稳定性

工作内容：

- 状态机并发测试；
- 审批竞争测试；
- 合并锁测试；
- 预算并发测试；
- 进程崩溃恢复；
- worker 迟到报告；
- 重复报告；
- 工具未知结果；
- HTTP 幂等；
- 长任务恢复；
- 测试数据库隔离；
- 类型检查和构建检查。

完成标准：所有异常进入可见终态，所有关键操作可恢复、可审计、不可被并发请求破坏。

## 12. 测试计划

### 12.1 完整用户流程

覆盖：

1. 创建任务；
2. 上传材料；
3. 生成计划；
4. 修改计划；
5. 确认计划；
6. 自动组建团队；
7. 并行执行；
8. 产生中间产物；
9. 请求用户决策；
10. 用户继续任务；
11. 某步骤失败；
12. 单独重试；
13. 完成验证；
14. 交付产物；
15. 局部修改；
16. 导出结果。

### 12.2 Agent 协作测试

覆盖：

- Lead 创建成员；
- 成员认领任务；
- 多成员并行；
- 成员间传递信息；
- 依赖任务等待；
- 成员失败；
- 成员超时；
- 重复报告；
- 身份不匹配；
- 主协调者汇总冲突；
- 团队停止；
- 团队恢复。

### 12.3 并发和一致性测试

覆盖：

- 并发状态迁移；
- 并发批准；
- 并发暂停和恢复；
- 并发重试；
- 并发合并；
- 重复 HTTP 请求；
- 重复事件；
- 数据库事务失败；
- 迟到报告；
- 旧 attempt 覆盖新 attempt。

### 12.4 前端体验测试

重点验证：

- 用户是否理解当前状态；
- 用户是否知道下一步；
- 用户是否能找到最终产物；
- 用户是否能恢复失败任务；
- 用户是否被内部概念干扰；
- 计划是否容易修改；
- 高级详情是否可发现但不打扰；
- 失败信息是否可操作。

## 13. 首个示范场景

建议以“AI 竞品分析任务”作为首个端到端样板。

内部团队：

- 资料研究员；
- 产品分析员；
- 用户体验分析员；
- 事实核查员；
- 报告汇总员。

完整流程：

1. 输入竞品分析目标；
2. 系统生成计划；
3. 用户确认范围；
4. 多个研究步骤并行；
5. 汇总结果；
6. 自动检查来源；
7. 发现冲突时请求用户决定；
8. 生成报告和对照表；
9. 用户修改某个章节；
10. 导出最终文档。

该场景可以同时验证 Lead、Teammate、Shared Task List、并行执行、成员报告、独立验证、用户决策、产物交付和局部重做。

## 14. 产品指标

### 14.1 任务创建

- 创建任务完成率；
- 首次创建耗时；
- 计划确认前退出率；
- 用户回答问题数量；
- 首次任务是否需要人工帮助。

### 14.2 执行

- 自动完成率；
- 部分完成率；
- 用户主动暂停率；
- 单步骤重试成功率；
- 异常进入终态比例；
- 长任务恢复成功率；
- 平均等待用户时间。

### 14.3 交付

- 产物生成成功率；
- 产物打开率；
- 产物导出率；
- 局部修改率；
- 后续任务创建率；
- 结果接受率。

最重要的体验指标：

> 用户是否能够在不理解内部编排模型的情况下完成复杂任务。

## 15. 最终产品原则

1. 用户管理目标，不管理 Agent；
2. 计划面向用户，调度面向系统；
3. 过程透明，但不展示无关噪音；
4. 只在关键决策处打断用户；
5. 产物比运行状态更重要；
6. 失败必须可以继续；
7. 复杂度隐藏，而不是删除；
8. 默认简单，复杂时逐步展开；
9. 内部状态必须可审计，用户状态必须可理解；
10. 任何运行都必须有明确的下一步动作。

## 16. 最终目标形态

```text
用户
  ↓
输入一个目标
  ↓
系统理解目标并生成计划
  ↓
用户确认关键事项
  ↓
Lead 自动组织多个专业 Agent
  ↓
Agent 按共享任务列表并行协作
  ↓
系统汇总、验证和返工
  ↓
用户在关键节点进行决策
  ↓
生成可编辑、可审查、可导出的产物
  ↓
用户继续修改、复用或创建后续任务
```

NovaWay 的目标不是展示更多 Agent，而是利用 Claude Agent Teams 的协作思想，把复杂的多 Agent 能力隐藏在一个简单、可控、可恢复的任务工作台后面。

实施优先级：

1. 统一任务入口；
2. 建立用户可读计划；
3. 引入 Lead 自动组队；
4. 将 Assignment 映射为用户工作步骤；
5. 重做执行时间线和待办决策；
6. 建立产物工作区；
7. 增加局部重试和局部重做；
8. 完善高级 Agent 详情和管理控制台。

## 17. 实施记录

### 2026-11-23：阶段 1 任务入口与交付展示

已完成：

- 工作台默认文案从“运行”调整为“任务”；
- 新建入口从“新建运行”调整为“新建任务”；
- 用户可以只填写任务目标，不再强制填写验收项；
- 未填写交付要求时，系统自动生成一条可见的基础目标检查；
- 执行团队选择移动到高级设置，默认由系统使用推荐团队；
- 高级设置增加参考文件 / 目录输入；
- 参考文件、范围和约束会写入运行 brief，并参与队长上下文；
- 执行计划默认展示“理解目标 → 并行工作 → 汇总检查 → 交付结果”，团队和成员信息折叠到执行详情；
- 运行完成后增加用户层“交付产物”卡片，展示产物名称和内容版本；
- 新增任务输入规范化工具及单元测试；
- 保留 TeamRun、Assignment、Verification、Ledger、OpLog 等内部对象，不改变其生产级约束。

本阶段验收结果：

- 应用类型检查：本轮任务工作台改动未产生新增类型错误；全量检查目前被其他会话修改的 `packages/app/src/pages/session/file-tabs.tsx` 语法错误阻断（TS1382、TS17002）；
- 应用构建：通过；
- 任务输入单元测试：4 pass；
- 既有应用相关单元测试：46 pass；
- 编排上下文、状态机和派工测试：28 pass；
- 未覆盖项：完整的浏览器端新建任务交互测试、后台任务通知、独立产物编辑工作区。

下一阶段：

- 将当前用户可读计划从“团队列表 + 验收列表”进一步提升为“目标 + 工作步骤 + 产物 + 风险”；
- 增加用户级待决策卡片，替代直接展示 blocked 等内部状态；
- 增加暂停、恢复、单步骤重试和任务方向修正的统一入口；
- 为交付产物补充预览、版本和继续编辑能力。

### 2026-11-23：阶段 2 用户控制、通知与验收基础

已完成：

- 新增 `POST /run/:runID/pause` 安全边界接口：派工已在执行时拒绝伪装为暂停，尚未产生执行副作用的运行可以暂停；暂停事件与状态更新原子写入；恢复复用现有 execute 接口。
- 重新生成 OpenAPI 与 JavaScript SDK，并同步应用使用的工作区 SDK，使 `sdk.client.run.pause` 类型与接口一致。
- 在用户层步骤详情提供“重试此步骤”：调用 Assignment retry 接口创建新的 attempt，保留 parentAssignmentID、dispatchID 和审计事件。
- 增加团队运行状态边沿通知：完成、部分完成、失败、阻塞和需要复核只在状态变化时通知，避免轮询重复提醒，并纳入项目未读计数。
- 交付产物卡片增加“继续修改”入口、来源团队/worktree 信息；支持安全的工作区相对路径，提供真实文本预览、文本保存修改和真实文件导出，缺少文件路径时只导出名称、版本和来源记录，不伪造产物正文。
- 待处理区域增加用户可读的“需要你处理”卡片，并提供补充材料、确认外部操作、核对工具副作用和重试步骤等动作。
- 增加暂停边界 HTTP 测试：awaiting_approval、无 phase 的 ready running、in-flight running、terminal 冲突均已覆盖。
- 增加任务工作台浏览器验收用例，覆盖团队入口、只填写目标、计划、决策卡片、产物工作区、审批、暂停和恢复。

验证结果：

- `packages/app` 相关任务改动类型检查：通过；当前全量检查仍被其他会话修改的 `packages/app/src/pages/session/file-tabs.tsx` JSX 语法错误阻断（TS17008、TS17002、TS1382），本轮未覆盖该文件。
- `packages/app` production build：此前在本轮任务改动后通过；当前重跑被其他会话修改的 `packages/app/src/pages/session/file-tabs.tsx` JSX 语法错误阻断（Babel parser 5186:73）。
- SDK typecheck：通过；
- 任务入口及应用回归测试：50 pass；
- 编排上下文、状态机、派工及暂停核心测试：30 pass；
- 团队 HTTP 编排回归：36 个测试通过（按文件串行执行，避免共享测试数据库互相干扰）；
- 浏览器端任务工作台验收：通过；使用真实页面和受控 API 夹具覆盖只填写目标、用户可读四步计划、待处理决策卡片、产物工作区、批准、暂停和恢复；同时确认此前失败来自无项目上下文，测试现已固定使用工作区路径。

仍待完成：

- 最终生产级回归验收；当前应用生产构建被其他会话对 `packages/app/src/pages/session/file-tabs.tsx` 的 JSX 语法错误阻断，不能覆盖该文件中的未提交工作。

### 2026-11-23：阶段 3 产物工作区与最终验收

已完成：

- 产物声明支持安全的工作区相对路径；绝对路径和目录穿越路径会在服务端被拒绝。
- 运行详情返回产物路径和来源 worktree。
- 产物工作区支持真实文本预览、直接编辑保存、二进制文件导出和继续修改。
- 文件写入 API 支持显式 directory/workspace 路由，编辑不会误写当前项目之外的目录。
- 无文件路径的逻辑产物只导出名称、版本和来源记录，不伪造正文。
- 浏览器验收覆盖目标输入、计划、决策卡片、产物预览、产物保存、产物导出、审批、暂停和恢复。

最终验收结果：

- 应用 typecheck：通过；
- 应用 production build：通过；
- SDK typecheck：通过；
- 后端 typecheck：通过；
- 应用核心回归：50 pass；
- 编排核心和产物回归：41 pass；
- 文件预览/写入 HTTP 回归：4 pass；
- 团队编排 HTTP 回归：36 pass，按文件串行执行；
- 任务工作台浏览器验收：1 pass；
- `git diff --check`：通过。

本计划验收完成。


### 2026-11-24：Chat-first / Claude Code 风格入口调整

根据实际使用反馈，将团队编排从“先进入任务工作台、填写运行表单”调整为对话优先：

- 新建入口直接创建普通会话，用户先在对话框描述目标；任务工作台保留为运行详情和监控页面。
- 对话框执行者选择器默认显示“自动执行”，新会话在存在可自动选择团队时自动写入 `teamMode: auto`，无需用户先打开下拉框。
- “不派发”改为“仅主助手”，避免把内部调度术语暴露给用户。
- 团队选择器增加搜索、最大高度和滚动限制，长团队列表不再撑满界面。
- 用户仍可显式指定团队；复杂任务和有副作用的操作继续保留计划、权限和人工确认边界。
- 后端 TeamRun、Assignment、Verification、Ledger、OpLog 等内部编排模型保持不变，执行详情继续提供审计、暂停、恢复、重试和产物能力。

本轮验证：

- 应用 typecheck：通过；
- 应用核心回归：50 pass；
- 应用 production build：通过。
