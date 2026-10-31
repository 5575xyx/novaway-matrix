# 生产级对齐方案：内核对齐 cc，桌面端对齐 ZCode

> 目标：把 NovaWay 打造成**生产级可用的 AI 编程 / 办公 Agent**。
> 方法：内核参考 cc（Claude Code 恢复版）的**行为语义与工程约束**；桌面端参考 ZCode 的**信息架构、交互模式与视觉系统**。
> 边界：只吸收模式与契约，不复制源码、提示词、常量或品牌资产。cc 的授权状态不明确，按 clean-room 处理。
>
> 评估快照：2026-10-27。上游证据来自 ZCode `main` 源码压缩包与 cc 本地源码；NovaWay 证据来自本仓库当前工作树。

---

## 0. 执行摘要

1. **不建议重写，也不建议“照着两边抄一遍”。** 我们已经有完整骨架：内核 130k LOC、桌面端 109k LOC、300+ HTTP 端点、约 80 个工具、366 个后端测试文件、124 个前端测试文件。真正缺的是**闭环、强制点、可验证性和交互细节**。
2. **内核和 cc 的差距比预想小。** 我们已经有 `Tool.Capabilities`、4 种权限模式、23 个 cc 兼容 hook 事件、压缩与预算、子 Agent / 任务板 / 邮箱、ACP、headless server、SDK、重试与 fallback 骨架。差距集中在：
   - 能力声明只覆盖少数工具，执行器没有把 `readOnly / destructive / interrupt / maxResultBytes` 全部用起来；
   - 权限只有“规则求值 + 模式”，缺规则来源分层、拒绝追踪、shadowed rule 提示、审计与异步审批；
   - 压缩有实现，但缺统一 compact boundary、microcompact、reactive compact 与 UI 投影；
   - 任务 / 子 Agent 有工具，但没有统一 Task Registry 与状态机来驱动 UI、恢复和取消。
3. **桌面端和 ZCode 的差距主要在“最后一公里”。** 我们已经吸收了 `text-ui-*` 字号体系、A1 卡片语言、TurnFold、Turn Navigator、状态面板、Side Pane 多标签、queue/guide、工作区圆角等模式。还缺：
   - Command Center（`Cmd+K`）的范围页签、最近变更、最近任务与稳定行身份；
   - Side Pane 完整视图（`⇧⌘F`）与浮动输入；
   - 严格快捷键内核（IME / repeat / `event.code` / 冲突检测 / 录制）；
   - Sidebar 的 projects / grouped / timeline 视图与 running-layer 排序；
   - 工具渲染器注册表、状态面板 section 契约、设置页搜索；
   - 生产级性能门禁与跨平台 e2e。
4. **最高杠杆的 8 个动作**：
   1. 把 `Tool.Capabilities` 变成**全量声明 + 执行器强制 + UI 投影**；
   2. 权限管线补齐**规则来源、拒绝追踪、审计、异步审批**；
   3. 压缩补齐**边界消息、microcompact、reactive compact、后置文件回挂**；
   4. 建**统一 Task Registry**，让子 Agent / 后台任务 / 终端任务共用一套状态机；
   5. 把 `dialog-select-file` 升级为**Command Center**；
   6. 实现 Side Pane **Full View + 浮动输入**；
   7. 把快捷键从 `event.key` 升级为**事件码内核 + 冲突检测 + 录制**；
   8. 建**生产级门禁**：golden transcript、权限矩阵、崩溃恢复、性能预算、三平台 e2e。
5. **投入估算**：内核 12–18 人周，桌面端 10–16 人周，生产级门禁 4–6 人周；A/B 类合计 **26–40 人周**。2–3 人并行约 **10–14 周**。只做 P0/P1 的话，**5–7 周**可以形成可发布版本。
6. **但这只到 L1（内部日用），不等于“生产级可用”。** 本文的 A/B 解决“主路径闭环 + 交互完成度”；生产事故主要来自另外六类：模型在真实任务上的表现、外部输入与执行边界、分发链路、诊断能力、差异化管道可靠性、数据耐久。这六类见配套文档 `docs/production-readiness-gates.md`（C1–C7），另需 **16–26 人周**，达到 L2 约需 8–10 周（3 人），达到 L3 约需 14–19 周。
7. **不要做的事**：不要引入 cc 的遥测 / GrowthBook / OAuth / remote session / teleport / bridge / marketplace / 自动更新后端；不要引入 ZCode 的云端套餐、手机远控、bot、官方市场等产品面；不要为了“架构漂亮”把 3k 行组件拆成 30 层抽象。

---

## 1. 评估口径与法务边界

### 1.1 什么叫“生产级”

| 维度     | 生产级标准                                                        |
| -------- | ----------------------------------------------------------------- |
| 功能完整 | 主路径、异常路径、取消路径、恢复路径都能走通                      |
| 行为一致 | 同一操作在 TUI / Web / Desktop / SDK 语义一致，不因入口不同而分叉 |
| 可验证   | 每个关键行为有单测 / 集成测试 / e2e / golden trace，而不是靠手点  |
| 可观测   | 结构化日志、trace id、turn 级指标、错误分类；默认不外发           |
| 可恢复   | 进程崩溃、断网、模型 5xx、权限挂起后能恢复或安全失败              |
| 性能     | 首屏、流式、万行时间线、内存、包体有预算并纳入 CI                 |
| 安全     | 路径包含、命令执行、MCP 信任、凭据脱敏、权限审计                  |
| 可维护   | 单一写入口、契约文档、无重复状态源、可回滚迁移                    |

### 1.2 法务与 clean-room

- **ZCode**：Apache-2.0。可以借鉴架构与交互，复制代码时需保留 NOTICE / 第三方声明。本文建议只吸收模式，不直接搬运组件。
- **cc**：恢复版源码，授权状态不明确。**只参考行为、状态机、错误语义和测试思路；不复制源码、提示词、常量、品牌文案。** 需要时由未接触 cc 源码的人按行为规格重写。
- **本文档本身**：只记录“要做什么、验收什么”，不嵌入上游大段实现。

### 1.3 评估方法

1. 用户是否感知得到？感知不到就不优先。
2. 不做会不会导致数据损坏 / 安全问题 / 无法恢复？会，则 P0。
3. 是否已有 60% 骨架？有，则做“补齐”而不是“新建”。
4. 是否能用一个测试锁住？不能，则先补契约与观测点。

---

## 2. 三方基线

### 2.1 NovaWay 当前基线

| 层       | 现状                                                                                                                                                                 | 证据                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 内核     | Effect v4 + Drizzle/SQLite；session / tool / permission / hook / compaction / task / team 均有实现                                                                   | `packages/novaway/src/{session,tool,permission,hook,team}`                                |
| 工具     | 约 80 个工具目录；`Tool.Capabilities` 已定义 readOnly / concurrencySafe / destructive / maxResultBytes / validateInput / checkPermissions / interrupt / deferLoading | `packages/novaway/src/tool/tool.ts`                                                       |
| 权限     | 4 种模式；规则 last-match；bash arity；plan 白名单；pending Deferred；PermissionDenied hook                                                                          | `packages/novaway/src/permission/*`                                                       |
| Hooks    | 23 个 cc 兼容事件；command / http / prompt / agent 四类 hook；插件桥接                                                                                               | `packages/novaway/src/hook/schema.ts`、`hook/service.ts`                                  |
| 压缩     | 自动压缩、预算、保留最近轮次、压缩重试、post-compact 文件回挂                                                                                                        | `packages/novaway/src/session/compaction.ts`                                              |
| 子 Agent | task / task_status / task_stop / team / mailbox；后台任务与 worktree 隔离                                                                                            | `packages/novaway/src/tool/agent_task.ts`、`team/*`                                       |
| 对外接口 | HttpApi 300+ 端点 / 42 组；ACP；headless server；JS SDK                                                                                                              | `server/routes/instance/httpapi/groups/*`、`acp/*`、`cli/cmd/serve.ts`、`packages/sdk/js` |
| 桌面端   | SolidJS + Vite；会话时间线、Side Pane、状态面板、Composer、Git、终端、Office 预览                                                                                    | `packages/app/src/pages/session/*`                                                        |
| 设计系统 | `text-ui-*` 字号、语义色、A1 卡片、ZCode 风格圆角与面板                                                                                                              | `packages/app/src/index.css`、`utils/workspace-chrome.ts`、`packages/ui`                  |
| 测试     | 后端 366 文件；前端 124 文件；Playwright e2e                                                                                                                         | `packages/novaway/test`、`packages/app`                                                   |

### 2.2 cc 内核的强项

| 强项            | 具体表现                                                                                                                                 | 决策                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 流式工具循环    | 单轮内多 step、流式工具执行、并发只读 / 串行写入、孤儿消息 tombstone                                                                     | 要                               |
| Tool 契约       | `isConcurrencySafe` / `isReadOnly` / `isDestructive` / `checkPermissions` / `validateInput` / `maxResultSizeChars` / `interruptBehavior` | 要，且要全量落地                 |
| 权限体系        | 模式矩阵、规则来源分层、bash AST 分类、拒绝追踪、shadowed rule、plan 模式、异步审批                                                      | 要                               |
| Hooks           | 生命周期完整、可阻断、可改输入、可追加上下文、超时与失败语义清楚                                                                         | 已有大半，补强制点               |
| 压缩            | auto / micro / reactive、compact boundary、预算、后置文件回挂、摘要模板                                                                  | 已有大半，补边界与 UI            |
| 子 Agent / 任务 | 父会话、后台任务、邮箱、取消、结果投递、teammate                                                                                         | 已有工具，补统一注册表           |
| 会话生命周期    | resume / fork / revert / checkpoint / 归档 / 分享                                                                                        | 已有，补崩溃恢复                 |
| 无头 / SDK      | `--print`、stream-json、SDK、ACP、权限回调                                                                                               | 已有 ACP/SDK，补 headless 等价面 |
| 错误与重试      | 错误分类、Retry-After、fallback model、thinking block 清理                                                                               | 已有骨架，补 fallback 与分类     |
| 测试            | cassette、golden、权限矩阵、跨平台                                                                                                       | 学方法，不抄实现                 |

### 2.3 ZCode 桌面端的强项

| 强项           | 具体表现                                                                                                  | 决策                      |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| 工作区壳层     | 侧栏 + Header + 会话/Browser + 底部终端；4px 可拖拽间隙；自动收起阈值                                     | 要                        |
| 侧栏信息架构   | workspace → task 两级；projects / grouped / timeline 三视图；running-layer 排序；未读；置顶 / 归档 / 移动 | 要                        |
| Composer       | 左模型/思考/用量，右停止/发送；底部模式切换 + CUA + 后台任务；按优先级渐进折叠                            | 要                        |
| 时间线         | 行 → 轮次渲染单元；work segment；“已工作 N 秒”折叠；运行/中断/失败强制展开                                | 已有 TurnFold，补统一模型 |
| 工具渲染       | 按工具家族注册渲染器；内联 diff；execute 分组；changes 分组；子 Agent 下钻                                | 要                        |
| 状态面板       | 分区、`hasContent`、首次自动展开、todo 聚焦窗口、运行中取消                                               | 已有，补契约              |
| Side Pane      | tabs + activeTabId；单例 diff；多 Browser；Code Viewer；最近关闭；完整视图                                | 部分已有，补 Full View    |
| Command Center | `Cmd+K`；All / Actions / Tasks / Files 范围；最近变更 / 最近任务；`> # @` 前缀                            | 要                        |
| 快捷键内核     | IME / repeat 过滤、`event.code`、精确修饰键、录制、冲突检测、可自定义                                     | 要                        |
| 设计系统       | `text-ui-*` 动态字号、语义 token、圆角层级、4px 间距、克制动效                                            | 已部分采用，补治理        |
| 运行时边界     | `workspaceIdentity` vs `workspacePath`；continuous vs replayable；CommandInbox                            | 要，形成文档与类型        |
| 设置 IA        | 侧栏导航 + 搜索 + 两栏 provider + 分区                                                                    | 要                        |
| 性能           | 虚拟滚动、行高缓存、底部钉住、prepend 锚点、滚动记忆                                                      | 已有 virtua，补策略       |

### 2.4 我们的差异化，不能被“对齐”弄丢

- 国产模型开箱即用与中文 UX（DeepSeek / Qwen / GLM / Kimi / MiniMax / MiMo）。
- Office 自动化（PPT / Word / Excel）与内容平台发布（小红书 / 抖音 / 快手 / B 站 / 公众号 / 视频号 / 闲鱼）。
- 工作区工具：文件树、Git、数据库、知识库、记忆 / 进化、团队 / 编排。
- 桌面桌宠、通知、TUI、本地优先 / 隐私。
- 多入口一致：TUI / Web / Desktop / SDK / ACP。

> 对齐策略：**内核语义向 cc 收敛，桌面交互向 ZCode 收敛，产品能力保持 NovaWay 自己的路线。** 不把 NovaWay 变成 Claude Code 或 ZCode 的皮肤。

---

## 3. 优势对比矩阵

### 3.1 内核对比

评分：● 强 / ◐ 有但欠闭环 / ○ 缺。

| 能力         | cc                               | NovaWay                                            | 差距 | 决策                       |
| ------------ | -------------------------------- | -------------------------------------------------- | ---- | -------------------------- |
| 流式工具循环 | ● 多 step、并发、tombstone       | ◐ `processor.ts` 有流式与 step，但并发策略粗       | 中   | 补齐                       |
| Tool 契约    | ● 字段全、执行器强制             | ◐ 字段全，但仅约 13 个工具文件声明；多数能力未强制 | 大   | P0                         |
| 工具调度     | ● 只读并发 / 写入串行 / 中断行为 | ◐ 只有 read/write 锁；`interrupt` 基本未用         | 大   | P0                         |
| 权限模式     | ● 6 种 + 规则来源                | ◐ 4 种 + last-match                                | 中   | 补来源与审计               |
| bash 安全    | ● AST 分类 + arity               | ◐ arity + 正则白名单                               | 中   | 补 AST / 拒绝追踪          |
| Hooks        | ● 全生命周期                     | ● 23 事件 + 四类 hook                              | 小   | 补强制点与测试             |
| 压缩         | ● auto/micro/reactive + boundary | ◐ auto + 预算 + 后置文件                           | 中   | 补 micro/reactive/boundary |
| 子 Agent     | ● 多种 task + mailbox            | ◐ task/team/mailbox 有，缺统一 registry            | 中   | P1                         |
| 会话恢复     | ● resume/fork/revert/checkpoint  | ◐ 有，崩溃恢复需验证                               | 中   | 补测试                     |
| 无头 / SDK   | ● print/stream-json/SDK/ACP      | ◐ ACP + SDK + serve，缺 `--print` 等价面           | 中   | 补                         |
| 错误 / 重试  | ● 分类 + fallback                | ◐ retry 有，fallback 不完整                        | 中   | 补                         |
| 可观测       | ● 但含大量远程遥测               | ◐ 本地日志 + span，缺 turn 指标                    | 小   | 做本地版                   |
| 测试         | ● cassette/golden                | ◐ 单测多，缺 golden turn                           | 中   | P0                         |

### 3.2 桌面端对比

| 能力           | ZCode                                  | NovaWay                                    | 差距 | 决策       |
| -------------- | -------------------------------------- | ------------------------------------------ | ---- | ---------- |
| 壳层           | ● 三段式 + 可拖拽 + 自动收起           | ◐ 三段式 + ResizeHandle，自动收起不全      | 小   | 补         |
| 侧栏           | ● 三视图 + running-layer + 未读 + 分页 | ◐ tasks/tree 两视图 + 置顶/归档/重命名     | 中   | P1         |
| Composer       | ● 分区工具条 + 渐进折叠 + 模式菜单     | ◐ 模型/权限/思考/停止/发送已有，折叠策略弱 | 中   | P1         |
| 时间线         | ● 轮次单元 + work segment + 虚拟滚动   | ◐ TurnFold + virtua + TurnNavigator        | 小   | 补统一模型 |
| 工具渲染       | ● 家族注册表 + 分组 + 内联 diff        | ◐ switch + BasicTool + 上下文分组          | 中   | P1         |
| 状态面板       | ● section 契约 + hasContent + 聚焦     | ◐ 已有 section 与自动展开                  | 小   | 补契约     |
| Side Pane      | ● tabs + full view + 最近关闭          | ◐ tabs + 动态 tab + 拖拽；缺 full view     | 中   | P1         |
| Command Center | ● Cmd+K + 范围 + 最近变更              | ◐ 命令/文件/会话混合，默认 `mod+shift+p`   | 大   | P0         |
| 快捷键         | ● 事件码 + IME + 录制 + 冲突           | ◐ `event.key` + 自定义 + 冲突告警弱        | 大   | P0         |
| 设计系统       | ● token + 字号 + 圆角 + 动效           | ◐ `text-ui-*` 已用，仍有任意值             | 小   | 治理       |
| 设置           | ● 侧栏 + 搜索                          | ◐ Tabs + 卡片网格，无搜索                  | 中   | P2         |
| 运行时边界     | ● 身份/路径/交付模式文档化             | ◐ 有 pathKey/sessionKey，缺统一契约        | 中   | P1         |
| 性能           | ● 测量缓存 + 钉底 + 锚点               | ◐ virtua + 部分 rAF                        | 中   | P1         |
| i18n / a11y    | ● 完整                                 | ◐ 18 locale，键盘/对比度需审计             | 小   | 持续       |

### 3.3 两边都不值得照搬的东西

**cc 不要照搬**

- 遥测：Datadog、first-party event logging、GrowthBook、OTEL / BigQuery 指标。
- 账户与远程：OAuth、组织 UUID、subscription tier、remote session、teleport、bridge、session ingress。
- 企业同步：remote managed settings、policy limits、settings sync、team memory sync、Claude.ai MCP connector。
- 市场与更新：official marketplace、plugin autoupdate、release notes、native installer 后端。
- 品牌与文案：Claude / Anthropic 品牌、系统提示词、帮助文案。
- 恢复版源码本身：授权不明，禁止复制。

**ZCode 不要照搬**

- 云端 coding plan、手机远控、bot、官方市场、账号体系（除非产品明确要做）。
- 为每个功能建 CONTRACT.md 的重流程；我们只对“跨进程 / 跨入口 / 单一写入口”建契约。
- 6k 行单组件；保持可维护拆分，但以行为为单位，不以“层数”为单位。
- 全量 React / Zustand / Radix 技术栈；我们继续 SolidJS。
- 所有插件 surface、gen-ui、plugin-ui 的完整生态；先做内置能力。

---

## 4. 汲取清单 A：内核（from cc）

> 原则：**行为规格优先，clean-room 重写。** 每项都要有“现状 → 目标 → 落点 → 验收”。

### A1. 单轮执行状态机与工具调度

**cc 的强项**：一轮用户请求内多 step；流式工具调用；只读工具可并发；写入工具串行；用户中断时按工具声明的 `interrupt` 决定取消或阻塞；孤儿 tool call 用 tombstone 标记；fallback model 重试时清理 thinking block。

**我们的现状**：`session/processor.ts` 已有流式事件、`Result = compact | stop | continue`、重试、工具 part 生命周期；`session/prompt.ts` 用 `Tool.concurrencySafe` 选择 `read` / `write` 锁；但 `interrupt` 基本未消费，孤儿工具调用主要靠结束态兜底。

**要做什么**

1. 明确定义 `TurnState`：`idle → streaming → tool_running → waiting_permission → compacting → retrying → done | aborted | failed`。
2. 调度器按 `concurrencySafe` 分组：只读批并发，写入批串行；每批结束再进入下一 step。
3. 消费 `Capabilities.interrupt`：
   - `cancel`：用户新消息到达时取消该工具；
   - `block`：等工具结束再处理新消息；
   - 未声明：按“写入类 block、只读类 cancel”默认。
4. 孤儿 tool call：stream 结束仍未收到 result 时，写入 `interrupted` 状态并生成可读错误，不留下悬挂 part。
5. fallback model：仅对可重试错误触发；切换前清理 thinking / reasoning part，避免把上一模型的推理块发给下一模型。

**落点**

- `packages/novaway/src/session/processor.ts`
- `packages/novaway/src/session/prompt.ts`
- `packages/novaway/src/session/run-state.ts`
- `packages/novaway/src/session/retry.ts`
- 新增 `packages/novaway/src/session/turn-state.ts`（纯状态机，便于测试）

**验收**

- 单测：只读 3 工具并发、写入 2 工具串行、混合批次顺序稳定。
- 单测：中断时 `cancel` 工具立即结束、`block` 工具结束后才接收新消息。
- golden trace：一轮内 5 个 step 的事件顺序固定。
- 故障注入：stream 中断、工具抛错、模型 5xx、切 fallback 后消息序列合法。

---

### A2. Tool 契约 v2：全量声明 + 执行器强制 + UI 投影

**cc 的强项**：每个工具都声明并发安全、只读、破坏性、权限检查、输入校验、结果大小、中断行为；执行器和 UI 都依赖这些声明。

**我们的现状**：`tool/tool.ts` 的 `Capabilities` 设计已经很好，但只有约 13 个工具文件声明；`destructive`、`interrupt`、`maxResultBytes` 各只有 1 处使用；UI 主要按工具名 switch。

**要做什么**

1. 给所有工具补 `capabilities`，至少覆盖：
   - `readOnly`：read / glob / grep / list / webfetch / websearch / lsp / git status / db query；
   - `concurrencySafe`：只读且无共享状态；
   - `destructive`：write / edit / apply_patch / rm / git reset / publish / send；
   - `interrupt`：长任务（shell、browser、task）明确 `cancel` / `block`；
   - `maxResultBytes`：read / grep / glob / shell / mcp 资源；
   - `checkPermissions`：需要工具特有判断的（shell、edit、git、publish）。
2. 执行器强制：
   - `readOnly` 与 `concurrencySafe` 不一致时，在开发模式直接报错；
   - `destructive` 必须经过权限 ask（除非模式显式 bypass）；
   - `maxResultBytes` 必须由 `Truncate` 统一执行，不允许工具自己截断；
   - `interrupt` 必须被 `SessionRunState` 消费。
3. UI 投影：
   - 工具结果 part 增加 `display` 元数据：`kind`（read/search/edit/shell/task/browser/office/mcp）、`title`、`subtitle`、`files`、`diff`、`groupKey`、`collapsedByDefault`；
   - 桌面端按 `display.kind` 选渲染器，不再只按 `tool` 名。
4. 兼容：旧工具未声明时给保守默认（非只读、非并发、非破坏、block），并在 lint / 测试中列出“未声明清单”。

**落点**

- `packages/novaway/src/tool/tool.ts`（类型与默认值）
- `packages/novaway/src/tool/registry.ts`（启动时校验）
- `packages/novaway/src/tool/*.ts`（逐工具补声明）
- `packages/novaway/src/session/prompt.ts`（强制点）
- `packages/ui/src/components/message-part.tsx`（display 投影）
- 新增 `packages/novaway/test/tool/capabilities.test.ts`

**验收**

- 覆盖率测试：所有注册工具都有 `capabilities`，否则 CI 失败（白名单逐步清零）。
- 调度测试：只读并发、写入串行、破坏性必问。
- UI 测试：每种 `display.kind` 都有稳定渲染；未知 kind 有 fallback。

---

### A3. 权限管线：规则来源、拒绝追踪、审计、异步审批

**cc 的强项**：权限模式与规则来源分层；alwaysAllow / alwaysDeny / alwaysAsk；additionalWorkingDirectories；bash AST 分类；拒绝追踪；shadowed rule 检测；plan 模式；审批可以异步、可修改输入、可升级。

**我们的现状**：`permission/index.ts` 有 4 种模式、last-match 规则、bash arity、plan 白名单、pending Deferred、PermissionDenied hook；缺规则来源分层、拒绝追踪、shadowed 提示、审计日志、审批“修改后允许”。

**要做什么**

1. 规则来源分层（优先级从高到低）：
   - 会话临时规则（本次 always allow / deny）；
   - 项目本地规则（`.novaway/permissions.json`，可提交）；
   - 用户全局规则（`~/.config/novaway/permissions.json`）；
   - Agent 默认规则；
   - 内置安全默认。
2. 规则求值返回“命中来源 + 是否被更高优先级 shadow”，UI 显示“这条规则不会生效，因为被 X 覆盖”。
3. 拒绝追踪：同一工具 / 同一命令前缀连续被拒 N 次后，停止重复询问，直接返回可读拒绝；用户可重置。
4. 审计：每次 allow / deny / ask / modify 写本地审计事件（不含敏感参数），可在设置中查看与导出。
5. 审批动作扩展：`allow_once` / `allow_always` / `deny` / `deny_with_feedback` / `allow_with_modified_input`；修改后的输入必须重新走 `validateInput`。
6. bash 安全：在 arity 之上补命令 AST / 分词分类；对管道、重定向、命令替换、`sudo`、`eval` 做保守拒绝。
7. plan 模式：保留现有“只写计划目录 + 只读 shell”，补“计划文件路径必须 canonicalize 后再判断包含”。

**落点**

- `packages/novaway/src/permission/{index,evaluate,arity,plan,schema}.ts`
- 新增 `packages/novaway/src/permission/{sources,audit,bash-classifier}.ts`
- `packages/novaway/src/config/permission.ts`
- 桌面端 `packages/app/src/pages/session/composer/session-permission-dock.tsx`
- `packages/app/src/components/permission-mode-select.tsx`

**验收**

- 权限矩阵测试：4 模式 × 6 工具类别 × 5 规则来源，结果表驱动。
- shadowed rule 测试：高优先级 allow 覆盖低优先级 deny，UI 文案正确。
- 拒绝追踪测试：连续拒绝后不再弹窗，重置后恢复。
- bash 测试：管道、重定向、命令替换、`sudo`、`eval`、`git reset --hard` 均按预期。
- 审计测试：不写入 API key、token、完整命令参数中的敏感值。

---

### A4. Hooks：补齐强制点与失败语义

**cc 的强项**：生命周期完整；可阻断；可改输入；可追加上下文；超时与失败不会静默吞掉。

**我们的现状**：`hook/schema.ts` 已有 23 个事件，覆盖 SessionStart / End、UserPromptSubmit、Pre/PostToolUse、PostToolUseFailure、PermissionRequest / Denied、SubagentStart / Stop、Pre/PostCompact、TaskCreated / Completed 等；`hook/service.ts` 支持 command / http / prompt / agent 与插件桥接。差距是**每个事件的触发点是否都可靠、hook 失败是否可观测、超时是否统一**。

**要做什么**

1. 建“事件触发点清单”：每个事件在哪个文件、什么条件下触发、失败如何处理。
2. 统一 hook 执行结果：
   - `decision: allow | deny | ask`；
   - `updatedInput`；
   - `additionalContext`；
   - `timeout` / `async` / `once` 语义；
   - 失败分类：命令不存在、非零退出、超时、输出不可解析。
3. 关键强制点：
   - `UserPromptSubmit` deny 必须阻止本轮；
   - `PreToolUse` deny 必须阻止工具；
   - `PostToolUse` 失败不能回滚已执行工具，但必须记录；
   - `Stop` deny 必须阻止结束，并允许追加一轮；
   - `PreCompact` deny 必须跳过压缩并告知 UI。
4. 观测：每次 hook 运行产生 span + 级别日志；`statusMessage` 驱动状态条；超时 / 失败在 UI 可见。
5. 安全：http hook 只允许白名单 env；prompt / agent hook 默认关闭或需显式启用；hook 命令不继承敏感环境变量。

**落点**

- `packages/novaway/src/hook/{schema,service,exec,index}.ts`
- `packages/novaway/src/session/{prompt,compaction}.ts`
- `packages/app/src/pages/session/status-panel/hooks-section*.tsx`
- 新增 `packages/novaway/test/hook/events.test.ts`

**验收**

- 事件表测试：每个事件至少一个触发用例、一个失败用例。
- 阻断测试：UserPromptSubmit / PreToolUse / Stop / PreCompact 的 deny 均生效。
- 超时测试：hook 超时后主流程继续或按声明失败，不悬挂。
- UI 测试：状态条显示 hook 状态，结束后消失。

---

### A5. 上下文与压缩：边界、microcompact、reactive compact

**cc 的强项**：auto compact、microcompact、reactive compact；compact boundary 消息；摘要模板；保留最近轮次；后置文件回挂；token 预算。

**我们的现状**：`session/compaction.ts` 已有自动压缩、预算、保留最近轮次、压缩重试、post-compact 文件回挂；`overflow.ts` 有上下文预算；但缺统一的 compact boundary 语义、microcompact、reactive compact，以及 UI 对 `/compact` 的模型专用展示。

**要做什么**

1. 定义 compact boundary：
   - 用户消息带 `compaction` part，表示边界；
   - 摘要消息带 `summary` 标记；
   - 时间线只显示一条“已压缩”提示，不把摘要当普通 assistant 文本；
   - 后续请求从边界之后重建上下文。
2. microcompact：在不调用模型的情况下，把旧工具输出裁剪为摘要 / 指针（保留文件路径、命令、退出码），并保留最近 N 轮原文。
3. reactive compact：当 provider 返回 context overflow 时，先 microcompact，再 auto compact，最后才报错；每次重试都记录 token 变化。
4. 预算：
   - 系统提示 + 工具 schema + 记忆 + 规则 + 技能先计入固定前缀；
   - 固定前缀超过窗口的 50% 时，优先 defer MCP 工具、裁剪技能、压缩记忆；
   - 连续压缩上限保留，超过则给出“固定前缀过大”的可读错误。
5. UI：`/compact` 只显示模型侧提示，不生成用户气泡；压缩后显示“已压缩 · 释放 N tokens”。

**落点**

- `packages/novaway/src/session/{compaction,overflow,tool-budget,llm}.ts`
- `packages/novaway/src/session/message-v2.ts`
- `packages/app/src/pages/session/message-timeline.data.ts`
- `packages/app/src/pages/session/message-timeline.tsx`

**验收**

- token 账本测试：压缩前后固定前缀、历史、工具输出、剩余预算四项可对账。
- microcompact 测试：旧工具输出被裁剪，最近轮次不变。
- reactive 测试：模拟 400 context overflow，最终成功或给出明确错误。
- UI 测试：`/compact` 不出现用户气泡；边界提示只出现一次。

---

### A6. 统一 Task Registry 与子 Agent 生命周期

**cc 的强项**：LocalMainSessionTask / LocalAgentTask / LocalShellTask / InProcessTeammateTask / RemoteAgentTask 等统一生命周期；父子会话；邮箱；取消；结果投递。

**我们的现状**：`tool/agent_task.ts` 有 task / task_status / task_stop / team / mailbox；`background/job.ts` 有后台任务；`session/run-state.ts` 有 runner；但三套状态各自为政，桌面端状态面板需要分别适配。

**要做什么**

1. 定义统一 `TaskRecord`：
   - `id`、`kind`（agent / shell / background / teammate / workflow）、`parentSessionID`、`owner`、`status`、`startedAt`、`endedAt`、`cancelReason`、`result`、`tokens`、`worktree`。
2. 一个 `TaskRegistry` 服务：创建、更新、取消、查询、订阅；所有 task 工具与后台任务都写入它。
3. 状态机：`queued → running → waiting → completed | failed | cancelled | lost`；`lost` 用于进程重启后发现无法恢复的任务。
4. 父子关系：子 Agent 的 session 必须记录 `parentID`；取消父任务时级联取消子任务；子任务结果通过 mailbox / task notification 投递。
5. UI：状态面板的 Agents / Background 两个 section 都从 TaskRegistry 读；支持取消、查看输出、跳转子会话。
6. 恢复：进程重启后扫描未完成任务，标记 `lost` 或按声明恢复；不把“重启中断”伪装成成功。

**落点**

- 新增 `packages/novaway/src/task/registry.ts`、`task/schema.ts`
- `packages/novaway/src/tool/{agent_task,task,task_status,team,agent_message}.ts`
- `packages/novaway/src/background/job.ts`
- `packages/app/src/pages/session/status-panel/{agents-section,background-section}*.tsx`

**验收**

- 生命周期测试：创建 → 运行 → 完成 / 失败 / 取消，事件顺序固定。
- 级联测试：取消父任务，子任务全部取消。
- 恢复测试：模拟进程重启，未完成任务标记 `lost`，UI 可读。
- UI 测试：状态面板能取消运行中的子 Agent。

---

### A7. 会话生命周期与崩溃恢复

**cc 的强项**：create / resume / fork / revert / checkpoint / archive / share；进程重启后可恢复。

**我们的现状**：`session/session.ts` 有 create / fork / revert / archive；`session/checkpoint.ts` 有 checkpoint；`session/projectors.ts` 有事件投影；但崩溃恢复、幂等工具结果、半写消息修复需要验证。

**要做什么**

1. 事件日志：所有消息 / part / 工具状态变更走 append-only event；projection 可重建。
2. 幂等：工具结果按 `callID` 幂等写入；重复事件不产生重复 part。
3. 恢复：启动时扫描 `running` 状态的消息 / 工具，标记 `interrupted`，并允许用户“继续”或“重试”。
4. fork / revert：fork 必须复制到边界为止；revert 必须恢复文件与消息到一致状态。
5. 迁移：schema 变更必须可回滚；迁移前备份；启动时校验 schema 版本。

**落点**

- `packages/novaway/src/session/{session,projectors,projectors-next,checkpoint,revert,message-v2}.ts`
- `packages/novaway/src/storage/db.ts`
- `packages/novaway/src/session/session.sql.ts`

**验收**

- 崩溃注入：在 stream、工具执行、压缩、写库四个点 kill 进程，重启后状态可读且不重复。
- fork / revert 测试：消息、文件、checkpoint 三者一致。
- 迁移测试：旧 schema 升级后数据完整，回滚可用。

---

### A8. 无头 / SDK / ACP 等价面

**cc 的强项**：`--print`、stream-json、SDK、ACP、权限回调、abort。

**我们的现状**：`acp/agent.ts` 有 JSON-RPC over stdio；`cli/cmd/serve.ts` 有 headless server；`packages/sdk/js` 有 client/server；但缺一个与 cc `--print` 等价的“单次执行 + 结构化输出”入口。

**要做什么**

1. 增加 `novaway run --print`：
   - 输入：prompt / stdin / `--input-json`；
   - 输出：`text` / `json` / `stream-json`；
   - 权限：`--permission-mode` + `--allowed-tools` + `--deny-tools`；
   - 中止：SIGINT / AbortSignal；
   - 退出码：成功 0、模型错误 1、权限拒绝 2、用法错误 64。
2. 统一事件 schema：message / part / tool / permission / question / usage / error；SDK 与 ACP 共用。
3. 文档：给出 curl / Node / Python 示例；说明流式帧格式与重连语义。
4. 兼容：不承诺与 cc 的 stream-json 字节级兼容，只承诺字段语义稳定。

**落点**

- `packages/novaway/src/cli/cmd/run.ts`
- `packages/novaway/src/cli/cmd/serve.ts`
- `packages/novaway/src/acp/*`
- `packages/sdk/js/src/*`
- 新增 `docs/headless.md`

**验收**

- CLI e2e：`run --print` 文本 / JSON / stream-json 三种输出。
- 权限测试：allowed / denied / ask 三种回调。
- SDK 测试：创建会话、发送、流式接收、取消、关闭。
- ACP 测试：initialize / prompt / cancel / close。

---

### A9. 系统提示与上下文组装

**cc 的强项**：分层系统提示（基础 + Agent + 模式 + 规则 + 记忆 + 技能 + 工具）；输出风格；plan reminder；max steps；缓存友好排序。

**我们的现状**：`session/system.ts`、`session/instruction.ts`、`session/output-style.ts`、`agent/prompt/*` 已有分层；但组装顺序、预算、缓存前缀稳定性需要治理。

**要做什么**

1. 固定顺序：基础身份 → 安全与权限 → 工具使用规范 → 输出风格 → Agent 角色 → 项目规则 → 记忆 → 技能 → 模式提醒 → 工具 schema。
2. 缓存友好：稳定内容在前，易变内容在后；工具 schema 顺序稳定；不要每轮重排。
3. 预算：每层有 token 上限；超限时按“技能 → 记忆 → 规则 → 工具描述”顺序裁剪，并记录。
4. 可测试：给定配置，输出快照稳定；变更需要更新 golden。

**落点**

- `packages/novaway/src/session/{system,instruction,output-style}.ts`
- `packages/novaway/src/agent/prompt/*`
- `packages/novaway/test/session/system-prompt.test.ts`

**验收**

- 快照测试：不同 Agent / 模式 / 规则组合的输出稳定。
- 预算测试：超限裁剪顺序正确，关键安全提示不被裁掉。
- 缓存测试：同一会话连续两轮前缀字节一致（除时间戳等显式变化）。

---

### A10. 错误分类、重试与 fallback

**cc 的强项**：错误分类清楚；Retry-After；fallback model；thinking block 清理；用户可读错误。

**我们的现状**：`session/retry.ts` 有 Retry-After、5xx、免费额度等；`message-error.ts` 有错误类型；但 fallback model 与错误分类还不完整。

**要做什么**

1. 错误分类：`auth` / `rate_limit` / `quota` / `context_overflow` / `provider_5xx` / `network` / `invalid_request` / `tool` / `permission` / `aborted` / `unknown`。
2. 重试策略：只对 `rate_limit` / `provider_5xx` / `network` 重试；`context_overflow` 走压缩；`auth` / `invalid_request` 不重试。
3. fallback：按配置的 fallback 链切换；切换前清理 thinking / reasoning；记录切换原因；UI 显示“已切换到 X”。
4. 用户可读：每类错误给“发生了什么 / 可以做什么 / 重试按钮”；不要直接抛原始 JSON。
5. 观测：错误计数按 provider / model / 类别聚合到本地指标。

**落点**

- `packages/novaway/src/session/{retry,message-error,llm}.ts`
- `packages/app/src/components/session/session-error-card.tsx`
- `packages/app/src/pages/session/session-error.ts`

**验收**

- 表驱动测试：每类错误的重试 / 压缩 / 失败行为。
- fallback 测试：主模型 5xx → 备用模型成功；thinking block 不泄漏。
- UI 测试：错误卡片显示分类与操作。

---

### A11. 本地可观测性（不引入远程遥测）

**cc 的强项**：turn 级事件与指标；但大量外发，不适合我们。

**我们的现状**：`@novaway/core/util/log` 有分级日志；Effect span；`cli/cmd/run/trace.ts` 有 JSONL trace；但没有统一的 turn 指标与脱敏规则。

**要做什么**

1. 定义本地 turn trace：`turn.start`、`llm.request`、`llm.first_token`、`tool.start`、`tool.end`、`compact`、`permission.ask`、`turn.end`；带 `sessionID` / `messageID` / `provider` / `model` / `duration` / `tokens`。
2. 日志级别：
   - debug：流式 delta、part 更新、NDJSON 帧；
   - info：生命周期、turn 开始 / 结束、工具开始 / 结束；
   - warn：可恢复错误、重试、降级；
   - error：致命错误。
3. 脱敏：API key、Authorization、cookie、用户 prompt（默认不记录；显式开启才记录）。
4. 导出：`novaway debug trace` 导出最近 N 条；用户可附到 issue。
5. 默认关闭外发；不引入 Datadog / GrowthBook / BigQuery。

**落点**

- `packages/novaway/src/util/log.ts`（或 core log）
- `packages/novaway/src/cli/cmd/run/trace.ts`
- 新增 `packages/novaway/src/observability/turn-trace.ts`
- `docs/debugging.md`

**验收**

- trace 测试：一轮对话产生完整事件链。
- 脱敏测试：日志中不出现 key / token / cookie。
- 性能测试：debug 关闭时开销 < 1%。

---

### A12. Golden transcript 与故障注入测试

**cc 的强项**：cassette / golden / 权限矩阵 / 跨平台。

**我们的现状**：单测多；`packages/novaway/test` 366 文件；但缺“整轮对话”的 golden 与故障注入。

**要做什么**

1. 建 `test/golden/turns/*.jsonl`：输入消息、模型响应（cassette）、工具结果、期望事件序列、期望最终消息。
2. 覆盖场景：纯文本；只读工具并发；写入工具串行；权限 ask / deny / allow always；工具失败；压缩；子 Agent；中断；fallback。
3. 故障注入：stream 断、工具超时、DB 写失败、进程 kill。
4. CI：golden 不一致时输出 diff；允许 `RECORD=1` 更新。

**落点**

- `packages/novaway/test/golden/*`
- `packages/novaway/test/lib/effect.ts`
- `packages/llm` 的 cassette 机制可参考，但不跨包耦合

**验收**

- 每个场景至少一条 golden；CI 稳定通过。
- 故障注入用例可在本地复现并修复。

---

## 5. 汲取清单 B：桌面端（from ZCode）

> 原则：**token 优先、单一状态源、契约只给跨入口能力。** 不照搬 React 组件，按 SolidJS 重画。

### B1. 设计系统治理：token、字号、圆角、间距、动效

**ZCode 的强项**：`text-ui-*` 动态字号只改 `--ui-font-size`；语义色分层；圆角按嵌套层级递减；4px 间距；克制动效；a11y / i18n 写进规范。

**我们的现状**：`packages/app/src/index.css` 已有 `--font-size-ui-*`，组件已大量使用 `text-ui-*`；`workspace-chrome.ts` 已按平台给面板圆角；但仍存在任意 px、任意色、任意圆角。

**要做什么**

1. 建 token 清单：
   - 字号：`text-ui-xl / lg / base / caption / sm / xs / 2xs`；
   - 颜色：`foreground / subtle / subtlest / inverse`、`background / alt / panel / surface / hover`、`card / selected`、`popover / menu / input`、`success / warning / destructive`；
   - 圆角：`xl → lg → md → sm` 嵌套规则；`2xl` 只用于主输入壳、状态浮层、完整视图浮层、Toast、品牌图标；
   - 间距：4 / 8 / 12 / 16 / 20 / 24；
   - 动效：120–240ms，减少动画偏好。
2. 治理规则：
   - 新 UI 不允许裸 hex / 任意 `w-[...]` / `text-[13px]`；
   - 业务组件优先用 `@novaway/ui` 原语；
   - 字号只通过 token，不直接改 `html` font-size；
   - 图标、间距、圆角不随字号缩放。
3. 视觉回归：Storybook + 截图对比；深浅主题 + 中文长文案。

**落点**

- `packages/app/src/index.css`
- `packages/ui/src/components/*`
- `packages/ui/src/theme/*`
- `packages/storybook/*`

**验收**

- lint / grep 门禁：新增代码无裸 hex、无任意字号。
- 视觉回归：核心页面在 light / dark / 中文长文案下无溢出。
- a11y：对比度 ≥ 4.5:1，键盘可达，focus 可见。

---

### B2. 工作区壳层：三段式、可拖拽、自动收起

**ZCode 的强项**：侧栏固定 264px；Header 只属于右侧；上层会话 + Browser；底部终端横跨；4px 间隙；侧栏显隐入口挂在外层 shell；macOS 红绿灯安全区；拖拽 / 键盘 / `aria-valuemin` 共享最小宽度。

**我们的现状**：`pages/layout.tsx` + `ResizeHandle` + `sidePane` 已有多面板；`workspace-chrome.ts` 已按平台给圆角；但侧栏收起入口、自动收起阈值、键盘拖拽需要统一。

**要做什么**

1. 明确区域：`Sidebar`、`Header`、`Conversation`、`SidePane`、`Terminal`、`StatusPanel`。
2. 统一拖拽：
   - 侧栏 min 264px；
   - Side Pane 默认窗口 45%，可拖拽；
   - 终端高度可拖拽；
   - 拖拽到阈值自动收起，并保留“重新展开”入口。
3. 侧栏显隐入口放在最外层 shell，避免收起后入口一起消失；macOS 留红绿灯安全区。
4. 断点：窄屏隐藏 Side Pane / Terminal，改为抽屉；保留核心动作。
5. 持久化：宽度、折叠态按 workspace 存；不要跨 workspace 串状态。

**落点**

- `packages/app/src/pages/layout.tsx`
- `packages/app/src/pages/session.tsx`
- `packages/app/src/context/layout.tsx`
- `packages/ui/src/components/resize-handle.tsx`
- `packages/app/src/utils/workspace-chrome.ts`

**验收**

- 拖拽测试：鼠标 / 键盘 / `aria-valuemin` 行为一致。
- 自动收起测试：阈值触发一次，重新展开可恢复。
- 跨 workspace 测试：宽度 / 折叠态不串。
- 窄屏测试：核心动作仍可达。

---

### B3. 侧栏信息架构：项目 / 任务、三视图、running-layer

**ZCode 的强项**：workspace → task 两级；projects / grouped / timeline 三视图；running-layer 排序（预热 / 运行 / 后台优先，再按 createdAt）；未读；置顶 / 归档 / 移动；每项目 5 条分页；右键菜单；项目文件树入口；新根目录信任确认。

**我们的现状**：`sidebar-tasks.tsx` 有任务列表、过滤、置顶、归档、重命名、子会话；`sidebar-items.tsx` 有会话项；`sidebar-files.tsx` 有文件树；但只有 tasks / tree 两视图，没有 grouped / timeline / running-layer / 分页。

**要做什么**

1. 三视图：
   - projects：按项目分组，项目内任务；
   - grouped：按状态 / 时间分组；
   - timeline：按更新时间倒序，跨项目。
2. running-layer：运行中 / 等待确认 / 后台任务置顶；同层按 `createdAt` 倒序；稳定 taskId 排序，避免跳动。
3. 列表：
   - 默认显示 5 条，更多分页；
   - 未读点 / 错误点；
   - 工作流活动行（可选）；
   - 右键菜单：重命名 / 置顶 / 归档 / 删除 / 复制链接。
4. 项目：
   - 文件树入口；
   - 新根目录首次打开需确认信任；
   - 远程 / 离线项目行显示状态。
5. 状态口径：侧栏、状态面板、任务中心共用 `sessionStatusOf`，不各自实现。

**落点**

- `packages/app/src/pages/layout.tsx`
- `packages/app/src/pages/layout/sidebar-tasks.tsx`
- `packages/app/src/pages/layout/sidebar-items.tsx`
- `packages/app/src/pages/layout/sidebar-project.tsx`
- `packages/app/src/components/session/task-row.tsx`
- `packages/app/src/context/layout.tsx`（`SidebarView` 扩展）

**验收**

- 排序测试：运行中永远在空闲前；同层稳定。
- 分页测试：每项目 5 条，展开独立。
- 右键测试：每个动作生效且不误触打开会话。
- 信任测试：新根目录未确认前不读取文件。

---

### B4. Composer：分区工具条、渐进折叠、模式菜单

**ZCode 的强项**：左侧模型 / 思考 / 用量；右侧停止 / 发送；底部模式切换 + CUA + 后台任务；`data-composer-collapse-priority` 按优先级渐进折叠；`@container/composer`；模式菜单 = Plan 复选框 + 权限单选 + 描述；占位符区分新任务 / 追问 / 排队 / “工作中 N 秒”。

**我们的现状**：`prompt-input.tsx` 已有模型、权限、思考、停止、发送、`data-action`、shell 模式、附件、@ 文件、slash；`session-composer-region.tsx` 有 followup dock / permission dock / question dock / revert dock；但折叠策略、模式菜单描述、占位符状态还不完整。

**要做什么**

1. 工具条分区：
   - 左：Agent / 模型 / 思考强度 / 上下文用量；
   - 右：停止 / 发送；
   - 底左：模式切换（Plan / 权限）/ CUA / 后台任务；
   - 错误提示与输入壳分离。
2. 渐进折叠：
   - 容器宽度不足时，按优先级依次隐藏“用量文字 → 思考文字 → 模型文字 → 权限文字”，最后只留图标；
   - 单行模式直接 icon-only，不做测量；
   - 折叠后 tooltip 仍显示完整信息。
3. 模式菜单：
   - Plan 复选框；
   - 权限单选：default / acceptEdits / plan / bypass；
   - 每项一句描述；
   - 快捷键提示。
4. 占位符：
   - 新任务：示例提示；
   - 追问：`继续追问…`；
   - 运行中排队：`排队中，本轮结束后发送`；
   - 运行中引导：`立即引导（不中断当前轮）`；
   - 工作中：`工作中 N 秒…`。
5. 可访问性：icon-only 按钮必须有 `aria-label`；菜单键盘可达；IME 组字期间不提交。

**落点**

- `packages/app/src/components/prompt-input.tsx`
- `packages/app/src/components/prompt-input/placeholder.ts`
- `packages/app/src/components/permission-mode-select.tsx`
- `packages/app/src/pages/session/composer/session-composer-region.tsx`
- `packages/app/src/pages/session/session-followup.ts`

**验收**

- 折叠测试：宽度 1200 / 900 / 700 / 500 下顺序正确，无跳动。
- 模式测试：Plan + 权限组合正确，描述与快捷键显示。
- 占位符测试：五种状态各自正确。
- IME 测试：中文组字回车不提交。

---

### B5. 时间线：轮次渲染单元、work segment、虚拟滚动

**ZCode 的强项**：flat rows → 视觉轮次单元；work segment；运行中显示“工作中 N 秒”，结束后折叠“已工作 N 秒”；运行 / 中断 / 失败强制展开；`/compact` 只显示模型侧；每行动作独立；虚拟滚动带行高缓存、底部钉住、prepend 锚点、会话滚动记忆。

**我们的现状**：`message-timeline.data.ts` 已有 `TimelineRow`、`TurnFold`、`TodoSection`、`TodoOverview`；`message-timeline.tsx` 用 `virtua`、`TurnNavigator`、`TurnFold`；但轮次模型、work segment、强制展开、compact 展示还可以统一。

**要做什么**

1. 时间线模型：
   - 顶层只区分：user turn、assistant turn、turn divider、bottom spacer；
   - 每个 turn 内：thinking / tool / text / diff / error / retry / actions；
   - 过程和收尾分离：过程可折叠，收尾文本与产物卡保留。
2. work segment：
   - 运行中：`工作中 N 秒`；
   - 结束：`已工作 N 秒` 可展开；
   - 中断 / 失败：强制展开，并显示原因。
3. 虚拟滚动：
   - 行高测量缓存；
   - 新消息到达时若用户在底部，钉住底部；
   - 向上加载历史时保持 prepend 锚点；
   - 每个 session 记住滚动位置；
   - 用户主动滚动后 1.2s 内不自动钉底。
4. `TurnNavigator`：条数、当前条、运行中最后一条高亮；点击跳转。
5. `/compact`：模型侧提示，不生成用户气泡；摘要不作为普通 assistant 文本渲染。

**落点**

- `packages/app/src/pages/session/message-timeline.data.ts`
- `packages/app/src/pages/session/message-timeline.tsx`
- `packages/app/src/pages/session/turn-navigator.tsx`
- `packages/app/src/context/layout-scroll.ts`

**验收**

- 单测：TurnFold 折叠 / 展开 / 强制展开。
- 性能：10k 行滚动保持 60fps，内存不持续增长。
- 滚动测试：底部钉住、prepend 锚点、会话记忆。
- UI 测试：中断 / 失败强制展开；`/compact` 不出现用户气泡。

---

### B6. 工具渲染器注册表与分组

**ZCode 的强项**：按工具家族注册渲染器；未知工具有 fallback；内联 diff；execute 输出分组；changes 分组；子 Agent 下钻；todo 分组；CUA 分组；只读工具可合并。

**我们的现状**：`packages/ui/src/components/message-part.tsx` 约 2971 行，`switch (tool)` 覆盖 read / list / glob / grep / webfetch / websearch / task / bash / edit / write / apply_patch / todowrite / question / skill；有 `ContextToolGroup`；但缺注册表、display 投影、未知工具 fallback 的统一策略。

**要做什么**

1. 渲染器注册表：
   - key：`display.kind` 或工具名；
   - value：`{ title, subtitle, icon, body, collapsedByDefault, groupKey }`；
   - 未知工具走 `BasicTool` fallback。
2. 分组：
   - 连续只读工具（read / glob / grep / list）合并为“上下文”组；
   - 连续 execute 输出合并为“命令输出”组；
   - 同一轮文件变更合并为 changes 卡；
   - todo 工具不单独渲染，进入 todo 分组；
   - 子 Agent 渲染为可下钻卡片。
3. 内联 diff：edit / write / apply_patch 显示 `+added -removed`，点开行级 diff；使用 diff 专用语义色。
4. 只读能力：渲染器只读 part，不修改数据；折叠态不丢内容。
5. 性能：大输出默认折叠；超过 `maxResultBytes` 显示“已截断，查看文件”。

**落点**

- `packages/ui/src/components/message-part.tsx`
- 新增 `packages/ui/src/components/tool-renderers/*`
- `packages/app/src/pages/session/message-timeline.tsx`
- `packages/novaway/src/tool/tool.ts`（display 元数据）

**验收**

- 单测：每个 kind 的渲染快照。
- 交互：未知工具 fallback、长输出折叠、diff 展开。
- 性能：100 个工具调用的时间线渲染 < 200ms 增量。

---

### B7. 状态面板：section 契约与运行态

**ZCode 的强项**：section 有 `hasContent`；运行中才显示进度；首次出现自动展开一次；todo 聚焦窗口（3 条）；超过 6 条折叠；运行中子 Agent 可取消；结束态不残留。

**我们的现状**：`status-panel/status-panel.tsx` 已有 `visibleStatusSections`、`ALWAYS_VISIBLE_SECTIONS`、`AUTO_EXPAND_SECTIONS`、宽度容器查询、摘要胶囊；sections 包括 git / todo / background / agents / plan-approval / hooks / temp-files；已有模型单测。差距是 section 契约、todo 聚焦、结束态清理。

**要做什么**

1. 定义 `StatusSectionModel`：
   - `id`、`title`、`hasContent`、`summary`、`runningOnly`、`defaultOpen`、`autoExpandOnce`、`actions`。
2. 运行态：
   - todo / agents 只在运行中出现；
   - 结束后保留“完成摘要”一小段时间，再消失；
   - 失败 / 中断保留错误摘要。
3. todo：
   - 聚焦当前进行中的 3 条；
   - 总共超过 6 条时折叠；
   - 完成项收起，可展开。
4. agents：
   - 运行中显示取消按钮；
   - 点开跳转子会话；
   - 结束后显示耗时 / tokens。
5. 布局：
   - 宽容器卡片列表；
   - 窄容器胶囊 + hover 展开；
   - 无内容不渲染空壳。
6. 性能：section 按 id memo，后台心跳不重建输入框。

**落点**

- `packages/app/src/pages/session/status-panel/status-panel.tsx`
- `packages/app/src/pages/session/status-panel/*-section*.tsx`
- `packages/app/src/pages/session.tsx`

**验收**

- 单测：`visibleStatusSections` / `hasContent` / auto-expand once。
- 交互：取消子 Agent、跳转子会话、todo 聚焦。
- 回归：后台任务心跳不导致 section 重挂。

---

### B8. Side Pane：多标签、完整视图、浮动输入

**ZCode 的强项**：`tabs + activeTabId`；Diff 单例；Browser 多实例；Code Viewer 按 `sourceKey` 复用；按 `workspaceKey + ownerTaskId` 归属；最近关闭；拖拽排序；中键关闭；完整视图 `⇧⌘F`；浮动单行输入 + 吸附位置 + 最小化圆球；单 SessionPane 实例。

**我们的现状**：`session-side-panel.tsx` 已有 `Tabs`、`SortableProvider`、动态 tab（subagent / sideChat / background）、内置 preview / browser / terminal / review、拖拽、关闭、`+` 菜单；`layout.tsx` 已持久化 `tabs / activeTab / dynamic`；但缺完整视图、最近关闭、tab 总览、owner 归属契约。

**要做什么**

1. Tab 模型：
   - `tabs: SidePaneTab[]` + `activeTabId`；
   - Diff / review 单例；
   - Browser 多实例；
   - Code Viewer 按 `sourceKey` 复用；
   - 动态 tab 记录 `ownerTaskId` / `parentSessionID`，切任务不串。
2. Tab 操作：
   - 关闭当前 / 其他 / 全部；
   - 最近关闭；
   - 拖拽排序；
   - 中键关闭；
   - `Cmd/Ctrl+W` 优先关 tab，再关窗口。
3. 完整视图：
   - `⇧⌘F` / `Ctrl+Shift+F`；
   - 面板占满窗口；
   - 对话作为第一个 tab；
   - 浮动单行输入，可吸附、可最小化为圆球；
   - 只有一个 `SessionPane` 实例，避免重复订阅。
4. 布局：完整视图用绝对定位覆盖，不破坏 `react-resizable-panels` / flex 尺寸。
5. 记忆：完整视图状态按 workspace + owner 记忆；刷新不持久化。

**落点**

- `packages/app/src/pages/session/session-side-panel.tsx`
- `packages/app/src/pages/session/side-pane-session.tsx`
- `packages/app/src/context/layout.tsx`
- 新增 `packages/app/src/pages/session/side-pane-full-view.tsx`
- `packages/app/src/pages/session.tsx`

**验收**

- Tab 测试：单例、复用、拖拽、最近关闭。
- 归属测试：切任务后 tab 不串，隐藏不销毁。
- 完整视图测试：快捷键、浮动输入、最小化、恢复。
- 性能测试：Browser webview 切 tab 不重建。

---

### B9. Command Center：`Cmd+K`、范围、最近变更

**ZCode 的强项**：`Cmd/Ctrl+K`；默认展示最近变更 / 最近任务 / 命令分组；All / Actions / Tasks / Files 范围 tabs；`>` / `#` / `@` 前缀；命令分组 Suggested / Chat / Navigation / Panels / Configure / App；稳定行身份；搜索历史。

**我们的现状**：`dialog-select-file.tsx` 已把 command / file / session 混合在一个列表；空搜索显示常用命令 + 最近文件；输入后搜命令 + 会话 + 文件；默认快捷键 `mod+shift+p`；缺范围 tabs、最近变更、分组稳定身份、`Cmd+K` 默认。

**要做什么**

1. 绑定 `Cmd/Ctrl+K` 为默认 Command Center；`mod+shift+p` 可保留为别名。
2. 范围 tabs：
   - All：最近变更 + 最近任务 + 命令分组；
   - Actions：命令；
   - Tasks：最近任务；
   - Files：当前任务修改文件。
3. 默认内容：
   - Recent changes：当前任务最近修改文件，最多 3 条，显示 `+added -removed`；
   - Recent tasks：当前 workspace 最近任务，最多 3 条；
   - 命令分组：Suggested / Panels / Configure / App，空组不显示。
4. 搜索：
   - 无前缀搜命令 + 任务 + 文件；
   - `>` 命令、`#` 任务、`@` 文件；
   - 搜索历史；
   - 结果分组与上限。
5. 行身份：使用 `recent-task:${workspaceKey}:${taskId}` / `task-result:${row.key}`，不能用标题当 key。
6. 键盘：上下 / Enter / Esc / Tab 切范围；鼠标 hover 只选中目标行。

**落点**

- `packages/app/src/components/dialog-select-file.tsx`
- `packages/app/src/context/command.tsx`
- `packages/app/src/pages/session/use-session-commands.tsx`
- `packages/app/src/i18n/*`

**验收**

- 快捷键测试：`Cmd+K` / `Ctrl+K` 打开，`Esc` 关闭。
- 范围测试：四个 tab 的空搜索与有搜索行为。
- 身份测试：同工作区重名任务可独立选中。
- 性能测试：输入 200ms 内出结果（本地索引）。

---

### B10. 快捷键内核：事件码、IME、冲突检测、录制

**ZCode 的强项**：快捷键匹配用 `event.code` 而非 `event.key`；过滤 IME 组字与 repeat；精确修饰键；`CmdOrCtrl` 平台语义；可编辑区域守卫；录制器；冲突检测；可自定义绑定。

**我们的现状**：`context/command.tsx` 用 `event.key` + 修饰键签名；有 `parseKeybind` / `matchKeybind` / 冲突告警较弱；没有 IME / repeat 过滤；没有录制器与冲突面板。

**要做什么**

1. 匹配内核：
   - 优先 `event.code`，映射到可读 key；
   - 过滤 `event.isComposing`、`keyCode === 229`、`event.repeat`；
   - 修饰键必须精确匹配（多按 / 少按都不触发）；
   - `mod` 在 macOS 映射 Meta，其他平台映射 Ctrl；
   - 可编辑区域只放行显式允许的命令（终端 / 文件附件等）。
2. 命令表：
   - 每条命令有 id、标题、分类、默认绑定、作用域、启用条件；
   - 同一绑定冲突时，显示冲突并在设置中解决；
   - 允许 `none` 解绑。
3. 录制器：
   - 点击“录制”后捕获下一个组合；
   - 显示规范化文本；
   - 拒绝单独修饰键与保留键。
4. 诊断：
   - `novaway debug keymap` 或设置页显示当前绑定表；
   - 冲突列表；
   - 多入口图标一致。
5. 测试：所有绑定表驱动；平台矩阵。

**落点**

- `packages/app/src/context/command.tsx`
- `packages/app/src/components/settings-keybinds.tsx`
- 新增 `packages/app/src/context/keybind/*`
- `packages/app/src/context/command-keybind.test.ts`

**验收**

- 单测：IME / repeat / 精确修饰键 / 平台映射。
- 冲突测试：重复绑定被检测并可解决。
- 录制测试：录制、取消、非法组合。
- 手动测试：Windows / macOS 各 10 个核心快捷键。

---

### B11. 设置 IA：侧栏导航、搜索、两栏 provider

**ZCode 的强项**：设置侧栏导航 + 搜索；模型 provider 两栏；自动化 / hooks / MCP / plugins / skills / subagents 分区；稳定标题；长文案可扩展。

**我们的现状**：`dialog-settings.tsx` 用 Tabs，包含通用 / 桌宠 / 通知 / 供应商 / 浏览器 / 电脑 / 快捷键 / Agent / 插件 / MCP / 技能 / 命令 / 规则 / 用量；`settings-*` 组件较多；没有设置搜索。

**要做什么**

1. 侧栏导航：按“通用 / 模型 / 能力 / 自动化 / 数据 / 账户”分组；保持现有 tab 兼容。
2. 搜索：按标题、描述、关键词过滤；键盘上下 + Enter 跳转；空结果提示。
3. 模型 provider：左列表、右详情；模型能力、上下文、价格、图标；一键测试连接。
4. 分区：Automation / Hooks / MCP / Plugins / Skills / Subagents 各自有独立入口与空态。
5. 一致性：设置项用统一卡片 / 行 / 开关 / 下拉；不要每个页面一套。
6. 深链：`settings?tab=...&section=...` 可分享；桌面端深链可用。

**落点**

- `packages/app/src/components/dialog-settings.tsx`
- `packages/app/src/components/settings-*.tsx`
- `packages/app/src/i18n/*`

**验收**

- 搜索测试：中英文关键词都能命中。
- 深链测试：打开指定 tab / section。
- 视觉测试：窄屏单列、宽屏两栏，长文案不溢出。

---

### B12. 文件树、终端、Git：工作区工具补齐

**ZCode 的强项**：文件树带 Git 状态、粘性文件夹、搜索 worker；终端 tab 按 workspace 保活；Git graph / 分支切换 / 操作菜单 / 自动刷新。

**我们的现状**：`sidebar-files.tsx` 有文件树；`terminal-panel.tsx` 有终端；`git-panel.tsx` / `git-graph.tsx` 有 Git；`file-tabs.tsx` 有文件标签；但文件搜索、终端保活、Git 自动刷新策略需要统一。

**要做什么**

1. 文件树：
   - Git 状态点（M / A / D / ?）；
   - 粘性文件夹头；
   - 搜索 worker，避免主线程卡顿；
   - 大仓库懒加载。
2. 终端：
   - 每个 workspace 独立 PTY；
   - tab 切换不销毁；
   - 关闭确认；
   - 输出上限与滚动。
3. Git：
   - 分支切换、创建、删除；
   - 暂存 / 取消暂存 / 提交 / 撤销提交；
   - 远程 push / pull；
   - 自动刷新节流；
   - 变更文件点开 diff。
4. 安全：所有路径操作 canonicalize；不跟随 symlink 越界；终端命令走权限。

**落点**

- `packages/app/src/pages/layout/sidebar-files.tsx`
- `packages/app/src/pages/session/terminal-panel.tsx`
- `packages/app/src/pages/session/git-panel.tsx`
- `packages/app/src/pages/session/git-graph.tsx`
- `packages/novaway/src/pty/*`、`git/*`

**验收**

- 大仓库测试：10k 文件树可展开，搜索 < 300ms。
- 终端测试：切 tab 输出不丢，关闭确认。
- Git 测试：暂存 / 提交 / 撤销 / 推送主路径。
- 安全测试：symlink 越界被拒绝。

---

### B13. 运行时边界：身份、路径、交付模式、单一写入口

**ZCode 的强项**：`workspaceIdentity` vs `workspacePath`；`workspaceKey = identity?.trim() || path`；Desktop ↔ Agent 用 stdio；一个 BrowserWindow 一个 Local Host；remote 走连接注册表；continuous vs replayable；CommandInbox 串行准入；owner / lease / stale-run 守卫；单一写入口。

**我们的现状**：`context/layout.tsx` 有 `pathKey` / `sessionKey`；Side Pane 按 workspace 持久化；`session.tsx` 有 queue/guide；但缺统一文档、类型与 owner/lease 契约；桌面端 sidecar 与 Web 端的边界需要明确。

**要做什么**

1. 定义 `WorkspaceKey = identity?.trim() || path`，所有跨入口 key 统一使用；禁止只用 path 做远程 / 本地混合 key。
2. 写入所有权：
   - 每个会话同一时间只有一个 runner；
   - Side Pane 的 tab 归属 `workspaceKey + ownerTaskId`；
   - 草稿用 `__draft__`；
   - 远端 / 本地同路径不共享身份。
3. 交付模式：
   - Desktop：continuous 事件流；
   - Web / 手机：replayable，断线后按 `afterSeq` 恢复；
   - 明确 ack / snapshot / gap recovery。
4. CommandInbox：
   - 串行准入；
   - 运行中按 queue / guide 处理；
   - 权限 / 提问 / 压缩 / 目标校验期间 drain guard；
   - 失败 fail-open，不丢消息。
5. 单一写入口：UI 不直接写 session JSON / DB；所有写入走 API；本地只做 UI 状态。
6. 文档：`docs/runtime-boundaries.md`，包含进程图、时序图、失败路径。

**落点**

- `packages/app/src/context/layout.tsx`
- `packages/app/src/pages/session/session-side-panel.tsx`
- `packages/app/src/pages/session.tsx`
- `packages/novaway/src/server/routes/instance/httpapi/*`
- `packages/desktop/src/main/*`
- 新增 `docs/runtime-boundaries.md`

**验收**

- 身份测试：同路径不同 identity 不共享任务 / tab。
- 断线测试：replayable 恢复不漏事件、不重复。
- 并发测试：同一会话两个发送请求被串行化。
- 审计：无 UI 直接写库路径。

---

### B14. i18n 与可访问性

**ZCode 的强项**：键盘导航一等公民；焦点样式统一；对比度安全；为长翻译留空间；状态不只靠颜色；图标有文本标签。

**我们的现状**：18 个 locale；大量 `text-ui-*`；已有 `aria-label`；但中文 / 阿拉伯语长文案、键盘导航、对比度、focus ring 需要系统审计。

**要做什么**

1. i18n：
   - 禁止硬编码宽度导致翻译截断；
   - 文案 key 与组件同源；
   - 复数 / 变量格式化；
   - RTL 基础支持（至少不破版）。
2. a11y：
   - 所有 icon-only 按钮有 `aria-label`；
   - 菜单 / 对话框焦点陷阱与 Esc；
   - 列表键盘上下 / Home / End；
   - 状态用文字 + 颜色；
   - `prefers-reduced-motion` 生效。
3. 对比度：light / dark / 品牌模式 ≥ 4.5:1。
4. 测试：Playwright + axe（或等价）关键页面。

**落点**

- `packages/app/src/i18n/*`
- `packages/app/src/components/*`
- `packages/ui/src/components/*`
- `packages/app/e2e/*`

**验收**

- 长文案测试：中文 / 德文 / 阿拉伯文不溢出。
- 键盘测试：命令中心、设置、侧栏、对话框全键盘可达。
- 对比度测试：关键文本通过。
- reduced motion 测试：无动画也保留状态提示。

---

### B15. 新任务、空态与引导

**ZCode 的强项**：欢迎页 / 新任务 / 项目选择 / 信任确认 / 插件推荐 / 空态说明；新任务与已有任务共用 Header 骨架，用 `variant="draft"` 隐藏任务专属菜单。

**我们的现状**：`session-new-view.tsx`、`home.tsx`、`office-home` 已有丰富空态；但新任务 / 草稿 / 项目选择的骨架与信任确认需要统一。

**要做什么**

1. 新任务：复用 WorkspaceHeader 骨架；隐藏任务专属菜单；保留帮助 / 终端 / Side Pane。
2. 项目选择：最近项目、打开目录、克隆仓库；远程项目用 project ID，不复用 path。
3. 信任确认：新根目录首次打开前确认；显示将读取的路径。
4. 空态：说明“能做什么 + 下一步动作”，不要只放插图。
5. 引导：首次使用 3 步（选模型 → 选目录 → 发第一条）；可跳过；不重复弹。

**落点**

- `packages/app/src/components/session/session-new-view.tsx`
- `packages/app/src/pages/layout.tsx`
- `packages/app/src/pages/home.tsx`
- `packages/app/src/components/dialog-create-project.tsx`

**验收**

- 新任务测试：草稿 Header 不显示任务菜单。
- 信任测试：未确认不读文件。
- 引导测试：只出现一次，可跳过。
- 空态测试：每个空态有明确 CTA。

---

## 6. 反向清单：明确不做什么

### 6.1 不引入 cc 的远程耦合

| 模块                                                          | 为什么不做                                                |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| OAuth / 账户 / 组织 / 订阅                                    | 我们走 provider key / 本地配置，不需要 Anthropic 账户体系 |
| remote session / teleport / bridge / CCR                      | 产品不是云端 IDE；桌面端已用 sidecar                      |
| Datadog / first-party analytics / GrowthBook / OTEL 外发      | 隐私与合规风险；只做本地可观测                            |
| BigQuery metrics / usage / referral / overage                 | 无对应商业模型                                            |
| official marketplace / plugin autoupdate / release notes 后端 | 我们有自己的扩展与更新机制                                |
| native installer 下载后端                                     | 走 npm / 桌面安装包                                       |
| cc 的品牌、提示词、帮助文案                                   | 授权不明 + 品牌冲突                                       |

### 6.2 不引入 ZCode 的产品面

| 模块                                               | 为什么不做                              |
| -------------------------------------------------- | --------------------------------------- |
| 云端 coding plan / 套餐 / 额度                     | 与 NovaWay 商业模式不同                 |
| 手机远控 / remote device / SSH / WSL / Docker 全套 | 先做好本机 + 桌面 Sidecar；远控另立项目 |
| bot / 社区 / 官方市场                              | 不是当前差异化                          |
| 每个功能一份 CONTRACT.md                           | 只对跨进程 / 跨入口 / 单一写入口建契约  |
| 6k 行单组件                                        | 保持可维护拆分                          |
| React / Zustand / Radix 迁移                       | 不换技术栈                              |

### 6.3 不做的“架构表演”

- 不为单次使用抽 helper。
- 不为了“分层”把纯函数包成 service。
- 不引入第二套状态源（例如 Zustand + Solid store 并存）。
- 不在 UI 里直接写 DB / 文件。
- 不做没有验收标准的重构。

---

## 7. 生产级门禁（Definition of Done）

> 本节只覆盖 A/B 类（主路径与交互）。生产化另有六类门禁，见 `docs/production-readiness-gates.md`：
> C1 Agent eval、C2 安全、C3 分发、C4 诊断、C5 差异化管道、C6 数据耐久、C7 多入口运维。

### 7.1 功能门禁

- 主路径：新建会话 → 发消息 → 工具调用 → 权限 → 结果 → 压缩 → 结束。
- 异常路径：模型错误、工具错误、权限拒绝、断网、取消、崩溃。
- 恢复路径：重启后继续、fork、revert、checkpoint。
- 多入口：TUI / Web / Desktop / SDK / ACP 至少各一条 smoke。
- 降级：模型不支持工具 / 图片 / 长上下文时给出可读提示。

### 7.2 测试门禁

| 层       | 要求                                                |
| -------- | --------------------------------------------------- |
| 单测     | 核心纯函数、状态机、权限矩阵、压缩账本              |
| 集成     | 会话循环、工具调度、hooks、任务注册表               |
| golden   | 至少 9 条整轮 transcript（见 A12）                  |
| e2e      | 桌面端启动、发消息、权限、Side Pane、Command Center |
| 跨平台   | Windows / macOS / Linux 各一条 CI                   |
| 迁移     | 旧 DB 升级 + 回滚                                   |
| 故障注入 | stream 断、工具超时、DB 失败、kill 进程             |

### 7.3 性能门禁

| 指标              | 预算                                 |
| ----------------- | ------------------------------------ |
| 首屏可交互        | < 1.5s（本地）                       |
| 流式首 token 展示 | < 100ms（收到后）                    |
| 时间线 10k 行滚动 | 60fps，无长任务 > 50ms               |
| 工具调用增量渲染  | < 200ms                              |
| 命令中心搜索      | < 200ms（本地索引）                  |
| 内存              | 1 小时会话增长 < 200MB               |
| 包体              | 桌面安装包不显著回退（相对当前基线） |

### 7.4 可靠性门禁

- 所有网络请求有超时、取消、重试上限。
- 所有工具结果幂等写入。
- 所有后台任务可取消、可恢复、可标记 `lost`。
- 所有权限挂起有超时与清理。
- 所有迁移可回滚。
- 所有用户可见错误有分类与下一步。

### 7.5 安全门禁

- 路径 canonicalize + 包含检查；symlink 不越界。
- shell 命令走权限；危险命令二次确认。
- MCP server 首次连接需信任；远程 MCP 默认关闭。
- 日志脱敏：key / token / cookie / Authorization。
- Hook 不继承敏感 env；http hook 白名单。
- 发布包不含 `.env`、凭据、本地配置。

### 7.6 可观测门禁

- 日志级别遵守 A11。
- 每个 turn 有 trace id。
- 错误可按 provider / model / category 聚合。
- 用户可导出 trace；默认不外发。

### 7.7 体验门禁

- 所有 icon-only 按钮有 `aria-label`。
- 键盘可完成核心流程。
- 深浅主题、中文长文案不破版。
- 减少动画偏好生效。
- 空态有说明与 CTA。
- 错误提示说人话。

---

## 8. 实施路线图

### 8.1 阶段划分

| 阶段                | 时间        | 目标                     | 交付                                                                                                 |
| ------------------- | ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| P0 基线             | 第 1–2 周   | 建门禁与证据             | golden harness、权限矩阵骨架、turn trace、性能基线；eval harness 骨架、威胁模型、诊断包骨架、签名 CI |
| P1 快赢             | 第 3–4 周   | 用户可感知的桌面升级     | Command Center、快捷键内核、Composer 折叠 / 模式菜单、TurnFold 统一、状态面板契约                    |
| P2 内核硬化         | 第 4–6 周   | 工具 / 权限 / hooks 闭环 | Capabilities 全量、调度器、权限来源 / 审计、hook 事件表；凭据迁移、SSRF、untrusted 标记              |
| P3 上下文与任务     | 第 6–8 周   | 长会话与多 Agent 可用    | micro/reactive compact、Task Registry、崩溃恢复、fallback；迁移回滚                                  |
| P4 完整视图与生产化 | 第 8–10 周  | 桌面完整形态             | Side Pane Full View、工具渲染器注册表、设置搜索、e2e / 性能；插件隔离、更新灰度、Office / 发布冒烟   |
| P5 发布准备         | 第 10–12 周 | 达到 L2、可外发          | 三平台 smoke、迁移 / 回滚演练、诊断包、文档、发布检查表                                              |

> 时间按 3 人并行估算。C 类项目的详细拆分见 `docs/production-readiness-gates.md`。

### 8.2 依赖关系

```text
P0 golden / trace ─┬─> P2 Capabilities 全量 ─> P2 调度器 ─> P2 权限 / hooks
                   ├─> P1 Command Center / 快捷键
                   ├─> P1 Composer / TurnFold / 状态面板
                   └─> P3 compact / Task Registry ─> P3 崩溃恢复
P1 Side Pane tabs ─> P4 Full View
P2 Tool display ───> P4 工具渲染器注册表
P3 Task Registry ──> P4 状态面板 Agents/Background 统一
P4 e2e / 性能 ─────> P5 发布
```

### 8.3 优先级

| 优先级 | 内容                                                                            | 理由                             |
| ------ | ------------------------------------------------------------------------------- | -------------------------------- |
| P0     | Capabilities 全量、调度器、权限矩阵、golden、Command Center、快捷键内核         | 直接影响正确性 / 安全 / 可验证性 |
| P1     | compact 边界、Task Registry、Side Pane Full View、Composer 折叠、Sidebar 三视图 | 用户强感知，且能形成差异化       |
| P2     | 工具渲染器注册表、设置搜索、文件树 / 终端 / Git 补齐、a11y                      | 体验完整度                       |
| P3     | headless `--print`、ACP 文档、SDK 示例、性能优化                                | 生态与长期维护                   |

### 8.4 人力与排期

- 2 人：先 P0 + P1，约 5–7 周；P2 再 4–6 周。
- 3 人：内核 / 桌面 / 测试并行，约 8–10 周完成 P0–P4。
- 4 人：可把 P5 的跨平台与发布并行，约 7–9 周。

> 估算基于当前代码骨架；如果要求“与 cc 行为逐项对齐”，上限取 40 人周。若只要求“生产可用 + 关键交互对齐”，取下限 26 人周。

### 8.5 Go / No-Go 门

- **G0（第 1 周末）**：golden harness 能跑通 3 条场景；turn trace 可导出；性能基线记录。否则不进入 P1。
- **G1（第 3 周末）**：Command Center / 快捷键 / Composer 可用；无 P0 级交互回归。否则暂停新功能，修交互。
- **G2（第 5 周末）**：Capabilities 覆盖率 100%（白名单清零）；权限矩阵全绿；hook 事件表全绿。否则不进入 P3。
- **G3（第 7 周末）**：compact 账本对账；Task Registry 生命周期全绿；崩溃注入通过。否则不进入 P4。
- **G4（第 9 周末）**：三平台 e2e smoke 通过；性能预算达标；迁移 / 回滚通过。否则不发布。

### 8.6 Kill criteria

- 如果 Capabilities 全量导致 20% 以上工具行为回归，回滚到“保守默认 + 分批声明”，不强行一次改完。
- 如果 Command Center 改造成本超过 2 人周，先保留现有混合列表，只加 `Cmd+K` 与范围 tabs。
- 如果 Side Pane Full View 导致 Browser webview 重建或内存显著上升，先做“放大面板”而不是完整浮层。
- 如果 microcompact 导致模型回答质量下降，默认关闭，只保留 reactive compact。

### 8.7 前两周冲刺清单

**第 1 周：先能测、能看、能回滚**

- [ ] 建 `test/golden/turns` 目录与 runner，先落 3 条：纯文本、只读工具、写入工具。
- [ ] 加 `turn-trace` 事件，跑一轮对话导出 JSONL。
- [ ] 记录性能基线：首屏、时间线 1k / 10k 行、命令中心搜索。
- [ ] 给 `Tool.Capabilities` 加 CI 覆盖率检查，先输出“未声明清单”，不阻塞。
- [ ] 权限矩阵测试骨架：4 模式 × 6 类别，先跑通 default / plan。
- [ ] 建 `docs/runtime-boundaries.md` 初稿，明确 `WorkspaceKey` 与 owner。

**第 2 周：用户可感知的三件事**

- [ ] `Cmd/Ctrl+K` 绑定 Command Center；保留 `mod+shift+p` 别名。
- [ ] 快捷键内核切到 `event.code`，加 IME / repeat / 精确修饰键测试。
- [ ] Composer 折叠：用量 → 思考 → 模型 → 权限，四个宽度断点。
- [ ] 状态面板 section 契约，先统一 todo / agents / background。
- [ ] 侧栏 running-layer 排序，运行中 / 等待 / 后台置顶。
- [ ] 工具渲染：未知工具 fallback + 长输出折叠。

**第 3 周验收**

- 3 条 golden 稳定；trace 可导出；Command Center / 快捷键 / Composer / 状态面板 / 侧栏排序可用。
- 没有 P0 交互回归；性能基线不下降。
- 可以进入 P2 内核硬化。

---

## 9. 文件级映射

### 9.1 内核

| 能力             | 现有文件                                       | 目标文件                             | 变更                            | 测试                                       |
| ---------------- | ---------------------------------------------- | ------------------------------------ | ------------------------------- | ------------------------------------------ |
| 单轮状态机       | `session/processor.ts`、`session/run-state.ts` | 新增 `session/turn-state.ts`         | 抽状态机，接 processor / runner | `test/session/turn-state.test.ts`          |
| 工具调度         | `session/prompt.ts`                            | 新增 `session/tool-scheduler.ts`     | 只读并发 / 写入串行 / interrupt | `test/session/tool-scheduler.test.ts`      |
| Tool 能力        | `tool/tool.ts`、`tool/registry.ts`             | `tool/*.ts`                          | 全量声明 + 启动校验             | `test/tool/capabilities.test.ts`           |
| 工具 display     | `tool/tool.ts`、`sdk` schema                   | `tool/schema.ts`、UI `message-part`  | 增加 `display` 元数据           | `test/tool/display.test.ts`                |
| 权限来源         | `permission/index.ts`                          | 新增 `permission/sources.ts`         | 分层规则 + shadowed             | `test/permission/sources.test.ts`          |
| 权限审计         | 无                                             | 新增 `permission/audit.ts`           | 本地审计事件                    | `test/permission/audit.test.ts`            |
| bash 分类        | `permission/arity.ts`、`permission/plan.ts`    | 新增 `permission/bash-classifier.ts` | AST / 分词 / 危险命令           | `test/permission/bash.test.ts`             |
| 审批动作         | `permission/index.ts`、`permission/schema.ts`  | `session-permission-dock.tsx`        | allow once / always / modify    | `test/permission/approval.test.ts`         |
| Hooks 事件       | `hook/schema.ts`、`hook/service.ts`            | `session/{prompt,compaction}.ts`     | 触发点清单 + 超时               | `test/hook/events.test.ts`                 |
| 压缩边界         | `session/compaction.ts`、`message-v2.ts`       | `message-timeline.data.ts`           | boundary + UI                   | `test/session/compaction-boundary.test.ts` |
| microcompact     | 无                                             | `session/compaction.ts`              | 裁剪旧工具输出                  | `test/session/microcompact.test.ts`        |
| reactive compact | `overflow.ts`、`retry.ts`                      | `compaction.ts`                      | overflow → micro → auto         | `test/session/reactive-compact.test.ts`    |
| Task Registry    | `tool/agent_task.ts`、`background/job.ts`      | 新增 `task/registry.ts`              | 统一 TaskRecord / 状态机        | `test/task/registry.test.ts`               |
| 崩溃恢复         | `session/projectors.ts`、`storage/db.ts`       | `session/recovery.ts`                | 扫描 running → interrupted      | `test/session/recovery.test.ts`            |
| headless         | `cli/cmd/serve.ts`、`run.ts`                   | `cli/cmd/run.ts`                     | `--print` / stream-json         | `test/cli/print.test.ts`                   |
| 错误分类         | `session/retry.ts`、`message-error.ts`         | `session/error.ts`                   | 分类 + fallback                 | `test/session/error.test.ts`               |
| turn trace       | `util/log.ts`、`run/trace.ts`                  | 新增 `observability/turn-trace.ts`   | 本地事件链                      | `test/observability/trace.test.ts`         |
| golden           | `test/lib/effect.ts`                           | `test/golden/*`                      | cassette + diff                 | CI                                         |

### 9.2 桌面端

| 能力           | 现有文件                                           | 目标文件                              | 变更                          | 测试           |
| -------------- | -------------------------------------------------- | ------------------------------------- | ----------------------------- | -------------- |
| token 治理     | `app/src/index.css`、`ui/components/*`             | `ui/theme/*`                          | 统一 token / 圆角 / 间距      | Storybook 截图 |
| 壳层           | `pages/layout.tsx`、`session.tsx`                  | `layout.tsx`、`resize-handle.tsx`     | 自动收起 / 键盘拖拽           | Playwright     |
| 侧栏三视图     | `sidebar-tasks.tsx`、`sidebar-items.tsx`           | `context/layout.tsx`                  | projects / grouped / timeline | 单测 + e2e     |
| Task row       | `components/session/task-row.tsx`                  | 同左                                  | 工作流活动 / 未读 / 右键      | 单测           |
| Composer       | `components/prompt-input.tsx`                      | `prompt-input/*`                      | 折叠 / 模式菜单 / 占位符      | 交互测试       |
| 时间线         | `message-timeline.data.ts`、`message-timeline.tsx` | 同左                                  | turn unit / work segment      | 单测 + 性能    |
| 工具渲染       | `ui/components/message-part.tsx`                   | 新增 `ui/components/tool-renderers/*` | 注册表 + fallback             | 快照           |
| 状态面板       | `status-panel/*`                                   | 同左                                  | section 契约 / todo 聚焦      | 单测           |
| Side Pane      | `session-side-panel.tsx`                           | 新增 `side-pane-full-view.tsx`        | full view / 最近关闭          | e2e            |
| Command Center | `dialog-select-file.tsx`                           | 同左 + `context/command.tsx`          | Cmd+K / 范围 / 最近变更       | 单测 + e2e     |
| 快捷键         | `context/command.tsx`                              | 新增 `context/keybind/*`              | 事件码 / IME / 冲突           | 单测           |
| 设置           | `dialog-settings.tsx`                              | `settings-*.tsx`                      | 侧栏 + 搜索                   | e2e            |
| 文件树         | `sidebar-files.tsx`                                | 同左                                  | Git 状态 / 搜索 worker        | 性能           |
| 终端           | `terminal-panel.tsx`                               | 同左                                  | workspace 保活                | e2e            |
| Git            | `git-panel.tsx`、`git-graph.tsx`                   | 同左                                  | 自动刷新 / 分支               | e2e            |
| 运行时边界     | `context/layout.tsx`                               | 新增 `docs/runtime-boundaries.md`     | 身份 / owner / 交付           | 单测           |
| i18n / a11y    | `i18n/*`、`components/*`                           | 同左                                  | 长文案 / 键盘 / 对比度        | axe + e2e      |

---

## 10. 新增 ADR

| ADR     | 决策                                                         | 理由                                 |
| ------- | ------------------------------------------------------------ | ------------------------------------ |
| ADR-011 | cc 按 clean-room 行为规格吸收，不复制源码 / 提示词 / 常量    | 授权不明确；避免法律与维护风险       |
| ADR-012 | `Tool.Capabilities` 是执行器与 UI 的共同契约                 | 单一事实源；避免工具名 switch 分叉   |
| ADR-013 | 桌面端只通过语义 token 与 `@novaway/ui` 原语写 UI            | 主题 / 字号 / 平台一致性             |
| ADR-014 | 每个会话单一 runner；跨入口共享 `WorkspaceKey` 与 owner 规则 | 避免并发写与状态串台                 |
| ADR-015 | 只做本地可观测，不引入远程遥测                               | 隐私 / 合规 / 产品定位               |
| ADR-016 | TaskRegistry 是子 Agent / 后台任务 / 终端任务的唯一状态源    | 避免三套状态与 UI 适配分裂           |
| ADR-017 | 不做 Rust 全量重写，按需评估内核局部替换                     | 见 `docs/rust-rewrite-assessment.md` |

---

## 11. 验收清单

> 分级验收（L1–L4）见 `docs/production-readiness-gates.md` 第 11 节。本节只列 A/B 类的阶段验收。

### P0（必须）

- [ ] 所有注册工具都有 `capabilities`，CI 校验通过。
- [ ] 调度器按只读 / 写入 / interrupt 正确执行。
- [ ] 权限矩阵（4 模式 × 6 工具类别 × 5 来源）全绿。
- [ ] `UserPromptSubmit` / `PreToolUse` / `Stop` / `PreCompact` 的 deny 生效。
- [ ] 9 条 golden turn 全绿；故障注入可复现。
- [ ] `Cmd/Ctrl+K` 打开 Command Center；四个范围可用。
- [ ] 快捷键 IME / repeat / 精确修饰键测试通过。
- [ ] turn trace 可导出且脱敏。

### P0（生产化，新增）

- [ ] eval harness 跑通 30 条任务 × 3 provider，有基线数字。
- [ ] 威胁模型五项（凭据 / 注入 / 插件 / SSRF / MCP）各有一条验收用例。
- [ ] Windows 安装包签名进入 CI，未签名阻断发布。
- [ ] 诊断包可生成，自动扫描确认不含 key / token / prompt。

### P1（发布前）

- [ ] compact boundary + microcompact + reactive compact 账本对账。
- [ ] Task Registry 生命周期 / 级联取消 / 恢复测试通过。
- [ ] Side Pane Full View 可用，Browser 不重建。
- [ ] Composer 折叠顺序在 4 个宽度下稳定。
- [ ] Sidebar 三视图 + running-layer + 分页。
- [ ] 工具渲染器注册表覆盖所有 `display.kind`。
- [ ] 状态面板 section 契约 + todo 聚焦 + 子 Agent 取消。
- [ ] 崩溃恢复：4 个 kill 点重启后状态可读。

### P2（体验完整）

- [ ] 设置侧栏 + 搜索 + 深链。
- [ ] 文件树 Git 状态 / 搜索 worker。
- [ ] 终端 workspace 保活。
- [ ] Git 自动刷新 / 分支操作。
- [ ] 长文案 / 键盘 / 对比度 / reduced motion 通过。
- [ ] 新任务 / 项目选择 / 信任确认 / 引导。

### P3（生态）

- [ ] `novaway run --print` 文本 / JSON / stream-json。
- [ ] SDK / ACP 文档与示例。
- [ ] 三平台 CI smoke。
- [ ] 性能预算纳入 CI。

---

## 12. 证据索引

### 12.1 NovaWay

- 内核：`packages/novaway/src/{session,tool,permission,hook,team,background,acp,cli,server}`
- 数据：`packages/novaway/src/session/*.sql.ts`、`packages/novaway/src/storage`
- 桌面端：`packages/app/src/{pages,components,context}`
- UI 原语：`packages/ui/src/components`
- 测试：`packages/novaway/test`、`packages/app/**/*.test.*`
- 既有评估：`docs/rust-rewrite-assessment.md`

### 12.2 ZCode（评估快照，外部）

- `DESIGN.md`
- `docs/ui/workspace-layout.md`
- `docs/ui/workspace-sidebar-navigation.md`
- `docs/ui/sidebar-task-view-switcher.md`
- `docs/ui/side-pane-tabs.md`
- `docs/ui/side-pane-full-view.md`
- `docs/ui/command-center-cmd-k.md`
- `docs/chat/interaction-behavior.md`
- `docs/ui/v4-chat-turn-render-units.md`
- `docs/agents/runtime-boundaries.md`
- `packages/ui/src/project-sidebar/CONTRACT.md`
- `packages/ui/src/composer-toolbar-layout/CONTRACT.md`
- `packages/ui/src/side-pane-full-view/CONTRACT.md`
- `packages/ui/src/shortcuts/bindings.ts`
- `packages/ui/src/v4/{ConversationComposer,ConversationStatusPanel,SessionPane,ConversationTimeline}.tsx`
- `packages/shared/src/zcode-protocol-v4/*`

> 说明：以上 ZCode 文件来自评估时下载的上游源码，未纳入本仓库；实施时按 Apache-2.0 处理 NOTICE 与第三方声明。

### 12.3 cc（评估快照，外部）

- `src/query.ts`、`src/QueryEngine.ts`
- `src/Tool.ts`、`src/tools.ts`
- `src/services/compact/*`
- `src/utils/permissions/*`
- `src/utils/hooks/*`
- `src/tasks/*`
- `src/services/api/*`、`src/remote/*`、`src/bridge/*`（仅用于识别“不吸收”的边界）

> 说明：cc 仅作为行为参考。实施时由未接触源码的人按本文 A1–A12 的行为规格重写，并进行代码来源审查。

---

## 13. 结论

NovaWay 已经具备“生产级 Agent”的大部分骨架，缺的不是大件，而是**把大件连成闭环**：

- 内核：把已有的 Tool / Permission / Hook / Compaction / Task 能力变成**强制契约 + 可验证行为**；
- 桌面端：把已有的时间线 / Composer / Side Pane / 状态面板 / 设计 token 变成**完整交互**；
- 工程：把“能跑”变成“可回归、可观测、可恢复、可发布”。

建议按 P0 → P1 → P2 → P3 推进，先把 **Capabilities、权限矩阵、golden、Command Center、快捷键、compact 边界、Task Registry、Side Pane Full View** 八件事做完。这八件事完成后，NovaWay 在“内核可靠性”上接近 cc 的行为水准，在“桌面交互”上接近 ZCode 的完成度，同时保留国产模型、Office、内容发布、本地优先等差异化。

这比“用 Rust 重写一遍”更快、更稳，也更符合当前产品阶段。

**但要明确：以上只到 L1（内部日用）。** “对齐上游”和“生产级可用”是两个维度。生产事故主要来自 eval 缺失、凭据明文、未签名分发、无法诊断、迁移不可回滚、差异化管道不稳。这些见第 14 节与 `docs/production-readiness-gates.md`。

---

## 14. 生产化补齐索引（C 类）

完整内容见 **`docs/production-readiness-gates.md`**。这里只放索引，避免两份文档重复。

| 编号 | 类别       | 核心问题                                           | 现状（证据）                                                                     | 人周 |
| ---- | ---------- | -------------------------------------------------- | -------------------------------------------------------------------------------- | ---- |
| C1   | Agent eval | 模型在真实任务上的成功率、工具准确率、成本没有度量 | 只有 RAG / 记忆 eval；无任务级 eval                                              | 3–5  |
| C2   | 安全       | 凭据、注入、插件、SSRF、MCP                        | `auth.json` 明文 0600；插件 in-process；webfetch 无 SSRF 防护；无 untrusted 标记 | 5–8  |
| C3   | 分发       | 签名、更新校验、灰度、回滚、安装恢复               | `verifyUpdateCodeSignature: false`；`allowDowngrade: true`；无灰度 / 回滚        | 3–5  |
| C4   | 诊断       | 出了事能不能查                                     | 有日志 / export / debug，但无统一诊断包与反馈入口                                | 2–3  |
| C5   | 差异化管道 | Office、发布、OCR、知识库可靠性                    | 能跑；缺模板矩阵、幂等发布、压测                                                 | 4–6  |
| C6   | 数据耐久   | 迁移、备份、多实例、保留                           | 36 个迁移无 down；无自动备份；多实例未限制                                       | 3–4  |
| C7   | 多入口运维 | TUI / CLI / SDK / ACP / Web / Desktop 一致性       | TUI 139 测试文件；缺能力矩阵与六入口 smoke                                       | 2–3  |

### 14.1 发布分级

| 级别 | 含义       | 需要                                                                              | 累计人周（A/B + C） |
| ---- | ---------- | --------------------------------------------------------------------------------- | ------------------- |
| L1   | 内部日用   | A/B 的 P0/P1 + C1 基线 + C4 日志                                                  | 6–9                 |
| L2   | 100 人内测 | + C1 3 provider、C2 凭据 / SSRF / MCP、C3 Windows 签名、C4 诊断包、C6 迁移演练    | 20–28               |
| L3   | 公开测试   | + C2 插件隔离 / 注入、C3 公证 / 灰度 / 回滚、C5 模板矩阵 / 平台 e2e、C7 三平台 CI | 42–58               |
| L4   | 商业 GA    | + 50 条 eval、外部渗透、在线迁移、支持流程、SBOM                                  | 62–87               |

### 14.2 对原路线图的修正

| 原阶段          | 修正                                                  |
| --------------- | ----------------------------------------------------- |
| P0 基线         | 增加 eval harness 骨架、威胁模型、诊断包骨架、签名 CI |
| P2 内核硬化     | 增加凭据迁移、SSRF、untrusted 标记                    |
| P3 上下文与任务 | 增加迁移回滚、崩溃恢复                                |
| P4 生产化       | 增加插件隔离、更新灰度、Office / 发布冒烟             |
| P5 发布         | 增加三平台构建、发布检查表、支持流程                  |

结论重述：**A/B 完成 ≈ L1；C1–C7 完成 ≈ L3；L4 需再一轮以稳定性与支持为中心的迭代。**
