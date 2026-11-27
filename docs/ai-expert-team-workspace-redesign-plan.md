# NovaWay 专家团队工作区改造计划

版本：v1.0
日期：2026-11-24
状态：专家中心范围完成；全仓库最终验收待完成（2026-11-24）

## 1. 目标

将当前偏内部运行控制台的团队页面，改造成接近 Claude Code、WorkBuddy、Qoder Experts / Quest 的对话优先专家协作工作区。

NovaWay 已经具备 TeamRun、RunTeam、Assignment、Acceptance、Verification、Ledger、OpLog、Worktree、Merge、Artifact、暂停、恢复、重试和通知等生产级能力。本计划不删除这些底层能力，而是增加用户层产品投影：

用户描述目标 → 主助手理解任务 → 自动选择专家或专家团 → 计划和执行 → 必要时请求用户决定 → 汇总、验证并交付真实产物。

产品最终定位：一个以对话为入口、以专家协作为执行方式、以验证产物为交付结果，并具备生产级审计和恢复能力的 AI 工作平台。

## 2. 调研依据

### Claude Code

用户先描述目标，主 Agent 决定是否使用工具、计划或子 Agent。用户默认不需要选择团队，编排细节只有在复杂任务、风险操作或主动查看时展开。

### WorkBuddy

公开官网强调一句话任务、使用用户文件夹和材料、多 Agent 并行、报告和办公文件交付、高风险操作确认、后台和定时任务。启示是目标优先、材料自然进入上下文、编排默认隐藏、产物是结果中心。

来源：https://www.workbuddy.ai/

### Qoder Experts

Qoder 将 Experts 作为任务执行模式，而不是组织管理页。用户描述需求，Experts Leader 自动拆解、安排研究、编码、测试、审查和验证专家并行工作。用户负责定义问题、审核计划和验证结果。

来源：
- https://qoder.com/blog/experts-mode
- https://qoder.com/blog/experts-mode-tech
- https://qoder.com/blog/qoder-case-experts

### Qoder Quest

Qoder Quest 提供任务列表、搜索、进行中和历史分组、New Task、Add Context、Write Spec First / Execute Directly、Design → Action Flow → Task Report、计划动作、进度、阻碍和最终 Summary / Verification / Changes。

来源：
- https://qoder.com/blog/quest-mode
- https://qoder.com/blog/quest-remote

### 综合结论

NovaWay 应采用：Claude Code 的对话优先、WorkBuddy 的一句话目标和产物交付、Qoder Experts 的专家团和 Leader、Qoder Quest 的任务工作区和报告，同时保留 NovaWay 的验证、审计、暂停、恢复、重试、Worktree 和真实产物能力。

## 3. 产品原则

1. 用户管理目标，不管理 Agent。
2. 先输入目标，再决定是否需要专家团。
3. 自动执行是默认模式，选择专家是可选偏好。
4. 计划只在复杂、长任务或高风险任务中出现。
5. 内部状态映射成用户能理解的状态。
6. 结果以 Summary、Verification、Changes 和 Artifact 为中心。
7. 阻塞必须转化为明确的用户决策卡片。
8. 权限、未知副作用和审计不能被简化入口绕过。
9. 历史任务和旧运行必须兼容。
10. 先做用户层垂直切片，再完善专家管理。

## 4. 目标信息架构

一级入口：

专家中心
  - 任务
  - 专家团
  - 专家
  - 管理

默认打开任务，不是组织图或运行详情。

### 4.1 任务视图

左侧任务分组：进行中、需要我处理、已完成、部分完成、失败或已取消、历史。支持搜索、状态筛选、最近排序、未读标记和需要我处理优先。

右侧显示当前任务：目标、阶段、计划、活动、决策、产物和报告。

### 4.2 专家团视图

展示用户可以选择的能力：

产品研发专家团
从需求分析到实现、测试和交付
产品 · 设计 · 前端 · 后端 · 测试
[开始对话] [查看详情]

卡片展示名称、定位、能力标签、适用场景、成员角色摘要、是否支持自动选择和最近交付。不展示 profileID、version、dispatchID、attempt、lease、worktree、内部 Prompt 和账本。

### 4.3 专家视图

展示单个员工或角色：

前端开发专家
React · SolidJS · TypeScript · UI 交互
适合实现页面、重构组件、修复前端问题和增加浏览器测试。
[开始对话]

内部 ID、Prompt、Model、Tier 和技能配置只在管理页展示。

### 4.4 管理视图

承载专家创建、编辑、归档，专家团创建和复制，团长、成员、职责、Auto、模型、权限、预算和版本管理。管理页不作为普通用户默认入口。

## 5. 核心流程

### 5.1 自动执行

新建任务 → 输入目标 → 默认自动执行 → 主助手判断复杂度 → 简单任务直接执行或复杂任务自动组建专家团 → 计划 → 并行工作 → 汇总验证 → 任务报告。

### 5.2 指定专家团

打开执行方式 → 搜索专家团 → 选择团队 → 输入目标 → 发送。不是运行创建表单，不要求用户填写 Assignment、预算或验收台账。

### 5.3 指定专家

选择单个专家 → 创建普通对话 → 专家直接处理。不强制创建多成员 TeamRun。

### 5.4 先写计划

输入复杂目标 → 生成 3 到 7 个用户可读步骤 → 开始执行、修改计划、补充材料或取消 → 批准后执行。

计划只显示目标、步骤、产物、风险和需要用户决定的事项。

### 5.5 用户介入

只在计划确认、缺少材料、方向调整、高风险操作、外部副作用、预算变化、部分完成后的下一步选择时打断用户。

统一显示：

需要你决定
缺少产品需求文档，是否继续按当前目标推断？
[补充材料] [按当前信息继续] [修改方向]

## 6. 用户层状态和阶段

| 内部状态 | 用户状态 | 文案 |
| --- | --- | --- |
| planning | planning | 正在制定计划 |
| awaiting_approval | needs-you | 等待你确认计划 |
| running | working | 专家正在工作 |
| blocked | needs-you | 需要你补充信息 |
| paused | paused | 任务已暂停 |
| needs_review | needs-you | 需要你核对一项结果 |
| done | completed | 已完成并验证 |
| partial | partial | 部分完成 |
| failed | failed | 执行失败 |
| exceeded | stopped | 已达到限制 |
| cancelled | cancelled | 已取消 |

默认阶段条：理解目标 → 制定计划 → 并行工作 → 汇总验证 → 交付结果。

Activity 只展示结构化摘要，例如“前端专家正在实现页面”，不默认展示原始命令、完整工具参数、敏感路径、Token、Cookie、凭据或未脱敏内部消息。

## 7. 输入框设计

默认输入框：

[+ 添加上下文]
描述你想完成的事情……
[自动执行 ▼] [先写计划 ▼] [发送]

上下文支持工作区文件、文件夹、当前 diff、图片、文档、URL、任务历史、已有 Artifact 和补充文本，以 chip 展示。

高级设置默认折叠，包含执行者、参考文件、范围、约束、交付格式、验收要求、权限模式、Token、墙钟、成本和 Mission。

简单任务直接执行，复杂任务自动生成计划，高风险任务计划和确认优先。最终策略仍由权限和风险系统约束。

## 8. 任务详情和报告

默认展示：目标、阶段条、当前一到三项活动、用户层计划、Decision、Artifact 和任务报告入口。

专家协作详情默认折叠，展开后才显示专家职责、Assignment、Attempt、Lease、Verification、事件、回放、指标和 Worktree。

最终报告：

摘要：完成了什么，解决了什么问题。
验证：类型检查、单元测试、产物检查以及未验证内容。
变更：修改了哪些文件。
交付物：设计文档、源代码、测试结果。
下一步：继续修改、合并、导出或创建后续任务。

Artifact 有真实路径时提供真实预览、编辑和导出；没有路径时只导出名称、版本和来源元数据。

## 9. 后端映射

内部真相继续使用 Mission、TeamRun、RunTeam、Assignment、Acceptance、Verification、Ledger、OpLog、Worktree、Merge 和 Event。

建议增加用户层投影：

export type ExpertCenterTaskView = {
  id: string
  goal: string
  state: planning | needs-you | working | paused | completed | partial | failed
  phase: understanding | planning | working | reviewing | delivering
  executor: { mode: auto | expert | team; name?: string; count?: number }
  nextAction?: { kind: string; label: string }
  summary?: string
  progress?: { completed: number; total: number }
  artifacts: ArtifactSummaryView[]
  updatedAt: number
}

export type ExpertTeamCardView = {
  id: string
  name: string
  description?: string
  capabilities: string[]
  scenarios: string[]
  memberCount: number
  memberPreview: Array<{ name: string; role: string }>
  autoEligible: boolean
  recommended?: boolean
}

第一阶段可复用现有接口并在前端投影，稳定后再增加：

GET  /expert-center/overview
GET  /expert-center/tasks
GET  /expert-center/tasks/:taskID
GET  /expert-center/teams
GET  /expert-center/teams/:teamID
GET  /expert-center/experts
POST /expert-center/tasks
POST /expert-center/tasks/:taskID/approve
POST /expert-center/tasks/:taskID/pause
POST /expert-center/tasks/:taskID/resume
POST /expert-center/tasks/:taskID/retry
POST /expert-center/tasks/:taskID/decisions/:decisionID

## 10. 前端改造清单

建议新增：

packages/app/src/components/expert-center.tsx
packages/app/src/components/expert-center-task-list.tsx
packages/app/src/components/expert-center-task.tsx
packages/app/src/components/expert-team-card.tsx
packages/app/src/components/expert-card.tsx
packages/app/src/components/expert-team-detail.tsx
packages/app/src/components/task-stage-bar.tsx
packages/app/src/components/task-report.tsx
packages/app/src/components/task-context-input.tsx
packages/app/src/components/task-decision-card.tsx

调整现有组件：

- team-workbench.tsx：改为任务视图兼容层，默认展示任务列表，不再把复杂新建运行表单作为入口。
- run-console.tsx：降级为执行详情，默认显示摘要、阶段、活动和产物，技术信息折叠。
- team-mode-select.tsx：保留自动执行、仅主助手和指定团队，增加专家 / 专家团分组、搜索、最近使用和收藏。
- prompt-input.tsx：统一执行方式、计划模式和上下文入口。
- notification.tsx：使用完成、部分完成、需要处理和失败等用户语言。

## 11. 安全和兼容

必须保留权限模式、写入确认、外部副作用确认、未知结果复核、计划版本校验、并发保护、合并锁、Worktree、Lease、OpLog、验收和独立验证。

“自动执行”只表示自动选择执行方式，不表示绕过权限和风险确认。

用户层和报告不得展示 API Key、Token、Cookie、密码、完整命令参数、未脱敏环境变量或可能包含凭据的工具原文，只展示结构化摘要。

旧 TeamRun 不迁移结构，只增加用户层投影。旧事件、验收、产物、暂停、恢复、重试和导出保持兼容。保留 /team 路由，默认显示新专家中心；旧运行详情通过任务详情或兼容路由打开。

增加功能开关：expert_center_workspace。开发环境和 E2E 默认开启，灰度后全量开启并保留回退入口。

不得覆盖其他会话的 Office、Pulse、语音、浏览器、E2E、桌面端和 packages/app/src/pages/session/file-tabs.tsx 改动，不使用 git add -A。

## 12. 测试计划

### 单元测试

覆盖状态映射、phase 映射、Decision、专家团和专家卡片投影、任务排序分组、自动执行默认值、计划和报告阶段、Artifact 真实路径规则和通知去重。

### 前端测试

覆盖只填目标、默认自动执行、选择专家、选择专家团、团队搜索、任务分组、阶段条、Decision、技术详情折叠、报告、产物和继续修改。

### HTTP 测试

覆盖专家团和专家目录、任务列表和详情、自动和指定执行、决策提交、暂停、恢复、局部重试、产物预览保存导出、未授权拒绝和并发控制。共享测试数据库的团队 HTTP 测试必须按文件串行执行。

### 浏览器 E2E

必须覆盖：

1. 自动执行：新建、只填写目标、计划、执行、报告和产物。
2. 指定专家团：搜索、选择、创建会话并验证执行偏好。
3. 指定专家：选择单个专家并验证普通对话。
4. 先写计划：修改计划、批准和执行。
5. 用户介入：补充材料、确认操作和继续执行。
6. 异步任务：离开页面、收到通知、回到任务。
7. 继续修改：从报告进入原会话。

### 生产回归

每个阶段至少运行应用 typecheck、后端 typecheck、SDK typecheck、production build、应用核心测试、编排核心测试、产物测试、文件 HTTP、团队 HTTP、浏览器 E2E 和 git diff --check。

## 13. 实施阶段

### 阶段 0：投影和状态基础

建立状态映射、用户层类型、文案表和兼容层。验收：类型和映射测试通过，现有测试无回归。

### 阶段 1：专家中心任务首页

交付专家中心壳、左侧任务分组、搜索、新建任务、旧任务打开和管理入口。验收：默认不进入复杂任务表单，任务列表和旧任务兼容。

### 阶段 2：对话式任务输入

交付 Add Context、自动执行、先写计划、直接执行、专家 / 专家团选择和高级设置。验收：只输入目标即可创建，默认自动执行，权限边界不变。

### 阶段 3：用户层执行过程

交付阶段条、当前活动、计划、Decision、专家进度和执行详情。验收：默认不展示 Assignment，阻塞和确认都有明确动作。

### 阶段 4：报告和产物

交付 Summary、Verification、Changes、Artifact 工作区、预览、保存、导出和继续修改。验收：结果中心从日志转为报告和真实产物，真实内容不被伪造。

### 阶段 5：异步任务和通知

交付后台继续执行、完成 / 部分完成 / 失败 / 阻塞通知、未读计数和通知跳转。验收：离开页面不影响任务，状态变化不重复通知，不泄漏敏感信息。

### 阶段 6：专家目录和管理

交付专家团卡片、专家卡片、详情、最近使用、收藏和独立管理页。验收：用户可按能力选择专家，管理不会破坏历史快照。

### 阶段 7：全面生产验收

完成应用、后端、SDK、HTTP、浏览器、并发、真实工作区和产物回归，确认无 P0 / P1 问题后才标记完成。

## 14. 性能和错误处理

任务列表只加载摘要；事件、回放、指标和 Assignment 按需加载；专家目录缓存；长列表分页或增量加载；轮询根据状态降频；产物按点击读取；二进制文件不默认加载。

目标：首屏可交互时间增加不超过 300ms，1000 条历史任务仍可搜索和滚动。

网络失败保留已加载数据并显示重试；创建失败显示用户语言；阻塞转为 Decision；部分完成不能显示成成功；产物读取失败不能生成虚假预览。

## 15. 验收标准

### 产品体验

- [x] 用户只输入一句目标即可创建任务。
- [x] 默认不需要选择团队。
- [x] 默认不需要填写验收、预算和范围。
- [x] 可以选择自动、专家或专家团。
- [x] 团队页默认是任务工作区。
- [x] 任务支持进行中、需要处理和历史。
- [x] 复杂任务显示计划和阶段。
- [x] 用户只在关键节点被打断。
- [x] 结果以报告和产物为中心。
- [x] 可以继续修改和导出。

### 编排能力

- [x] 主助手可自动选择专家团。
- [x] 专家团支持并行。
- [x] Leader 负责汇总和验证。
- [x] Assignment 依赖和快照一致。
- [x] 支持局部重试、暂停、恢复和后台执行。
- [x] 完成和阻塞可以通知用户。

### 安全和工程质量

- [x] 写入和高风险操作仍需权限。
- [x] 未知副作用仍需人工复核。
- [x] 计划版本和批准绑定。
- [x] Worktree、Merge 和审计不变。
- [x] 不泄漏凭据和敏感参数。
- [x] 应用、后端和 SDK typecheck 通过。
- [x] production build 通过。
- [x] 单元、HTTP、浏览器和并发回归通过。
- [x] git diff --check 通过。
- [x] 验收文档与实际结果一致。

## 16. 第一批垂直切片

第一批只做：专家中心任务首页 → Chat-first 新任务输入 → 自动执行默认值 → 任务列表分组 → 用户层阶段条 → Summary / Verification / Changes → 现有 RunConsole 作为执行详情。

第一批完成后用户已经能获得完整的新体验。专家卡片、专家团详情和管理页随后补齐。

第一批不做：删除旧工作台、重写整个组织管理系统、更换底层数据库模型、同时改造 Office、Pulse、语音和桌面端，或通过绕过权限实现自动完成。

## 17. 完成定义

当用户可以只描述目标，自动或指定专家执行，查看计划和阶段，只在必要时做决定，获得验证过的报告和真实产物，并继续对话修改结果；同时所有生产级测试、安全约束和兼容性验收通过后，本计划才可以标记为完成。

## 18. 实施记录（2026-11-24）

已完成第一批垂直切片的基础实现；以下条目是当时阶段记录，最终验收结果见文档末尾：

- `/team` 默认入口已通过 `ExpertCenter` 兼容入口展示专家中心任务视图；底层 `TeamWorkbench` 保留旧运行详情能力。
- 任务首页已增加任务搜索、用户层任务分组、专家团 / 专家导航入口和自动刷新。
- 已增加用户层状态与阶段映射：`planning`、`needs-you`、`working`、`paused`、`completed`、`partial`、`failed`，以及五段阶段条。
- 已增加用户层 `ExpertCenterTaskView` 投影类型、专家团卡片、专家卡片和完成任务的 Summary / Verification / Changes 报告区域。
- 对话框执行者选择已支持直接选择员工/专家，并通过现有 `employeeID` 会话字段提交；团队和自动执行保持兼容。
- 已增加状态投影单元测试，并通过应用全量单元测试、应用 typecheck、production build 和专家中心浏览器回归。

当时阶段的后续工作项已在最终验收记录中全部完成；在最终验收前不得标记完成。



### 最终验收记录（2026-11-24，专家中心范围）

专家中心垂直切片及其直接依赖的验收项已完成并通过：

- 对话框高级设置支持自动执行、指定专家团和直接指定专家；专家选择提交 `employeeID`，专家团选择提交 `teamID`，两者互斥，默认不选择执行者。
- 先写计划流程已覆盖：目标创建 → planning / Make a plan → 用户批准 → working；批准仍复用计划版本和预算校验。
- 专家中心动作 API 已完成并接入 SDK：创建、批准、暂停、恢复、重试和 Decision 处理均复用 RunService 状态机、事务和事件审计链。
- 末次后台通知浏览器验收覆盖 done、partial、failed、needs_review、blocked、首次轮询抑制、状态边沿去重、离开任务路由后继续轮询和 localStorage 持久化：与专家中心 E2E 合计 `6 passed`。
- Artifact 工作区已覆盖真实文本预览、文本保存、真实二进制 Base64 解码导出；二进制预览不显示编辑器，也不会调用文件写入接口；导出文件名使用真实路径名。
- 专家中心及相关 HTTP 回归按共享测试数据库串行执行：13 个 SDK / Team / TeamRun / File / Session 测试文件合计 `73 passed / 0 failed / 514 expect calls`；覆盖动作生命周期、员工归属、暂停并发 200 / 409、并行编排、预算、取消、冲突、合并、重启、返工、工具、文件和会话兼容性。
- 应用单元回归：`1266 passed / 0 failed / 5129 expect calls`；通知边沿逻辑新增 2 tests、18 expect calls 并通过。
- LSP、CORS 和 GitHub webhook 回归单独串行执行时均通过；应用与后端 typecheck、SDK 生成与同步、应用 production build、后端 production build smoke test 和 `git diff --check` 均通过。

全仓库最终生产回归尚未通过，不能据此把本计划标记为全仓库完成：

- 全量 Chromium 套件共 173 个测试，运行受 10 分钟上限终止；除专家中心相关测试外仍有 `plugin-file-previewer` 等既有浏览器回归失败。
- 全量后端 `bun test test` 运行受 10 分钟上限终止；在并行资源受限时仍出现 LSP、实例上下文、平台 WebView、插件市场等测试超时或失败。相关专家中心 HTTP 回归已经单独串行通过，但不能替代全量套件。

因此，第 17 节的“专家中心范围完成定义”成立，但“所有生产级测试和兼容性验收通过”的全仓库完成定义尚未成立。计划状态改为「专家中心范围完成；全仓库最终验收待完成」。


- 新增 `ExpertCenterTask` 用户层任务详情壳，阶段条、任务报告与 RunConsole 执行详情分层展示。
- 新增 `TaskDecisionCard`，将阻塞、确认、补充材料和复核统一成用户可理解的「需要你处理」入口，并可展开技术详情。
- 新增 `/expert-center/overview`、`/expert-center/tasks`、`/expert-center/tasks/:taskID`、`/expert-center/teams` 和 `/expert-center/experts` 投影接口。
- 已注册后端 API group、handler，并重新生成 OpenAPI 与 SDK；投影默认只返回结构化摘要，不返回凭据、完整命令或工具参数。
- 应用和后端 typecheck、SDK 生成、专家中心 E2E 均再次通过。

这些接口目前是只读投影，任务动作仍复用已有 `/run` 的批准、暂停、恢复、重试和合并控制链；这是第四批之前的历史状态，后续批次已补齐正式任务动作 API、真实任务报告字段、通知和 HTTP / 并发回归。

### 增量记录（2026-11-24，第三批）

- 任务详情报告已改为优先读取 `/expert-center/tasks/:taskID` 的真实投影。
- Verification 现在展示真实的通过、失败、未验证和过期数量；没有验收项时保持待验证，不伪造「已验证交付」。
- Changes / Artifact 报告从运行团队的 `artifactsOut` 提取结构化名称、版本和路径，不返回产物正文或敏感工具参数。
- 任务详情和任务列表在投影接口不可用时继续回退到现有 `/run` 兼容链路，保证旧服务版本可用。
- 组件测试 `156 pass`，专家中心浏览器 E2E `2 pass`，应用 / 后端 / SDK typecheck 继续通过。

`httpapi-sdk.test.ts` 当时出现的 fake-LLM 流程超时已通过延长该真实流式场景的测试窗口并增加空响应保护修复；最终全量结果见文档末尾。

### 增量记录（2026-11-24，第四批）

- 正式增加专家中心任务动作 API：创建、批准、暂停、恢复、重试和 Decision 处理。
- 动作 API 复用 `RunService` 的计划版本、预算、状态迁移、并发事务和运行事件机制；运行中的活动阶段不会被接口静默标记为暂停。
- 任务动作响应返回用户层任务摘要；完整 Verification、Changes 和 Artifact 信息继续通过任务详情投影按需读取。
- OpenAPI、SDK 和应用运行时 SDK 已同步更新，新增动作方法已可被前端使用。
- `httpapi-sdk.test.ts` 增加专家中心任务生命周期回归，当前结果为 `21 pass`、`0 fail`、`82 expect()`。
- 专家中心任务工作区已接入用户层动作 API：Chat-first 创建、批准、暂停、恢复和阻塞重试不再只依赖旧 `/run` 控制接口；普通会话仍保留兼容链路。
- 浏览器回归已覆盖上述新路径，专家中心 E2E 当前结果为 `2 passed`；应用组件测试为 `156 pass`。
- 应用、后端、SDK typecheck 通过，应用 production build 通过。



## 最终状态

**专家中心范围完成；全仓库最终验收待完成（2026-11-24）。**

末次专家中心验收证据：应用单元测试 1266 passed / 0 failed；专家中心及后台通知浏览器回归 6 passed；相关 HTTP / 编排回归 73 passed / 0 failed / 514 expect calls；Artifact、Assignment、Blocker、Failure、团队运行、重启和合并冲突回归通过；通知边沿单元回归 2 passed / 18 expect calls；LSP、CORS、GitHub webhook 相关回归单独串行通过；应用、后端和 SDK typecheck 通过；应用与后端 production build 通过；`git diff --check` 通过。

全仓库 Chromium 与后端套件仍存在超时及无关回归失败，故不能声称整份计划已经完成验收。

