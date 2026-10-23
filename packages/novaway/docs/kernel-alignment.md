# 内核扩展对齐（Claude Code 兼容层）

本次改造把 Claude Code 生态中稳定的扩展契约接入 NovaWay 内核，同时保留原有的
Effect 服务化架构。所有能力都是增量式的，旧配置与旧插件无需迁移。

## 1. Tool 能力契约

`src/tool/tool.ts` 新增 `Capabilities`：

- `readOnly` / `concurrencySafe`：支持布尔值或按参数计算
- `destructive`、`maxResultBytes`、`interrupt`
- `validateInput`、`checkPermissions`
- `aliases`、`searchHint`、`deferLoading`、`alwaysLoad`

内置工具的能力表在 `src/tool/registry.ts` 的 `CAPABILITIES` 中声明。
会话级读写锁在 `src/tool/lock.ts`：只读工具并发，写工具串行。
新增 `tool_search` 工具用于按名称/关键词发现工具。

延迟加载（`experimental.defer_loading`，默认关闭）：

- `browser_*` 与 `generate_*` 默认标记 `deferLoading`
- 开启后，这些工具不进首轮请求，只把名字写进 `tool_search` 的描述
- 模型调用 `tool_search`（可用 `select:<id>` 精确指定）后，
  `src/tool/activation.ts` 按会话记录激活状态，下一次请求才带完整 schema

## 2. Hook 生命周期

`src/hook/` 提供与 `.claude/settings.json` 兼容的 hooks：

- 事件：SessionStart/End、UserPromptSubmit、Stop、Pre/PostToolUse、
  Permission\*、SubagentStart/Stop、Pre/PostCompact、Notification 等
- 执行器：`command`、`http`、`prompt`、`agent`
- 位置：`~/.novaway/hooks.json`、`.novaway/hooks.json`、`settings.json` 的 `hooks`
- 输出协议：exit 0 继续、exit 2 阻止、stdout JSON 可改写 `updatedInput`
- 旧插件 Hook（`tool.execute.before` 等）保持原样，互不影响

## 3. Extension Manifest

`src/extension/` 支持 `plugin.json` / `.claude-plugin/plugin.json`：

```json
{
  "name": "demo",
  "version": "1.0.0",
  "contributes": {
    "commands": "./commands",
    "agents": "./agents",
    "skills": "./skills",
    "hooks": "./hooks.json",
    "mcpServers": { "echo": { "type": "local", "command": ["echo"] } },
    "tools": "./tools"
  }
}
```

加载来源：内置、`~/.novaway/extensions`、项目 `.novaway/extensions`、
`~/.claude/plugins`、`.claude/plugins`、npm/git 插件。
启用状态保存在 `~/.config/novaway/extensions.json`。

HTTP API：

- `GET /extension`
- `GET /extension/contributions`
- `POST /extension/reload`
- `PATCH /extension/:name` `{ "enabled": false }`

UI：扩展页顶部「已加载扩展」区块（`settings-installed-extensions.tsx`）
直接消费上述接口，支持开关与重新扫描。

## 4. Command / Skill / Agent

- Command frontmatter 支持 `type`、`aliases`、`argument-hint`、`context: fork`、
  `allowed-tools`、`paths`、`user-invocable`、`disable-model-invocation` 等
- 同时扫描 `.novaway/{command,commands}` 与 `.claude/{command,commands}`
- Skill 支持 `context: fork`（在隔离子代理中执行）与 `paths` 条件激活
- Agent frontmatter 支持 `tools`、`disallowedTools`、`skills`、`mcpServers`、
  `hooks`、`permissionMode`、`maxTurns`、`background`、`isolation: worktree`、
  `memory`、`initialPrompt`、`effort`

## 5. 多 Agent 协作

`src/team/` + `src/tool/{team,agent_task,agent_message}.ts`：

- 团队与成员：`team_create` / `team_delete` / `team_list` / `agent_list`
- 共享任务板：`task_create` / `task_get` / `task_update` / `task_list` / `task_claim`
- 等待进展：`task_wait`（等某个任务结束，或等出现可认领的任务；返回时给出看板摘要）
- 成本：成员与任务的 token / 花费见 7.0.6
- 邮箱：`agent_message`（运行中排队，空闲时恢复会话）
- 结构化完成通知 `<task-notification>`，并发布 `agent.started/completed` 事件
- `task` 支持 `name`、`team`、`isolation: "worktree"`、`model`
- `task_stop` 可停止后台子代理
- 内置 `coordinator` agent：只委派、不写代码；可使用 `task_wait` 等看板变化、
  `monitor` 盯测试/服务（该角色下 `monitor` 需用户批准，因为它会执行命令）
- `task_wait` 在工具调用内部等待（250ms 轮询 board），避免协调者每一轮都重新列任务

HTTP API：

- `GET /session/:sessionID/team`：团队、成员、共享任务
- `POST /session/:sessionID/team/message`：向成员发消息

UI：状态面板「团队代理」区块（`status-panel/agents-section.tsx`）每 2 秒轮询
团队概览，展示成员状态、当前任务与 worktree，点击可打开子代理会话。

## 6. 编排与工作流

- `orchestrator`：后台执行、`pause`/`resume`/`cancel`/`retry`、协作式暂停
- `workflow`：执行器每步读取状态，`pause` 真正挂起，`resume` 从当前步骤继续
- BackgroundJob 元数据落 SQLite（`background_job` 表），重启时把残留
  `running` 标记为 `cancelled`
- `list()` 默认只返回本进程的 job；`list({ includePersisted: true })` 会合并表里
  的历史（最多 50 条），`get()` 在内存未命中时回落到表。会话后台面板用后者，
  否则重启后已完成的子代理会从列表里消失。`cancel()` 仍然只作用于本进程

## 6.1 SDK 兼容层

重新生成 SDK 后，带多级点号的 operationId 会生成嵌套客户端
（`client.session.background.cancel`）。`packages/sdk/js/src/v2/client.ts`
同时暴露扁平别名（`backgroundCancel`、`tempFilesClean`、`knowledge.runEval` 等），
并在类型层面通过模块声明合并补齐，旧调用点无需迁移。

## 6.2 可选能力层

协作与规划工具（team / task board / agent_message / goal / workflow /
orchestrator / mcp_setup）在 `ToolRegistry.layer` 中按需解析：只有对应服务存在时
才会注册。嵌入方与测试可以组合最小层栈，核心工具仍可用。

## 6.3 Fork 子代理（共享 prompt cache）

`task` 支持 `fork: true`。为了真正复用父会话的 provider prompt cache，fork 有三条硬约束：

1. **整段复制**：`Session.fork` 不带 `before`，把父会话消息（包括正在执行
   `task` 的那条 assistant 消息）整体复制到子会话。子会话看到的前缀与父会话
   完全相同。
2. **同一套工具与系统提示**：fork 使用父会话的 agent（忽略 `subagent_type`），
   并且不传 `tools` 覆盖。工具池、系统提示逐字节一致，否则前缀失效。
3. **占位 tool_result**：复制完成后，把继承来的 `task` 工具调用改写成
   `completed`，输出固定为 `Fork started -- processing in background`。
   所有兄弟 fork 因此对这个调用发送完全相同的字节。

递归防护：fork 子会话的指令里带 `[fork-worker]` 标记；再次请求 fork 时检测到
标记就直接失败。因为要保持工具池一致，fork 会话不再通过权限禁用 `task`，
而是靠这个标记 + 指令约束（"Do not spawn sub-agents"）。

`Session.fork` 仍支持 `before`（严格小于该 id），供"选择性分叉历史"使用。

## 6.4 扩展校验

`src/extension/validate.ts` 提供 semver 子集、`engines.novaway`、依赖与
贡献路径校验；`GET /extension` 返回 `issues[]`，扩展页按严重级别展示。

## 6.5 记忆候选可见性

全局作用域的记忆候选项以 `project_id = NULL` 存储，项目维度查询会同时返回
全局候选，避免「全局记忆在项目里看不到」。

## 6.6 配置模型保留

免费通道 loader（如 poe / regolo-ai）使用 `replaceModels: true` 时，会保留
用户在 `provider.*.models` 里显式声明的模型，避免被目录裁剪掉。

## 6.7 扩展指纹与安装历史

- `extension/package.ts`：按「相对路径 + size + mtime」计算内容指纹（跳过
  node_modules/.git/dist/build 等），用于回答「这次安装真的变了吗」
- `MAX_INSTALLS = 5` 的安装历史，可回溯上一次安装的版本与指纹
- `GET /extension/:name/integrity` 按需计算，不在启动路径上

## 6.8 市场目录纳入扫描

桌面端把市场包装在 `~/.config/novaway/marketplace/<name>@<ref>`，此前不在
内核扫描范围内。现在 `ExtensionLoader.roots()` 增加了该目录（来源标记为
`plugin`），市场安装完成后内核即可直接加载其中的 commands/agents/skills/hooks。

## 6.9 扫描缓存

`ExtensionLoader.scanCached()` 按「各根目录 mtime + 禁用列表」做 5 秒缓存，
工具注册表、技能发现、Hook 服务共用，避免每次实例启动重复遍历市场目录。
`reload` / 开关变更会先 `invalidateCache()`。

## 6.10 变更账本

`extension/lock.ts` 把每次加载结果（版本 + manifest 指纹）写入
`~/.config/novaway/extensions.lock.json`，下次启动可算出
`added / upgraded / downgraded / changed / removed`，随 `GET /extension`
返回 `status` 字段并在扩展页展示。内容未变时不重写文件。

## 6.11 市场能力下沉到内核

此前扩展只能在桌面端安装：下载、解压、git clone 都写在 Electron 主进程 IPC 里，
Web / TUI 构建能浏览市场但装不了。

现在这些能力都在内核：

| 模块                       | 职责                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `extension/marketplace.ts` | 下载、sha256 校验、zip 解压、git 浅克隆、安装记录、列出、卸载 |
| `extension/catalog.ts`     | ZCode / Claude 市场清单的防御性解析                           |

安全约束：

- 下载上限 64 MB，zip 条目上限 5000
- zip 条目校验：拒绝绝对路径、`..` 段、null 字节；同时校验 JSZip 规范化后的名字
  与 `unsafeOriginalName`，避免库自动把 `../x` 改写成 `x` 后绕过检查
- git `subdir` 必须落在仓库内
- 安装失败会回滚已创建的目录
- 卸载只允许 `<config>/marketplace` 下的路径

HTTP API：

- `GET /extension/marketplace`：已安装列表 + 两个远程目录 + 拉取错误
- `POST /extension/marketplace/install`：`{ kind: "zip" | "git", name, url, ... }`
- `DELETE /extension/marketplace/:name`：卸载并刷新注册表

安装成功后自动 `extensions.reload()`，内核立刻加载其中的
commands / agents / skills / hooks / MCP。

### 桌面端改为转发

桌面主进程的四个 IPC handler 不再自己实现安装逻辑：

| IPC                       | 现在做什么                                                         |
| ------------------------- | ------------------------------------------------------------------ |
| `marketplace-download`    | 本地 fetch（渲染层有 CORS 限制），带上与内核一致的 64 MB 上限      |
| `marketplace-install`     | 渲染层已解压，主进程只落盘并补写 `.novaway-install.json`           |
| `marketplace-git-install` | 调内核 `POST /extension/marketplace/install`，再把结果翻译成旧形状 |
| `marketplace-remove`      | 调内核 `DELETE /extension/marketplace/:name`                       |

两条安装路径（桌面 IPC / 内核 API）写同一个目录、用同一份安装记录，因此
互相可见、互相可卸载。`marketplace-git-install` 也不再往全局配置目录复制
commands/agents —— 内核会直接从 marketplace 目录加载，复制会产生两份副本。

### 6.11.1 安装版本历史与升级替换

`extension/marketplace.ts` 的安装记录（`.novaway-install.json`）现在带 `history`：

- 每次安装前先快照被替换的那份（版本、来源、时间、文件数、字节数），最多保留 5 条
- 同名的旧目录会被**移除**：以前升级 `name@1.0.0` → `name@1.1.0` 会留下两份，
  扩展加载器会把同一批命令/技能注册两次；现在"一个包只有一份安装"
- `list()` / 安装接口返回 `previous`（上一次安装），UI 据此显示
  `1.2.0 → 1.3.0` 或 `reinstalled`
- 市场列表在已安装包的版本低于目录版本时提示「可更新到 x.y.z」

版本比较按数字分段（`1.10.0 > 1.9.0`），任一侧没有版本元数据时不提示，避免误报。

## 7. 权限、上下文与压缩

- 权限模式：`default` / `acceptEdits` / `plan` / `bypassPermissions`
- System Prompt 注入 git status 快照
- PreCompact / PostCompact Hook
- 工具结果按 `maxResultBytes` 截断并落盘

## 7.0 会话级权限模式

`session.permission_mode` 是会话自有字段（不是全局配置）：

- `Permission.ask()` 优先用调用方传入的 `mode`，未传时回退 `config.permission_mode`
- `session/prompt.ts` 每次工具权限检查都带上 `session.permissionMode`
- 子代理：Agent 声明的 `permissionMode` 优先，否则继承父会话
- fork 子会话继承父会话模式（fork 的意义就是同样的运行环境）
- `PATCH /session/:id { "permissionMode": "plan" }` 修改；会话头部有模式下拉

模式语义：

| 模式                | 行为                                                   |
| ------------------- | ------------------------------------------------------ |
| `default`           | 按规则集询问/放行                                      |
| `acceptEdits`       | 写类工具（edit/write/apply_patch/patch/shell）直接放行 |
| `plan`              | 写类工具直接拒绝，读类仍走询问流程                     |
| `bypassPermissions` | 全部放行                                               |

## 7.0.1 聚合工具结果预算（microcompact）

`session/tool-budget.ts` 在**每次请求**前裁剪工具输出：

- 从最新往前累计，最近 2 条消息里的输出永不裁剪
- 累计超过预算（默认 60000 字符）后，把更旧的输出替换成占位符
- `skill` / `question` / `plan_exit` 永不被裁剪
- **只改发给模型的副本**，存储与 UI 仍保留完整内容
- 已裁剪的结果不会被重复计数，因此幂等

配置：`experimental.tool_result_budget_chars`、`experimental.tool_result_keep_recent_messages`。

这填补了「prune（清空旧输出）」与「整段压缩（summarize）」之间的空档。

## 7.0.2 Hook 统一管线（旧插件 ↔ 新事件）

旧 JS 插件的生命周期 hook 与新 JSON hooks 现在是**同一条管线**：

- `plugin` 接口新增可选的 `hook(input, output)`，对**所有**内核事件触发
- `hook/service.ts` 在 JSON hooks 之前调用它，插件因此能看到
  `SessionStart`、`Stop`、`SubagentStart/Stop`、`TaskCreated/Completed`、
  `PermissionDenied` 等**没有对应旧 hook**的事件
- 插件可写 `output.result.decision = "deny"` 直接阻断，或提供
  `updatedInput` / `additionalContext`，与 JSON hook 的输出合并

映射关系（旧 hook 仍在原调用点执行，不会被重复触发）：

| 旧插件 hook                                                      | 等价新事件          | 说明                         |
| ---------------------------------------------------------------- | ------------------- | ---------------------------- |
| `chat.message`                                                   | `UserPromptSubmit`  | 旧 hook 在用户消息创建处执行 |
| `tool.execute.before`                                            | `PreToolUse`        | 可改写 `args`                |
| `tool.execute.after`                                             | `PostToolUse`       | 可改写输出                   |
| `permission.ask`                                                 | `PermissionRequest` | 可改 status                  |
| `command.execute.before`                                         | （无对应事件）      | 命令层专用                   |
| `experimental.session.compacting`                                | `PreCompact`        | 可替换压缩提示词             |
| `experimental.compaction.autocontinue`                           | `PostCompact`       | —                            |
| `experimental.chat.system.transform`                             | （无对应事件）      | system prompt 组装           |
| `chat.params` / `chat.headers` / `shell.env` / `tool.definition` | （无对应事件）      | 请求/环境层                  |

## 7.0.3 子代理计划审批

子代理没有人类盯着，`plan_exit` 不再弹交互式询问，而是走审批协议：

1. 子代理发送结构化消息 `{"type":"plan_approval_request","plan":...}` 给团队 lead
2. 子代理通过 `session/plan-approval.ts` 阻塞等待，同时发布
   `plan_approval.requested` 事件（UI 可展示）
3. lead 回复 `agent_message` 的
   `{"type":"plan_approval_response","request_id":...,"approve":true}`，
   或调用 `POST /session/:id/plan-approval/:requestID`
4. 拒绝会带上 `feedback`，子代理因此收到 `Question.RejectedError`

主线程保持原有的交互式询问（有人可以回答）。会话被取消时，
`SessionPrompt.cancel` 会释放该会话所有挂起的审批，避免 fiber 泄漏。

UI：状态面板新增「计划待批准」区块（`status-panel/plan-approval-section.tsx`），
2 秒轮询挂起请求，支持批准 / 拒绝（拒绝可附说明）。该区块常驻，
因为子代理阻塞时主线程恰好是 idle。

## 7.0.4 Bus 驱动的事件

`FileChanged` 与 `ConfigChange` 没有属于 hook 层的自然调用点，因此改为订阅内核 Bus：

| Bus 事件                 | Hook 事件      | 说明                                                  |
| ------------------------ | -------------- | ----------------------------------------------------- |
| `file.watcher.updated`   | `FileChanged`  | 500ms 去抖 + 合并，最多 50 个路径；无该事件注册时不跑 |
| `config.updated`（新增） | `ConfigChange` | `Config.update` / `updateGlobal` 写盘成功后发布       |

实现要点：

- 订阅在首次 `ensure()`（即首次读取 hooks 配置）时建立，没有 hooks 的进程零开销
- Bus 回调是普通 JS 函数，没有 fiber 上下文，因此用 `EffectBridge` 重新进入 Effect
- 去抖由 `forkDetach` 的守护 fiber 负责（hook 服务自身没有 Scope）
- 工作目录在订阅时捕获，避免在无 instance 上下文中构造层时报 `InstanceRef not provided`

## 7.0.5 新增 Hook 事件

事件触发点（`hook/schema.ts` 里登记的每个事件都能实际到达）：

| 事件                                     | 触发点                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `SessionStart` / `SessionEnd`            | 会话创建 / 删除                                                                        |
| `UserPromptSubmit`                       | 用户消息进入一次运行                                                                   |
| `Stop`                                   | 一轮正常结束                                                                           |
| `StopFailure`                            | `Stop` hook 返回 `deny`，或触发过程本身失败                                            |
| `PreToolUse` / `PostToolUse`             | 每次工具调用前后                                                                       |
| `PostToolUseFailure`                     | 工具执行抛错（错误仍原样向上抛出）                                                     |
| `PermissionRequest` / `PermissionDenied` | 权限询问 / 规则拒绝                                                                    |
| `Notification`                           | 权限询问（`kind: "permission"`）与计划审批请求（`kind: "plan_approval"`，经 Bus 桥接） |
| `SubagentStart` / `SubagentStop`         | `task` 工具派生子代理 / 子代理结束                                                     |
| `PreCompact` / `PostCompact`             | 压缩前后                                                                               |
| `TaskCreated` / `TaskCompleted`          | 任务创建 / 进入完成或取消                                                              |
| `TeammateIdle`                           | 任务完成或 `task_stop` 把成员释放为 idle                                               |
| `InstructionsLoaded`                     | 指令文件集合首次加载或发生变化（按会话去重）                                           |
| `FileChanged` / `ConfigChange`           | Bus 驱动，见 7.0.4                                                                     |

`Notification` 的两个来源都只做通知，不参与决策；计划审批走 Bus 是因为
`session/plan-approval.ts` 不依赖 hook 服务，避免新增层依赖。

### Hook 运行状态

声明了 `statusMessage` 的 hook 在运行期间会被跟踪：

- `GET /hook/active` 返回 `{ id, event, source, message, startedAt }`
- 完成或失败时立即移除（`ensuring`，异常也不会留下转圈）
- 状态面板新增「运行中的 Hook」区块：每 800ms 轮询（空闲时 4s），
  只显示有 `statusMessage` 的 hook —— 它回答的是"这一轮为什么慢"
- 扩展页的 Hook 列表会标出「N 个带进度提示」，悬停可看具体文案

`GET /hook` 返回当前生效的注册项（`event`、`matcher`、`source`、数量、执行器类型与 `statusMessages`）。
刻意不返回命令与 URL：hook 命令里经常带密钥，而 UI 只需要说明"谁在监听什么"。
扩展页（`settings-installed-extensions.tsx`）据此渲染「生效中的 Hook」区块，
支持手动刷新；没有注册项时整块隐藏。

## 7.0.6 按代理与任务统计成本

多代理场景下"谁烧了多少 token"此前完全不可见。`session` 行本来就由 projector
把每个 `step-finish` 累加进 `cost` / `tokens_*`，因此统计直接读行，不重扫消息：

`session/usage.ts`（`SessionUsage`）：

| API                          | 作用                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| `get(id)`                    | 单个会话的 `{ cost, tokens }`                                              |
| `list(ids)`                  | 批量读取，供团队视图一次取齐                                               |
| `tree(id)`                   | 会话 + 全部后代，附合计                                                    |
| `attribute(entries, owners)` | 把树挂到最近的 owner 上（worker 自己的子代理归 worker，根会话花费归 lead） |
| `mark / readMark / delta`    | 任务成本的任务级快照与差值                                                 |

任务归因（`tool/agent_task.ts`）：

- `task_claim`（以及 `task_update` 指定 owner / 置为 `in_progress`）时把
  owner 会话当前读数写入 `metadata.usageStart`
- 任务进入 `completed / failed / cancelled` 时写入
  `metadata.usage = 当前读数 - usageStart`；回退导致的负数会被钳制为 0
- 没有 `usageStart` 的旧任务不做猜测，不会凭空产生一个"任务成本"

`GET /session/:id/team` 相应扩展（向后兼容，全部为可选字段）：

- `members[].usage`：该成员及其子代理的累计
- `tasks[].usage`：任务执行期间的花费
- `usage`：整棵树（含根会话）的合计

UI：状态面板「团队代理」标题行显示团队合计（悬停给出
input / output / cache 明细），每个成员行右侧显示自己的 `成本 · tokens`；
任务行在已有归因结果时附带任务成本。

## 7.0.7 异步事件源（`monitor`）

参考项目里的 `MonitorTool` 让代理"等一件事发生"，而不是轮询。`tool/monitor.ts` 提供：

```
monitor({ command, pattern?, timeout?, description? })
```

- 命令在后台运行，工具立即返回 jobID（复用 `BackgroundJob`，可在后台任务面板里看到）
- 三种结束方式：某行匹配 `pattern`（匹配后立即杀进程）、进程自行退出、超时
  （默认 300 秒，限制在 1..3600）
- 结束后把 `<monitor-notification>`（状态、退出码、尾部 4000 字符输出）投递到
  **agent 邮箱**。邮箱在 prompt 循环的每一步被 drain，所以忙碌中的代理会在下一轮
  工具调用时看到；空闲会话则直接恢复一轮运行
- 邮箱会过滤"自己发给自己"的消息，因此通知的发送方标记为 `monitor`
- 启动前以 **`monitor`** 权限询问（不是 `shell`）：这样"能盯命令但不能跑任意
  shell"的角色（例如 coordinator）也能用，同时审批弹窗仍会展示要执行的具体命令。
  取消用 `background.cancel(jobID)`（`task_stop` 也接受 jobID）

`monitor({ resume: jobID })` 用该任务记录下来的 command / pattern / timeout 重新启动，
因此进程重启后还能"接着盯"（运行态本身不恢复，需要显式 resume）。

PR / CI 订阅由通用版本承担，见 7.0.8。运行态与后台任务一样只存在于当前进程，
重启后需要重新启动；但**状态行**会保留 —— `background_job` 表记录
`completed / error / cancelled`，会话后台面板用 `list({ includePersisted: true })`
读取最近 50 条历史。

## 7.0.8 HTTP 订阅（`subscribe`）

`monitor` 适合"跑一个命令等它说点什么"，PR / CI / 部署回调则是轮询一个 HTTP 端点：

```
subscribe({ url, every?, match?, headers?, timeout?, description? })
```

- 在后台按 `every`（默认 60s，限制 1..3600）轮询，工具立即返回 jobID
- 给了 `match`：响应体（按行，其次整体）匹配正则就唤醒；不给：**响应体一旦变化**就唤醒
- 总时长 `timeout` 默认 3600s，限制 60..86400
- 唤醒方式与 monitor 相同：投递 `<subscription-notification>` 到 agent 邮箱，
  空闲会话直接恢复一轮
- 单次请求失败（网络抖动、5xx）不会结束订阅，下个周期继续；单次请求 30s 超时
- 权限走 `webfetch`（与抓取网页共用允许列表），`headers` 只发给请求、**不写入
  job 元数据**，避免 token 落库

这样"订阅 PR"就是 `subscribe({ url: "https://api.github.com/repos/o/r/issues/1/comments", headers: { Authorization: "Bearer …" }, match: "…" })`，
不需要额外凭据层；CI 状态、部署回调同理。

## 7.1 已知限制

- 没有专门的 `SubscribePRTool`：PR / CI / 部署订阅统一走 7.0.8 的 `subscribe`。
- 带自定义请求头的 `subscribe` 不会自动恢复（请求头从不落库），面板上标为「需重新授权」。
- `FileChanged` 由文件监视器驱动，未启用 watcher 的环境（`NOVAWAY_EXPERIMENTAL_DISABLE_FILEWATCHER`）不会触发。
- `defer_loading` 不是协议级的"延迟 schema"：内核把 `deferLoading` 工具从请求里
  过滤掉，并在 `tool_search` 的描述里列出它们的名字；模型调用 `tool_search`
  后才按会话激活（`tool/activation.ts`）。默认关闭，需 `experimental.defer_loading`。
- Fork 共享的是**前缀**（历史 + assistant + 占位 tool_result）。fork 子会话自己
  产生的后续消息当然不在父会话缓存里，这是预期行为。
- 桌面端保留了同名的 IPC handler，但它们已经是内核 API 的薄封装（见 6.11），
  不再有第二份安装实现。

## 7.2 路径包含判定的跨盘修正

`AppFileSystem.contains(parent, child)` 原先只判断 `path.relative(parent, child)`
是否以 `..` 开头。Windows 上跨盘时 `relative()` 会**原样返回**子路径
（`C:/WINDOWS` 相对 `E:/...` 仍是 `C:\WINDOWS`，不以 `..` 开头），于是
"外部路径" 全被判成"内部"：

- shell 工具的 `external_directory` 权限请求从不触发（17 个用例失败）
- read/write/edit/apply_patch 的外部目录保护在 Windows 上失效

现在：

```ts
const rel = relative(parent, child)
if (rel === "") return true
if (isAbsolute(rel)) return false // 跨盘
return rel !== ".." && !rel.startsWith(`..${sep}`) // 同时避免误伤 "..cache"
```

`overlaps()` 改为 `contains(a,b) || contains(b,a)`，共享同一套判定。
权限请求恢复后，shell 权限用例从 48/17 提升到 64/1。

## 7.2.1 会话工作目录与 `CwdChanged`

`Session.setDirectory` 修改会话行的 `directory`（和 `path`）：

- 工具读的是 `ctx.directory = session.directory`，所以后续 shell / read / write / glob
  真的从新目录执行，而不只是改个标签
- 目录必须存在且是目录，否则返回 `SessionDirectoryError`（HTTP 400）
- 目录未变化时直接返回，不触发任何副作用
- 变更成功后触发 `CwdChanged` hook，`metadata` 带 `from` / `to`

入口：

| 入口 | 用法                                        |
| ---- | ------------------------------------------- |
| 工具 | `cwd`（无参数=读取；`{ directory }`=切换）  |
| HTTP | `PATCH /session/:id { "cwd": "/abs/path" }` |

HTTP 字段叫 `cwd` 而不是 `directory`：查询参数已经占用 `directory`，同名会
在生成的 SDK 里变成 `body_directory`，破坏现有调用点。

Hook 的文件查找顺带修了一处不一致：触发前的快速路径以前只看 `input.cwd`，
会话切到子目录后就找不到项目根的 `hooks.json`，导致 `CwdChanged`（以及任何
后续事件）静默失效。现在快速路径同时检查实例的项目目录与 worktree，与
`collect()` 的扫描范围一致。

## 7.3 Hook 执行选项与输出风格

Hook 的执行选项现在都有实际语义（此前 `if` / `async` 只是被解析）：

| 字段            | 行为                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `if`            | 条件门控，不匹配则**不执行**（`ran: false`）。支持 `Tool` 与 `Tool(argPattern)` 两种写法，`*` 通配 |
| `async`         | 立即返回、不等结果；异步 hook **不能 deny**（没有结果可检查），失败只记日志                        |
| `once`          | 触发后从注册表移除（原先已实现）                                                                   |
| `timeout`       | 秒；超时按"未阻断"处理（原先已实现）                                                               |
| `statusMessage` | 仍只是被接受：内核没有"运行中状态条"这类表面，暂不消费                                             |

`if` 的匹配规则：

- `edit` → 工具名等于 `edit`
- `edit(*)` → `edit` 的任意参数
- `shell(git commit)` → 工具是 `shell`，且序列化参数里含 `git commit`
- 裸字符串（非工具名）→ 退化为对整条触发输入的包含匹配，便于按命令/URL 过滤

### 输出风格（output styles）

`session/output-style.ts` 实现了 Claude Code 的输出风格：

- 搜索顺序：`<project>/.novaway/output-styles`、`<project>/.claude/output-styles`、
  `$XDG_CONFIG_HOME/novaway/output-styles`、`~/.claude/output-styles`，以及扩展贡献的目录
- 文件是带 frontmatter 的 markdown：`name`、`description`、`keep-coding-instructions`
- 同名只保留第一个匹配；空的正文会被忽略；没有 frontmatter 时用文件名当名字
- 模型侧注入为独立的 `<output-style name="…">` 段，放在**静态前缀**（不破坏缓存）
- `keep-coding-instructions: false` 时不再使用 agent 的 `prompt`，由风格正文取代
  基础编码指令；缺省或 `true` 时叠加在原提示之后
- 选择方式：agent 配置里的 `outputStyle`；`default` 或不写表示不启用
- 扩展可通过 `contributes.outputStyles`（指向目录）提供风格

## 8. 迁移与回退

- 所有新能力均为增量：旧 `.novaway` 配置、旧 JS 插件、旧命令无需改动
- 新 Hook 总线与旧插件 Hook 并存
- `RuntimeFlags` 可关闭后台子代理等行为
- 数据库只新增表，不改动既有会话/消息结构

## 8.1 权限只有一处开关

之前同一个概念散在三处、两套叫法，用户看到的是"上面选默认、下面选自主、设置里还有个全局自动批准"。现在收敛为：

| 范围       | 唯一入口                         | 存储                                                            |
| ---------- | -------------------------------- | --------------------------------------------------------------- |
| 当前会话   | 输入框右侧的权限档位选择器       | `session.permission_mode`（内核字段，子代理继承，后端真正执行） |
| 新会话默认 | 设置 → 通用 → 「新会话默认权限」 | `config.permission_mode`（全局配置）                            |

- 档位只有一套词：`default` 每次确认 / `acceptEdits` 自主模式 / `plan` 计划模式 / `bypassPermissions` 跳过所有确认
- 会话没有显式档位时，选择器显示"实际生效的那一档"（全局默认），并在菜单里标注「默认」，不会出现显示与实际不一致
- 解析顺序抽成纯函数 `resolvePermissionMode`（会话 > 旧版目录设置 > 全局默认），有单测固定
- 会话头部原来的同名下拉菜单**已删除**；设置里原来的「全局自动批准」布尔开关**已删除**
- 「自主模式」仍保留客户端的风险判断：危险命令、越界目录照常询问（`isRiskyPermission`）
- 旧 localStorage 里的 `confirm/auto/full` 与"目录自动接受"会在读取时映射成对应内核档位，不做破坏性迁移

### 角色与档位的联动

「规划蓝图 / 锻造工程」是角色（提示词与工具形态），档位是执行闸门。两组组合是矛盾的：

- 锻造工程 + 计划模式：角色要写代码，闸门却把写操作全拒了；
- 规划蓝图 + 自主/跳过：角色自称只读，闸门却允许直接改文件。

因此界面把它们联动成**一次选择**（`context/agent-permission.ts`，有单测）：

| 操作 | 结果 |
|---|---|
| 选「规划蓝图」 | 档位自动变「计划模式」 |
| 选「锻造工程」/其它角色 | 若当前是计划模式，回到「每次确认」 |
| 选「计划模式」 | 角色自动切成「规划蓝图」 |
| 选其它档位 | 角色若是「规划蓝图」，回到「锻造工程」 |

带来的实际效果：

- 中途想让代理只读地看几个文件：直接把档位切到「计划模式」即可 —— 读文件、搜索、
  grep 都不受影响，写操作被拒绝，角色同时切到规划蓝图，不会出现"想写却被拒"的反复失败
- 想恢复改代码：随便选一个其它档位，角色自动回到锻造工程
- 打开历史会话时也会做一次对齐（旧数据里可能有矛盾组合），对齐只发生在会话加载完成之后

新建会话界面上的档位是**待定值**（`permission` store 的 `pending`，按目录记忆），
创建会话时才写入 `session.permissionMode`；它**不会**改动设置里的全局默认值。

#### 两层的判定原本不一致

对照代码会发现，「规划蓝图」角色和「计划模式」档位此前各管一套：

| | 规划蓝图（agent 规则） | 计划模式（旧 gate） |
|---|---|---|
| 编辑代码 | 拒绝（`edit: "*"` deny） | 拒绝 |
| 写计划文件 | **允许**（`.novaway/plans/*.md`） | **拒绝**（gate 先于规则短路） |
| `write` / `apply_patch` | 允许（只写规则给到了 `edit` 名） | 拒绝 |
| 只读 shell（`ls`、`git status`） | 允许 | **拒绝**（整类 shell 都被拒） |

结论：角色看起来"更松"，档位"更死"，而两者组合后行为既不是前者也不是后者。

现在把档位定义成唯一闸门，规则在 `permission/plan.ts`：

| 能力 | 计划模式 |
|---|---|
| 读文件 / 搜索 / grep | 允许 |
| 只读命令（`ls`、`cat`、`git status/diff/log`、`node -v`…） | 允许 |
| 写计划文件（计划目录下的 `.md`） | 允许（这样规划蓝图能落盘方案） |
| 改代码（`edit` / `write` / `apply_patch` / `patch`） | 硬拒绝 |
| 写盘命令（`rm`、`mv`、`git commit/push`、`npm install`…） | 硬拒绝 |
| 重定向 / 命令替换（`>`、`` ` ``、`$(…)`） | 硬拒绝 |

`isReadOnlyShell` 刻意保守：拿不准就拒绝，用户切回其它档位即可。角色层的规则
只作为第二道防线，二者在"规划蓝图 + 计划模式"下给出的结论现在完全一致。

### 项目配置写入路径修正

`PATCH /config` 以前把项目配置写到 `<项目>/config.json`，但加载器只读
`ConfigPaths.files("novaway", …)`（项目根/祖先目录里的 `novaway.json` 或 `.novaway/novaway.json`），
那次写入落在没人读的文件上——接口返回 200，配置却没生效。现在写入「加载器实际会读的
最近一个文件」，没有就新建 `<项目>/novaway.json`，并触发 `Config.Event.Updated` 与缓存失效。

扩展页也从"一页堆四块"改成三个标签：**概览**（内核能力 + 生效中的 Hook）、**已安装**（内置能力 + 已加载扩展）、**市场**（ZCode / Claude 目录，占满剩余高度）。桌面上那份基于 IPC 的重复市场实现（`settings-plugin-market.tsx`）已删除，只保留内核版安装路径。

## 9. 界面可见性（怎么确认改造已经生效）

能力不是"藏在配置里"，下面每一处都能在界面上直接看到，并且数据来自运行中的服务。

| 位置                   | 看到什么                                                                                                                        | 数据来源                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 左下角 → 扩展 → 概览   | 「内核能力」卡：工具 / 技能 / Hook / 扩展的真实数量，以及各特性开关状态                                                         | `GET /kernel`                           |
| 左下角 → 扩展 → 概览   | 「生效中的 Hook」：事件、matcher、来源、执行器类型（不显示命令，避免泄露密钥）                                                  | `GET /hook`                             |
| 左下角 → 扩展 → 已安装 | 「内置能力」开关（技能 / 浏览器 / 记忆）与「已加载扩展」：来源、版本、校验问题                                                  | `config` / `GET /extension`             |
| 左下角 → 扩展 → 市场   | ZCode / Claude 目录：已安装标签、`1.2.0 → 1.3.0` 版本变化、`可更新到 x.y.z`                                                     | `GET /extension/marketplace`            |
| 会话右上面板           | 「团队代理」：成员状态、当前任务、worktree、每人 `成本 · tokens`，团队合计在标题行                                              | `GET /session/:id/team`                 |
| 会话右上面板           | 「计划待批准」：子代理提交的计划，可批准 / 带反馈拒绝                                                                           | `GET /session/:id/plan-approval`        |
| 会话右上面板           | 「后台任务」：`监视` / `订阅` / `命令` / `编排` 标签 + 对应图标；重启后自动恢复的任务标「已恢复」，缺凭据的订阅标「需重新授权」 | `GET /session/:id/background`           |
| 会话右上面板           | 「运行中的 Hook」：声明了 `statusMessage` 的 hook 正在执行时的提示与耗时                                                        | `GET /hook/active`                      |
| 输入框右侧             | 唯一的权限档位开关：每次确认 / 自主模式 / 计划模式 / 跳过所有确认（写会话字段，子代理继承）                                     | `PATCH /session/:id { permissionMode }` |
| 工具调用卡片           | 新工具直接以普通工具卡片出现：`task_create`、`task_claim`、`task_wait`、`monitor`、`subscribe`…                                 | 工具注册表                              |

`GET /kernel` 返回的内容（实测）：

```json
{
  "version": "local",
  "tools": { "total": 73, "deferred": 0, "readOnly": 14 },
  "skills": 47,
  "hooks": { "registrations": 0, "events": 0 },
  "extensions": { "total": 0, "enabled": 0, "contributions": 0 },
  "features": [
    { "id": "permission_mode", "enabled": true, "detail": "default" },
    { "id": "tool_result_budget", "enabled": true, "detail": "60000" },
    { "id": "defer_loading", "enabled": false },
    { "id": "background_subagents", "enabled": true, "detail": "on" },
    { "id": "teams", "enabled": true },
    { "id": "plan_approval", "enabled": true },
    { "id": "async_sources", "enabled": true, "detail": "monitor, subscribe" }
  ]
}
```

`readOnly` 统计的是**声明了常量只读能力**的工具；`git` 这类按参数决定的不计入，
宁可少算也不虚报。`deferLoading` 只在 `experimental.defer_loading` 打开时才有意义，
因此关闭时 `deferred` 为 0。

### 9.1 一次走完的验证脚本

1. 打开会话，在输入框右侧把权限档位切到「计划模式」 → 请求仓库内的写操作，应被拒绝（`plan` 模式下写工具直接 deny）；会话头部不再有第二个权限入口
2. 让代理执行：`team_create` → `task_create` → `task_claim` → `task_update(status=completed)`
   → 面板出现「团队代理」，任务完成后成员变 idle，任务行带上花费
3. 让代理执行 `monitor({ command: "node -e \"console.log('READY')\"", pattern: "READY" })`
   →「后台任务」出现「监视」标签；结束后卡片保留输出摘要，主线程被唤醒
4. 让代理执行 `subscribe({ url: "https://…", match: "success" })` → 出现「订阅」标签
5. 在项目里放一个 `.novaway/hooks.json`（例如 `Stop` → `echo`），重开扩展页
   →「生效中的 Hook」出现该条；一次对话结束后 hook 实际执行
6. 装一个市场扩展后再装新版本 → 已安装标签变为 `1.2.0 → 1.3.0`，旧版本目录被移除
7. 让它执行 `cwd({ directory: "<项目>/packages" })` → 之后的 shell / read 从新目录执行；
   若配了 `CwdChanged` hook，扩展页的「生效中的 Hook」里能看到它
8. 在 `hooks.json` 里给某个 hook 加 `statusMessage`，触发它 → 状态面板出现「运行中的 Hook」
9. 启动一个 `monitor` 后重启服务 → 面板出现同名任务并标「已恢复」
