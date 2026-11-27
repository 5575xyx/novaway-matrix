# AI 专家团队产品调研

> 调研日期：2026-11-24
> 
> 目的：研究 WorkBuddy、Qoder 的专家团队 / 多 Agent 任务交互，为 NovaWay 团队页和任务入口改造提供依据。

## 一、结论摘要

WorkBuddy 和 Qoder 都没有把用户的主要任务入口做成「先管理 Agent、再配置 Assignment」的后台页面。它们更强调：

```text
用户表达目标
  → 系统规划和选择执行方式
  → 专家或 Agent 并行工作
  → 用户在关键节点介入
  → 交付报告、变更和可验证结果
```

Qoder 更明确地把复杂任务产品化为独立的 Experts / Quest 模式；WorkBuddy 更强调一句话输入、自动规划、多 Agent 并行和最终办公产物。两者都把编排细节放在任务过程或详情里，而不是放在用户的第一步。

NovaWay 应采用混合方案：

- 默认体验接近 Claude Code：对话优先，用户先说目标；
- 复杂任务体验接近 Qoder Experts：显示计划、阶段、并行进度和任务报告；
- 产物体验接近 WorkBuddy：以最终文件、报告、表格、演示文稿等交付物为中心；
- TeamRun、Assignment、Verification、Ledger、OpLog 继续作为内部生产级运行模型。

## 二、WorkBuddy 调研

### 公开定位

WorkBuddy 官网公开描述的核心入口是：

- 用一句话描述任务；
- 基于用户选择的文件夹读取 PDF、Word、Excel 和图片；
- 生成 Word、Excel、PowerPoint、PDF 或 Markdown 交付物；
- 支持 CSV / 表格分析和图表生成；
- 支持多 Agent 并行工作；
- 高风险操作可以暂停并请求确认；
- 支持定时任务、远程消息触发、Skills 和 MCP 扩展。

官网：<https://www.workbuddy.ai/>

### 交互启示

WorkBuddy 的公开产品定位没有要求用户先选择专家。它将复杂度放在系统内部，用户看到的是：

```text
一句话任务
  → 读取本地材料
  → 自动规划和执行
  → 生成最终办公交付物
```

因此 NovaWay 不应把「选团队、填验收、填预算、看派工」作为第一步。团队和员工选择应该是可选的执行偏好，而不是任务创建表单。

### 可借鉴点

1. **目标先于角色**：用户首先描述要完成的工作，不先配置 Agent。
2. **文件夹是自然上下文**：参考文件、目录和工作区应成为对话输入的一部分。
3. **产物优先**：用户最终关心报告、代码、表格、演示文稿和修改后的文件。
4. **风险按需介入**：只有高风险操作暂停等待确认，普通过程不打断用户。
5. **多 Agent 默认隐藏**：并行执行是能力，不是用户必须操作的管理对象。

## 三、Qoder 调研

### 1. Experts Mode

官方文章：

- <https://qoder.com/blog/experts-mode>
- <https://qoder.com/blog/experts-mode-tech>
- <https://qoder.com/blog/qoder-case-experts>

Qoder 官方将 Experts Mode 描述为面向复杂开发任务的多 Agent 协作能力：用户描述需求，系统自动拆解任务、组建专家团队，并行执行方案设计、编码和验证。

它强调的不是简单复制多个 Agent，而是：

- 明确的专业分工；
- Team Lead / Experts Leader 统一协调；
- 异步并行调度；
- 研究、编码、测试、审查和验证等不同角色；
- 统一汇总和闭环质量保证。

公开文章中的专家团队结构大致是：

```text
Experts Leader
  ├── Research Expert
  ├── Coding Expert
  ├── QA Expert
  ├── Code Review Expert
  └── Verification Expert
```

文章还明确描述了 Leader、Inbox、Task System、Output Files 之间的关系：专家完成工作后回传消息，Leader 消费消息、评估状态、决定下一步派工或回复用户。

### 2. Qoder 的用户角色

Qoder 将用户角色从「逐行指导 Agent 的程序员」提升为：

- 定义问题；
- 审核计划；
- 做关键决策；
- 验证结果；
- 同时管理多个任务。

这和 NovaWay 的产品目标高度一致。用户不是管理每一个 Agent，而是管理目标和交付结果。

### 3. Experts Mode 的界面方式

公开截图显示 Qoder 在产品级入口上提供模式选择：

```text
Experts
Agent
Ask
```

这说明它不是把「专家团」做成一个复杂的组织管理页面，而是把它当成一种任务执行模式。

对 NovaWay 的启示：

```text
自动执行 / 专家团 / 单个专家 / 普通对话
```

应该成为输入框附近的轻量执行模式，而不是团队管理页上的一堆内部选项。

### 4. Quest Mode

官方文章：

- <https://qoder.com/blog/quest-mode>
- <https://qoder.com/blog/quest-remote>

Qoder Quest 更像长任务和异步交付中心。公开截图和说明显示：

- 左侧有 Quest 任务列表；
- 任务分为 In Progress 和 History；
- 有任务搜索；
- 中间区域是当前任务；
- 新任务入口只有一个目标输入框；
- 支持 Add Context；
- 可以选择 Write Spec First 或 Execute Directly；
- 任务顶部显示 Design → Action Flow → Task Report；
- 执行过程中显示计划和动作列表；
- 完成后展示 Summary、Verification 和 Changes；
- 任务可以在后台运行，用户稍后回来查看结果。

Qoder Remote 进一步强调：

- 任务可以交给云端 Agent；
- 用户可以实时查看步骤、障碍和处理方式；
- 遇到无法自动解决的问题时暂停并通知用户；
- 最终交付综合报告、代码变更并提交 Pull Request。

### 可借鉴点

Qoder 的核心不是「让用户看到更多 Agent」，而是把复杂执行包装成一个可追踪的任务对象：

```text
Task
  ├── Design
  ├── Action Flow
  ├── Progress
  ├── User Intervention
  └── Task Report
```

这比 NovaWay 当前直接展示 TeamRun、Assignment、Verification 更适合用户。

## 四、竞品交互模型对比

| 维度 | WorkBuddy | Qoder Experts / Quest | NovaWay 应采用 |
| --- | --- | --- | --- |
| 第一入口 | 一句话任务 | New Task / 对话输入 | 对话输入 |
| 是否先选 Agent | 通常不需要 | Experts 是一种模式 | 默认自动选择 |
| 复杂任务 | 自动规划并行 | Design → Action Flow → Report | Plan → Work → Review → Deliver |
| 并行协作 | 多 Agent 并行 | Experts Leader 统一协调 | Orchestrator 统一协调 |
| 用户介入 | 高风险操作 | 计划、障碍、结果 | 决策卡片、权限、风险和验收 |
| 任务列表 | 隐藏在工作流中 | In Progress / History | 进行中 / 需要处理 / 历史 |
| 结果展示 | 报告和办公文件 | Summary / Verification / Changes | 结果摘要 / 验收 / 产物 |
| 内部日志 | 不作为主界面 | 详情中查看 | 执行详情中查看 |
| 长任务 | 后台执行 | Quest / Remote | Mission / TeamRun |

## 五、NovaWay 当前问题

### 当前团队页的问题

当前页面更接近内部运营控制台：

- 运行列表和任务工作台混在一起；
- 用户第一眼看到的是状态、阶段和验收，而不是专家能力；
- 新建任务入口仍然容易引导用户进入表单；
- 团队和员工的产品含义没有被清晰展示；
- 专家团、专家、任务运行、组织管理没有分层；
- 内部编排对象露出过多。

### 与 Qoder Quest 的主要差距

NovaWay 已经拥有不少底层能力，但界面缺少 Qoder Quest 的任务叙事：

```text
当前：Run / Phase / Assignment / Verification
目标：Design / Work / Review / Report
```

不是删除底层对象，而是需要在用户层重新投影。

## 六、NovaWay 改造建议

### 1. 团队页改名为“专家中心”

默认页面不再是任务工作台，而是：

```text
专家中心

[自动帮我选择] [搜索专家或专家团]
```

页面分为：

- 推荐专家团；
- 专家；
- 最近使用；
- 我的任务；
- 管理。

### 2. 专家团卡片

卡片只展示用户决策需要的信息：

```text
产品研发专家团
从需求分析到实现、测试和交付

产品分析 · 设计 · 前端 · 后端 · 测试

[开始对话] [查看详情]
```

不直接展示：

- Assignment 数量；
- dispatchID；
- attempt；
- lease；
- Ledger；
- worktree。

### 3. 专家卡片

```text
前端开发专家
擅长 React、SolidJS、TypeScript 和交互实现

[开始对话]
```

员工和 Agent 的内部 ID、Prompt、模型配置放到管理页。

### 4. 专家团详情

详情页展示：

- 专家团能解决什么问题；
- 推荐使用场景；
- 包含哪些专家；
- 并行方式；
- 最终交付形式；
- 最近任务和交付结果；
- 开始对话。

### 5. 任务中心参考 Quest

将当前任务工作台重构为“我的任务”：

```text
我的任务
[搜索任务]

进行中
- 正在分析竞品需求
- 正在实现登录流程

需要我处理
- 等待确认外部操作
- 需要补充参考资料

历史
- 已完成的任务
- 部分完成的任务
```

主任务区采用：

```text
目标标题
Design ─── Work ─── Review ─── Report

当前计划 / 当前动作 / 用户决策 / 产物
```

### 6. 新任务输入参考 Qoder Quest

输入框只保留：

```text
[+ 添加上下文]

描述你想完成的事情……

[先写计划 ▼]                         [发送]
```

模式可以是：

- 自动执行；
- 先写计划；
- 直接执行。

高级选项折叠：

- 选择专家或专家团；
- 参考文件；
- 范围；
- 约束；
- 权限和预算。

### 7. 任务报告参考 Qoder

完成后不首先展示内部日志，而是展示：

```text
任务已完成

摘要
实现了什么、解决了什么问题

验证
✓ 类型检查
✓ 单元测试
✓ 产物检查

变更
6 个文件发生变化

交付物
- 设计文档
- 源代码
- 测试结果

[继续修改] [查看详细执行过程]
```

## 七、建议的改造顺序

### 阶段 A：专家中心信息架构

- 团队页改为专家中心；
- 专家团卡片；
- 专家卡片；
- 开始对话；
- 管理入口隐藏到二级页面。

### 阶段 B：Quest 风格任务中心

- 左侧进行中 / 历史任务列表；
- 搜索任务；
- Design / Work / Review / Report 阶段条；
- 任务详情与产物报告；
- 需要用户处理的任务单独分组。

### 阶段 C：专家团运行透明度

- 默认只显示摘要；
- 可展开专家团进度；
- 可展开具体工作步骤；
- 需要时查看 Assignment、Verification 和事件流；
- 保留暂停、恢复、重试和审计能力。

### 阶段 D：异步和后台任务

- 任务后台执行；
- 状态变化通知；
- 用户离开页面后继续执行；
- 失败或阻塞时通知；
- 回到任务后继续提供材料或调整方向。

## 八、最终产品方向

NovaWay 不应继续把自己包装成“团队运行监控后台”，而应成为：

> 用户只需要描述目标，系统自动组织专家完成工作，并用任务报告和真实产物交付结果的 AI 工作平台。

最终组合为：

```text
WorkBuddy：一句话目标 + 产物交付
Qoder Experts：专家团 + 并行协作 + Leader
Qoder Quest：任务列表 + 计划阶段 + Task Report
Claude Code：对话优先 + 工具和 Agent 默认隐藏
NovaWay：生产级编排、验证、审计、暂停恢复和产物工作区
```
