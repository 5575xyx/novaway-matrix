# NovaWay 内核对齐调研与差距快照（2026-10-20）

> 说明：这是 2026-10-20 对 `E:\AImoney\cc` / `E:\AImoney\claude-code-clean` 的调研与差距分析快照，包含当时的现状、方案与路线图。

> 实际落地结果与当前状态以 `kernel-alignment.md` 为准；两者冲突时看 `kernel-alignment.md`。

# NovaWay 内核对齐与扩展实现总纲

> 汇总前两轮调研：① 与 `E:\AImoney\cc`、`E:\AImoney\claude-code-clean` 的内核差异；② 多 Agent 协作编排的可借鉴点。  
> 目标：形成一份可直接拆任务、可直接排期的实现清单。

---

## 0. 一页结论

### 0.1 两个参考项目是什么

| 维度 | `cc` / WEPClaude | `claude-code-clean` | NovaWay |
|---|---|---|---|
| 文件数 | 1904 | 1962 | 1053 |
| TS/TSX 行数 | 约 51.4 万 | 约 50.6 万 | 约 11.1 万 |
| 运行形态 | Node + esbuild 逐文件构建 + npm | Bun 直跑源码 + preload stubs | Bun + Effect 服务 + Hono API + Solid Web/TUI |
| 定位 | 品牌化、Provider 管理、可分发 CLI | 去遥测/去指纹/去自动更新 | 服务化 AI 工作台 |
| 关键定制 | `/model` 管理 Anthropic/OpenAI Provider | 隐私清理 + `verify-privacy.sh` | 多 Provider、SQLite 会话、后台子代理、编排/工作流 |

**同源证据：**

- `cc/src/Tool.ts` 与 `claude-code-clean/src/Tool.ts` 的 MD5 完全一致；
- 顶层目录只差 `_stubs`、`ssh`；
- 多 Agent 关键文件差异仅 2–6 行，全部是把 `analytics` / `telemetry` 换成 stub。

**结论：它们不是两套架构，而是同一套 Claude Code 2.x 内核的两个发行分叉。**

### 0.2 核心策略

> **对齐“扩展契约”，不搬“单体实现”。**

- 保留 NovaWay：Effect 服务、HTTP API、多端 UI、SQLite 会话、多 Provider、后台子代理、DAG 编排、工作流。
- 对齐 Claude Code：Tool 能力契约、Hook 生命周期、Extension 清单、Command/Skill/Agent frontmatter、多 Agent 协作协议、Coordinator 编排模式。
- 不复制源码：参考项目是恢复/泄露源码分支，存在法律风险；只参考**文件格式、事件名、字段语义、行为流程**，代码自行实现。

### 0.3 能力互补关系

| 维度 | Claude Code 更强 | NovaWay 更强 |
|---|---|---|
| 单代理工具契约 | ✅ 30+ 元数据、读写并发、结果预算 | ❌ |
| 扩展生态 | ✅ `plugin.json` + marketplace + `.claude` 约定 | ⚠️ 有市场 UI，缺统一 manifest |
| 生命周期 Hook | ✅ 27 事件、4 种执行器 | ⚠️ 14 个插件 JS Hook |
| 多代理自主协作 | ✅ 共享任务列表、邮箱、idle 生命周期、coordinator | ❌ |
| 确定性编排 | ❌ 无显式 DAG | ✅ 依赖拓扑、并发、`{{taskId}}` 插值 |
| 工作流引擎 | ❌ WorkflowTool 未落地 | ✅ condition/parallel/模板 |
| 服务化 / 多端 | ❌ 单进程 Ink CLI | ✅ Effect + HTTP + Web/TUI |
| Provider 广度 | ⚠️ Anthropic 系 + 自定义 | ✅ AI SDK 多协议、模型发现、OAuth |

**理想终局：用 Claude 的协作协议，跑在 NovaWay 的服务化内核上，并保留我们的确定性编排。**

---

## 1. 内核差异总表

| 能力 | Claude Code | NovaWay 现状 | 差距等级 |
|---|---|---|---|
| Agent Loop | `QueryEngine` + `query()` 异步生成器 | `session/prompt.ts` + AI SDK + Effect 循环 | 等价，缺编排层 |
| Tool 契约 | 30+ 元数据（见 §2.1） | `id/description/parameters/execute/metadata` | **P0** |
| 工具编排 | 只读并发、写串行、最多 10 并发 | AI SDK 自动执行，无显式读写锁 | **P0** |
| 命令系统 | 3 类命令 + 86 目录 | Markdown 模板 + MCP prompt + skill | P1 |
| Skill | 与命令同模型，12+ frontmatter 字段 | 字段少，无 fork/条件激活 | P1 |
| 子代理 | 15+ 声明字段 + fork + worktree | 子会话 + 后台 + resume | P1 |
| Hooks | 27 事件 × 4 执行器 | 14 个插件 JS Hook | **P0** |
| 插件/扩展 | 统一 manifest + 市场 + 依赖/版本 | npm/git JS 插件 + 市场 UI 未下沉核心 | **P0** |
| 权限 | 4 模式 + 6 来源 + 工具级决策 | allow/deny/ask + 会话批准 | P2 |
| 上下文 | CLAUDE.md 层级 + git 快照 + 分区缓存 | AGENTS/CLAUDE + `.novaway/context` + memory | P2 |
| 压缩 | auto + micro + reactive + snip + 结果预算 | 阈值压缩 + prune + summary | P2 |
| Provider | Anthropic SDK 系 | AI SDK 多协议 | 保持 |
| 会话存储 | JSONL + sidechain | SQLite + parent session | 保持 |
| Tool UI 渲染 | Tool 内含 React 渲染方法 | UI 层解耦 | **不对齐** |

---

## 2. 可对齐 / 可扩展实现点

### 2.1 Tool 契约：从“能执行”升级为“可编排、可授权、可截断”

**参考：** `cc/src/Tool.ts`（约 30 个字段）

**现状：** `packages/novaway/src/tool/tool.ts` 只有 `id/description/parameters/jsonSchema/execute/formatValidationError`。

**目标契约：**

```ts
export interface ToolCapabilities {
  readOnly?: boolean | ((args: unknown) => boolean)
  concurrencySafe?: boolean | ((args: unknown) => boolean)
  destructive?: boolean
  validateInput?: (args: unknown, ctx: Context) => Effect.Effect<void, ToolInputError>
  checkPermissions?: (args: unknown, ctx: Context) => Effect.Effect<PermissionDecision>
  maxResultBytes?: number
  interrupt?: "cancel" | "block"
  deferLoading?: boolean
  alwaysLoad?: boolean
  searchHint?: string
  aliases?: string[]
}
```

**内置工具标注表（建议初版）：**

| 工具 | readOnly | concurrencySafe | destructive |
|---|---|---|---|
| read / glob / grep / lsp | true | true | false |
| webfetch / websearch | true | true | false |
| write / edit / apply_patch | false | false | true |
| shell | 按命令判断 | 按命令判断 | 视命令 |
| task / orchestrator / workflow | false | false | false |
| skill / question / todo | false | false | false |

**改造文件：**

| 文件 | 动作 |
|---|---|
| `packages/novaway/src/tool/tool.ts` | 新增 `Capabilities`、`validateInput`、`checkPermissions` |
| `packages/novaway/src/tool/registry.ts` | 内置工具挂载能力表，统一输出 `Def` |
| `packages/novaway/src/session/prompt.ts` | 工具包装层加参数校验、读写锁、结果预算 |
| `packages/novaway/src/permission/index.ts` | 接收工具级 `checkPermissions` |
| `packages/novaway/src/tool/truncate.ts` | 支持聚合结果预算 |

**并发控制实现建议：**

```ts
const lock = yield* SessionToolLock.make(sessionID)
const safe = resolveCapability(item, args).concurrencySafe
if (safe) return yield* effect
return yield* lock.withPermits(1)(effect)   // 写工具串行
```

**验收：**

- 只读工具并发、写工具串行；
- 参数校验失败返回模型可读错误，不抛异常；
- 单工具 / 聚合结果超限均落盘并返回路径。

---

### 2.2 Extension Manifest：一个清单，多个贡献点

**参考：** `cc/src/utils/plugins/schemas.ts` 的 `PluginManifestSchema`，支持 `commands/agents/skills/hooks/mcpServers/outputStyles/lspServers/channels`。

**现状：** 两套并行——

- 核心：`packages/novaway/src/plugin`（npm/git JS 插件）；
- UI：`packages/app/src/components/settings-plugin-market.tsx`（ZCode/Claude 市场安装），安装结果未统一进核心注册表。

**新增目录：**

```text
packages/novaway/src/extension/
  schema.ts       # ExtensionManifest
  loader.ts       # 目录 / zip / git / npm
  registry.ts     # 聚合所有来源
  marketplace.ts  # 市场、版本、依赖、完整性
```

**Manifest 草案：**

```ts
export const ExtensionManifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  description: Schema.optional(Schema.String),
  engines: Schema.optional(Schema.Struct({ novaway: Schema.String })),
  main: Schema.optional(Schema.String),        // JS 入口：hooks/tools
  contributes: Schema.optional(Schema.Struct({
    commands: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    agents: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    skills: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    hooks: Schema.optional(Schema.String),
    mcpServers: Schema.optional(Schema.Record(Schema.String, ConfigMCP.Info)),
    tools: Schema.optional(Schema.String),
    outputStyles: Schema.optional(Schema.String),
    lspServers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  })),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  permissions: Schema.optional(Schema.Struct({
    tools: Schema.optional(Schema.Array(Schema.String)),
    network: Schema.optional(Schema.Array(Schema.String)),
    filesystem: Schema.optional(Schema.Array(Schema.String)),
  })),
})
```

**加载优先级：**

1. 内置扩展
2. 用户全局 `~/.novaway/extensions`
3. 项目 `.novaway/extensions` / `.novaway/plugins`
4. Claude 兼容 `~/.claude/plugins`、`.claude/plugins`
5. 配置里的 npm/git 插件
6. 会话临时插件（`--plugin-dir`）

**统一归化：**

```ts
type Contribution =
  | { kind: "command"; data: Command.Info }
  | { kind: "agent"; data: Agent.Info }
  | { kind: "skill"; data: Skill.Info }
  | { kind: "hook"; data: Hook.Config }
  | { kind: "mcp"; data: ConfigMCP.Info }
  | { kind: "tool"; data: Tool.Def }
```

**改造文件：**

| 文件 | 动作 |
|---|---|
| 新增 `extension/{schema,loader,registry,marketplace}.ts` | 核心 |
| `packages/novaway/src/plugin/index.ts` | 旧 JS 插件作为 `Contribution` 来源适配 |
| `packages/app/src/components/settings-plugin-market.tsx` | 市场安装结果写入 Extension Registry |
| `server/routes/.../groups/instance.ts`、`settings.ts` | `/extension` 列表 / 启用 / 禁用 / 重载 |

---

### 2.3 Hook 总线：从“插件内部回调”升级为“内核生命周期事件”

**参考：** `cc/src/schemas/hooks.ts`、`cc/src/utils/hooks.ts`、`HOOK_EVENTS`（27 个）。

**现状：** `packages/plugin/src/index.ts` 只有 14 个 JS Hook。

**稳定子集（先做 8–12 个）：**

```text
SessionStart / SessionEnd
UserPromptSubmit / Stop / StopFailure
PreToolUse / PostToolUse / PostToolUseFailure
PermissionRequest / PermissionDenied
SubagentStart / SubagentStop
PreCompact / PostCompact
Notification
FileChanged / InstructionsLoaded / CwdChanged / ConfigChange
```

**Schema：**

```ts
type HookCommand =
  | { type: "command"; command: string; timeout?: number; if?: string; async?: boolean }
  | { type: "http"; url: string; headers?: Record<string, string>; timeout?: number }
  | { type: "prompt"; prompt: string; model?: string; timeout?: number }
  | { type: "agent"; prompt: string; model?: string; timeout?: number }

interface HookMatcher {
  matcher?: string
  hooks: HookCommand[]
}
```

**输出协议（与 Claude 保持一致）：**

- exit 0：继续
- exit 2：阻止当前操作，stderr 作为原因返回模型
- stdout JSON：`{ decision, reason, hookSpecificOutput: { updatedInput, additionalContext } }`
- 支持超时、`async`、`once`、`asyncRewake`

**来源：**

- `~/.novaway/hooks.json`
- `.novaway/hooks.json`
- `.novaway/settings.json` 的 `hooks`
- `.claude/settings.json`（兼容）
- `plugin.json` 的 `hooks`
- Agent / Skill frontmatter 的 `hooks`

**旧插件 Hook 映射（保持兼容）：**

| 旧 Hook | 新事件 |
|---|---|
| `chat.message` | `UserPromptSubmit` |
| `tool.execute.before` | `PreToolUse` |
| `tool.execute.after` | `PostToolUse` |
| `permission.ask` | `PermissionRequest` |
| `command.execute.before` | `CommandExecute` |
| `experimental.session.compacting` | `PreCompact` |
| `experimental.compaction.autocontinue` | `PostCompact` |
| `experimental.chat.system.transform` | `SystemPromptBuild` |

**新增文件：**

```text
packages/novaway/src/hook/
  schema.ts    # HookEvent / HookCommand / HookMatcher / HookInput / HookOutput
  service.ts   # register / trigger / 作用域
  exec.ts      # command / http / prompt / agent 四种执行器
  session.ts   # 会话级 Hook 注册（Agent/Skill 作用域）
```

**接入点：**

| 事件 | 接入文件 |
|---|---|
| SessionStart / End | `session/session.ts`、`server/routes/.../lifecycle.ts` |
| UserPromptSubmit / Stop | `session/prompt.ts` |
| PreToolUse / PostToolUse | `session/prompt.ts` 工具包装层 |
| PermissionRequest / Denied | `permission/index.ts` |
| SubagentStart / Stop | `tool/task.ts` |
| PreCompact / PostCompact | `session/compaction.ts` |
| FileChanged / CwdChanged | `watcher` / `project/instance` |

**验收：**

- JSON 配置的 shell/HTTP Hook 能拦截并改写工具输入；
- exit 2 能把原因返回模型；
- 旧 JS 插件 Hook 行为不变；
- 项目级 Hook 首次运行需确认。

---

### 2.4 Command / Skill 统一模型

**参考：** `cc/src/types/command.ts`、`cc/src/skills/loadSkillsDir.ts`。

**结论：Claude Code 里 Skill 本质就是 `type: "prompt"` 的命令。**

**扩展后的 `Command.Info`：**

```ts
export const CommandInfo = Schema.Struct({
  name: Schema.String,
  aliases: Schema.optional(Schema.Array(Schema.String)),
  description: Schema.optional(Schema.String),
  argumentHint: Schema.optional(Schema.String),
  whenToUse: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),

  type: Schema.Literals(["prompt", "action"]),
  source: Schema.Literals(["builtin", "user", "project", "plugin", "mcp", "skill"]),

  template: Schema.optional(Schema.String),   // prompt
  handler: Schema.optional(Schema.String),    // action

  model: Schema.optional(Schema.String),
  effort: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  context: Schema.optional(Schema.Literals(["inline", "fork"])),
  allowedTools: Schema.optional(Schema.Array(Schema.String)),

  paths: Schema.optional(Schema.Array(Schema.String)),
  hooks: Schema.optional(Schema.Unknown),

  userInvocable: Schema.optional(Schema.Boolean),
  disableModelInvocation: Schema.optional(Schema.Boolean),
  isHidden: Schema.optional(Schema.Boolean),
  immediate: Schema.optional(Schema.Boolean),
  sensitive: Schema.optional(Schema.Boolean),
})
```

**加载路径补齐：**

| 路径 | 现状 |
|---|---|
| `.novaway/commands/**/*.md` | ✅ |
| `.novaway/skills/**/SKILL.md` | ✅ |
| `.claude/commands/**/*.md` | ❌ 新增 |
| `.claude/skills/**/SKILL.md` | ✅ |
| `.claude/agents/**/*.md` | ❌ 新增 |
| 插件 manifest 的 commands/agents/skills | ❌ 新增 |

**Skill 执行语义：**

| 字段 | 行为 |
|---|---|
| `context: inline` | 内容展开到当前对话 |
| `context: fork` | 通过 `task` 在隔离子代理执行，`agent` 指定类型 |
| `allowed-tools` | 传递给子代理工具过滤 |
| `paths` | 模型 touch 到匹配文件后才激活（条件技能） |
| `disable-model-invocation` | 禁止模型主动调用 |
| `user-invocable: false` | 不在 `/` 补全里出现 |

**改造文件：**

| 文件 | 动作 |
|---|---|
| `config/command.ts` | 扩展 schema + 加载 `.claude/commands` |
| `command/index.ts` | 支持 `action` 类型、别名、来源 |
| `skill/index.ts` | 全量解析 frontmatter |
| `tool/skill.ts` | 支持 `context: fork` |
| `skill/prompt/*` | 与 Command 模型合并 |
| `session/prompt.ts` | 条件技能激活 |

---

### 2.5 Agent 定义与运行时：补齐声明式配置

**参考：** `cc/src/tools/AgentTool/loadAgentsDir.ts` + `runAgent.ts`。

**现状 `Agent.Info`：** `name/description/mode/native/hidden/topP/temperature/color/permission/model/variant/prompt/options/steps`。

**新增字段（合并两轮结论）：**

```ts
{
  tools?: string[]                 // 工具白名单
  disallowedTools?: string[]       // 工具黑名单
  skills?: string[]                // 预加载技能
  mcpServers?: (string | Record<string, ConfigMCP.Info>)[]
  hooks?: HooksSettings
  permissionMode?: "default" | "acceptEdits" | "plan" | "bypassPermissions"
  maxTurns?: number
  background?: boolean
  isolation?: "worktree"
  memory?: "user" | "project" | "local"
  initialPrompt?: string
  effort?: string
  omitClaudeMd?: boolean
}
```

**多 Agent 运行参数（`tool/task.ts`）：**

```ts
{
  description, prompt, subagent_type,
  name?,          // 可寻址名字
  team_id?,       // 加入团队
  task_id?,       // 续跑已有子会话
  background?,    // 后台执行
  isolation?,     // "worktree"
  cwd?,           // 工作目录覆盖
  model?,         // 模型覆盖
  permission_mode?,
}
```

**改造文件：**

| 文件 | 动作 |
|---|---|
| `config/agent.ts` | 解析新 frontmatter；支持 `.claude/agents` 和 JSON agent |
| `agent/agent.ts` | 内置 agent 增加声明字段 |
| `tool/task.ts` | 工具过滤、技能预加载、MCP 作用域、worktree、maxTurns、Agent 级 Hook |
| `tool/registry.ts` | 按 `tools/disallowedTools` 过滤 |
| `agent/subagent-permissions.ts` | 派生权限时合并工具白名单 |

**工具过滤实现：**

```ts
const allowed = new Set(agent.tools ?? ["*"])
const denied = new Set(agent.disallowedTools ?? [])
return allTools.filter(t => (allowed.has("*") || allowed.has(t.id)) && !denied.has(t.id))
```

**验收：**

- `.claude/agents/*.md` 可直接加载；
- `tools/disallowedTools` 真正影响子代理可用工具；
- `isolation: worktree` 子代理在独立 worktree 运行；
- `maxTurns` 能强制收尾。

---

### 2.6 多 Agent 协作原语（第二轮核心）

#### 2.6.1 设计原则

Claude Code 的核心洞察：

> **Teams have a 1:1 correspondence with task lists (Team = TaskList).**

以及：

> **idle 是正常状态，不是结束。**

NovaWay 的 session 模型天然支持：有 running job = active；无 running job 但 session 还在 = idle；收到消息 = `prompt()` 恢复。

#### 2.6.2 新增 `packages/novaway/src/team/`

```text
team/
  team.sql.ts       # TeamTable, TeamMemberTable
  team.ts           # Team.Service: create/delete/list/addMember/removeMember
  task-list.ts      # 共享任务列表
  mailbox.ts        # 数据库邮箱
  agent-registry.ts # 当前实例内 agent handle 索引
```

**表结构草案：**

```sql
create table team (
  id text primary key,
  name text not null,
  root_session_id text not null,
  created_at integer not null
);

create table team_member (
  team_id text not null,
  session_id text not null,
  name text not null,
  agent text not null,
  role text not null default 'worker',       -- lead | worker
  status text not null default 'idle',       -- idle | active | archived
  current_task_id text,
  worktree_path text,
  created_at integer not null,
  primary key (team_id, session_id)
);

create table agent_task (
  id text primary key,
  team_id text not null,
  subject text not null,
  description text not null,
  active_form text,
  status text not null default 'pending',    -- pending|in_progress|completed|failed|cancelled
  owner_session_id text,
  blocks text not null default '[]',
  blocked_by text not null default '[]',
  metadata text not null default '{}',
  created_by text,
  created_at integer not null,
  updated_at integer not null
);

create table agent_message (
  id text primary key,
  team_id text not null,
  from_session_id text not null,
  to_session_id text,
  broadcast integer not null default 0,
  summary text,
  content text not null,
  read_at integer,
  created_at integer not null
);
```

#### 2.6.3 任务领取：原子 SQL

避免 Claude 的文件锁 + high-water-mark 方案：

```sql
update agent_task
set owner_session_id = ?, status = 'in_progress', updated_at = ?
where id = ?
  and status = 'pending'
  and owner_session_id is null
  and blocked_by = '[]'
```

#### 2.6.4 新增工具

| 工具 | 作用 |
|---|---|
| `team_create` / `team_delete` / `team_list` | 团队生命周期 |
| `agent_list` | 列出成员：状态、当前任务、worktree |
| `agent_message` | 给指定 agent 发消息 |
| `task_create` / `task_get` / `task_update` / `task_list` | 共享任务列表 |
| `task_stop` | 停止运行中的子代理 |

**`agent_message` 语义：**

```ts
{
  to: string,                        // sessionID 或 name
  summary?: string,
  message: string,
  mode?: "queue" | "interrupt"       // 默认 queue
}
```

| 接收方状态 | `queue` | `interrupt` |
|---|---|---|
| idle | 立即 `prompt()` 恢复 | 同 queue |
| active | 写入队列，下个工具轮 drain | cancel job 后恢复 |
| archived | 返回错误 | 返回错误 |

**队列 drain 接入点：** `session/prompt.ts` 每个工具轮结束后检查 pending message，作为 synthetic user part 注入下一轮。

#### 2.6.5 结构化完成通知

现状 `backgroundMessage` 只有 `task_id/state/text`。替换为：

```xml
<task-notification>
<task-id>{sessionID}</task-id>
<name>{agent name}</name>
<status>completed|failed|cancelled</status>
<summary>{description}</summary>
<result>{final text}</result>
<usage>
  <total_tokens>N</total_tokens>
  <tool_uses>N</tool_uses>
  <duration_ms>N</duration_ms>
</usage>
<worktree>
  <path>...</path>
  <branch>...</branch>
</worktree>
</task-notification>
```

同时发 Bus 事件：

```ts
yield* bus.publish(Agent.Event.Completed, {...})
```

#### 2.6.6 worktree 隔离接线

`worktree/index.ts` 已有 `create/list/remove/reset`，接入 `tool/task.ts`：

```ts
const isolation = params.isolation ?? next.isolation
const worktree = isolation === "worktree"
  ? yield* worktreeSvc.create({ name: `${next.name}-${params.description}` })
  : undefined
const cwd = worktree?.directory ?? params.cwd ?? ctx.directory
```

需要 `InstanceState` / `ctx.directory` 支持子会话 cwd 覆盖。

#### 2.6.7 Agent 面板 UI

新增 `packages/app/src/pages/session/agent-panel.tsx`：

- 树形：root session → 子 agent
- 每个 agent：状态、当前任务、当前工具、token、worktree
- 操作：查看 transcript、发消息、停止

---

### 2.7 编排模式：两种并存

#### 模式 A：DAG 计划编排（强化现有 orchestrator）

**现状：** `orchestrator/orchestrator.ts` 有依赖拓扑 + 并发 + `{{taskId}}` 插值，但**在工具调用里同步执行**。

**补齐：**

- 后台执行 + 完成通知
- 每任务 `timeout` / `retry` / `cancel`
- 任务级事件流
- 运行中 `add_task`
- 失败策略：`continue` / `abort` / `retry`
- 工具增加 `cancel` / `pause` / `resume` / `retry_task`

**状态机：**

```text
draft
  → running
      → running（wave 完成）
      → paused（用户/超时）
      → completed
      → failed（不可恢复）
  → cancelled
```

**任务状态：**

```text
pending → ready（依赖全完成）→ running → completed
                                      → failed → retrying → running
                                      → cancelled
```

#### 模式 B：Coordinator 自主编排（新增）

**参考：** `cc/src/coordinator/coordinatorMode.ts`

**新增 `packages/novaway/src/session/coordinator.ts`：**

- `COORDINATOR_PROMPT`
- 内置 `coordinator` agent：

```ts
{
  name: "coordinator",
  mode: "primary",
  tools: ["task", "agent_message", "agent_list", "task_create", "task_update", "task_list", "task_stop", "read", "grep", "glob"],
  disallowedTools: ["write", "edit", "apply_patch", "shell"],
  prompt: COORDINATOR_PROMPT
}
```

**提示词骨架（直接借鉴 Claude 的章节结构）：**

```text
# 角色
你是协调者，不直接写代码。你的工作是：
- 理解用户目标
- 派工、继续、停止 worker
- 综合结果并向用户汇报
- 能自己回答的问题不要派工

# 工具
agent / agent_message / task_stop
task_create / task_update / task_list
agent_list

# 阶段
1 Research（并行 worker）
2 Synthesis（你自己做，必须读懂）
3 Implementation（按文件集串行）
4 Verification（新开 worker，证明能跑）

# 并发
- 只读任务可并行
- 写任务按文件集串行
- 验证可与不同区域的实现并行

# 写 worker prompt
- worker 看不到你的对话，prompt 必须自包含
- 必须包含：目标、已知信息、文件路径/行号、边界、完成定义
- 禁止 "based on your findings..."、"按研究结果去实现"

# Continue vs Spawn
（见下表）

# 失败处理
- 继续同一个 worker，带上错误上下文
- 方向错误用 task_stop 停掉，再发新指令

# 通知
worker 完成会以 <task-notification> 回来，不要伪造结果。
```

**Continue vs Spawn 决策表（照搬语义）：**

| 情况 | 做法 | 原因 |
|---|---|---|
| 研究正好探索了要改的文件 | Continue | 上下文重叠高 |
| 研究很广、实现很窄 | Spawn fresh | 避免探索噪音 |
| 修正失败/延续最近工作 | Continue | 有错误上下文 |
| 验证别人刚写的代码 | Spawn fresh | 避免实现假设污染 |
| 第一次方向完全错了 | Spawn fresh | 避免锚定失败路径 |
| 完全无关任务 | Spawn fresh | 无上下文可复用 |

**开关：** `RuntimeFlags.coordinatorMode`。

**模式选择建议：**

- 用户明确说“按计划/流水线执行” → DAG
- 用户说“帮我完成一个复杂目标” → Coordinator
- Coordinator 内部也可调用 `orchestrator` 做确定性批次

#### 模式 C：Workflow（保留，补齐 pause/resume）

**现状：** `workflow` 有 condition/parallel/模板，但 `pause/resume` 只改状态字段，执行器不认。

**补齐：**

- 执行器在每步之间检查 `paused` 状态并挂起
- `resume` 从 `currentStep` 继续
- run 级事件与 UI

---

### 2.8 权限：补模式与来源

**参考：** `cc/src/utils/permissions/`、`GETTING_SOURCES`。

**目标：**

```ts
type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"
type RuleSource = "managed" | "user" | "project" | "local" | "cli" | "session" | "agent" | "plugin"
```

**优先级：**

```text
deny > ask > allow
managed > cli > project-local > project > user > session > agent/plugin
```

**改造文件：**

| 文件 | 动作 |
|---|---|
| `permission/schema.ts` | 增加 mode、source |
| `permission/evaluate.ts` | 按来源排序 |
| `permission/index.ts` | 工具级 `checkPermissions` |
| `config/permission.ts` | 支持 `defaultMode`、`additionalDirectories` |
| UI | 展示“这条规则来自哪里” |

---

### 2.9 上下文与压缩

#### 上下文补齐

| 能力 | 参考 | 接入 |
|---|---|---|
| git status 快照 | `cc/src/context.ts` | `session/system.ts` 或 `instruction.ts` |
| System Prompt Sections 缓存 | `cc/src/constants/systemPromptSections.ts` | `session/system.ts` |
| 条件指令 / 条件技能 | `paths` frontmatter | `session/prompt.ts` |
| memory prefetch | 已有 | 保持 |

#### 压缩补齐

| 能力 | 参考 | 接入 |
|---|---|---|
| 聚合 tool result budget | `toolResultStorage.ts` | `session/prompt.ts`、`tool/truncate.ts` |
| microcompact | `services/compact/microCompact.ts` | `session/compaction.ts` |
| Pre/PostCompact Hook | `hooks.ts` | `session/compaction.ts` |
| 压缩后保留意图 | `compact.ts` | `session/compaction.ts` |

---

## 3. 统一路线图

### P0：扩展契约底座（2–3 周）

| # | 任务 | 主要文件 | 产出 |
|---|---|---|---|
| 1 | Tool 能力元数据 | `tool/tool.ts`、`tool/registry.ts` | 所有内置工具声明 readOnly/concurrencySafe/destructive/maxResultBytes |
| 2 | 工具校验与权限 | `tool/tool.ts`、`permission/index.ts` | validateInput / checkPermissions 接入 |
| 3 | 读写并发控制 | `session/prompt.ts` | 只读并发、写工具会话级串行 |
| 4 | 聚合结果预算 | `session/prompt.ts`、`tool/truncate.ts` | 超限落盘 |
| 5 | Hook schema + 服务 | 新增 `hook/{schema,service,exec}.ts` | 8–12 个核心事件 |
| 6 | 旧插件 Hook 适配 | `plugin/index.ts` | 旧 Hook 映射到新事件 |
| 7 | Extension Manifest | 新增 `extension/{schema,loader,registry}.ts` | `plugin.json` + `.claude` 目录 |
| 8 | Extension API | `server/.../instance.ts`、`settings.ts` | 列表/启用/禁用/重载 |
| 9 | Agent.Info 新字段（schema） | `config/agent.ts`、`agent/agent.ts` | 解析但不一定全部生效 |
| 10 | 契约测试 | `test/tool/*`、`test/hook/*`、`test/extension/*` | 兼容性回归 |

**P0 完成标志：**

- 任意 Claude 格式插件目录可直接加载；
- 现有 npm/git JS 插件无需修改；
- 写工具并发测试通过；
- 工具结果超限自动落盘。

### P1：协作原语 + Command/Skill（2–3 周）

| # | 任务 | 主要文件 | 产出 |
|---|---|---|---|
| 11 | 团队 / 成员 / 任务 / 邮箱表 | 新增 `team/*` | SQLite schema + Service |
| 12 | 共享任务工具 | 新增 `tool/team_*.ts`、`tool/task_*.ts` | create/get/update/list/stop |
| 13 | agent_message | 新增 `tool/agent_message.ts`、`team/mailbox.ts` | queue / interrupt |
| 14 | 队列 drain | `session/prompt.ts` | 工具轮后注入 |
| 15 | 结构化完成通知 | `tool/task.ts` | `<task-notification>` + Bus 事件 |
| 16 | worktree 隔离 | `tool/task.ts`、`worktree/index.ts` | `isolation: "worktree"` |
| 17 | Agent 工具过滤 | `tool/registry.ts`、`tool/task.ts` | tools/disallowedTools/skills/mcpServers |
| 18 | Command schema 扩展 | `config/command.ts`、`command/index.ts` | prompt/action、alias、context |
| 19 | `.claude` 命令/代理兼容 | `config/paths.ts`、`config/agent.ts` | 双读 |
| 20 | Skill frontmatter 全量 | `skill/index.ts` | fork / paths / allowed-tools |
| 21 | Agent 面板 | `packages/app/src/pages/session/agent-panel.tsx` | 树形状态、消息、停止 |

**P1 完成标志：**

- coordinator 并行派 3 个 research worker，全部完成后汇总；
- 运行中给 worker 发消息，下个工具轮注入；
- 两个 write worker 在各自 worktree 并行；
- UI 实时显示 agent 状态。

### P2：编排模式（2–3 周）

| # | 任务 | 主要文件 | 产出 |
|---|---|---|---|
| 22 | Coordinator agent + 提示词 | 新增 `session/coordinator.ts` | 工具面裁剪、阶段流程 |
| 23 | Orchestrator 后台化 | `tool/orchestrator.ts`、`orchestrator/orchestrator.ts` | 不阻塞、完成通知 |
| 24 | 任务超时/重试/取消 | `orchestrator/*` | 失败策略 |
| 25 | Workflow pause/resume | `workflow/executor.ts`、`tool/workflow.ts` | 真正挂起/恢复 |
| 26 | 权限模式与来源 | `permission/*` | mode + source |
| 27 | 上下文分层 | `session/system.ts` | git 快照 + sections |
| 28 | microcompact | `session/compaction.ts` | 压缩前裁剪 |

**P2 完成标志：**

- `orchestrator` 计划后台执行，不阻塞主会话；
- 失败任务按策略重试或中止；
- `workflow` pause/resume 生效；
- coordinator 模式无法直接写文件。

### P3：高级能力与生态（2 周+）

| # | 任务 | 说明 |
|---|---|---|
| 29 | Fork 子代理 | 继承父上下文 + 共享前缀缓存 |
| 30 | Plan approval | worker 计划审批流 |
| 31 | 协作 Hooks | SubagentStart/Stop、TeammateIdle、TaskCreated/Completed |
| 32 | 异步事件源 | 后台进程监视、定时、PR 事件 |
| 33 | Extension 市场版本化 | 版本、依赖、完整性校验 |
| 34 | 隐私开关与验证 | 参考 `verify-privacy.sh` 思路 |
| 35 | 成本 / Token 统计 | 按 agent / task 维度 |

---

## 4. 文件级改造清单（汇总）

| 模块 | 现有文件 | 动作 |
|---|---|---|
| Tool 契约 | `tool/tool.ts` | 扩展 capabilities / validate / permission |
| 工具注册 | `tool/registry.ts` | 能力表 + agent 工具过滤 |
| 工具编排 | `session/prompt.ts` | 读写锁、参数校验、预算、Hook、消息 drain |
| 命令 | `config/command.ts`、`command/index.ts` | 扩展 schema、action 类型、`.claude` 兼容 |
| 技能 | `skill/index.ts`、`tool/skill.ts` | frontmatter 全量、fork 执行、条件激活 |
| 代理 | `config/agent.ts`、`agent/agent.ts` | 新字段、`.claude/agents` |
| 子代理 | `tool/task.ts` | name/team/isolation/cwd/model、结构化通知 |
| 编排 | `orchestrator/orchestrator.ts`、`tool/orchestrator.ts` | 后台化、重试、取消 |
| 工作流 | `workflow/executor.ts`、`tool/workflow.ts` | pause/resume |
| 权限 | `permission/*` | mode + source + 工具级决策 |
| 上下文 | `session/system.ts`、`session/instruction.ts` | git 快照、sections |
| 压缩 | `session/compaction.ts`、`session/overflow.ts` | microcompact、预算、Hook |
| 插件 | `plugin/index.ts` | 适配到 Contribution |
| 扩展 | 新增 `extension/*` | manifest / loader / registry / marketplace |
| Hook | 新增 `hook/*` | schema / service / exec / session |
| 团队 | 新增 `team/*` | team / task-list / mailbox / registry |
| 服务端 | `server/routes/.../groups/{instance,settings,orchestrator}.ts` | 新 API |
| UI | 新增 `agent-panel.tsx`；改 `settings-plugin-market.tsx` | 状态面板、安装下沉 |

---

## 5. 明确不做

| 不做 | 原因 | 替代 |
|---|---|---|
| 整体替换内核为 Claude Code | 架构不兼容（Ink 单进程 vs Effect 服务） | 对齐契约 |
| 复制参考项目源码 | 恢复/泄露源码分支，法律风险 | 参考格式与语义，自行实现 |
| Tool 内 React 渲染方法 | 与终端 UI 强耦合 | 展示元数据放 UI 层 |
| tmux / iTerm2 pane backend | 解决终端分屏，我们无此约束 | 后台 fiber + Web 子会话面板 |
| 文件任务列表 + lockfile | 多进程锁复杂易碎 | SQLite 事务 + 原子更新 |
| AsyncLocalStorage 作为核心隔离 | 已是 Effect 服务 + session 上下文 | Effect FiberRef / 显式 ctx |
| 7 种 Task 类型一次做完 | 功能膨胀 | 先做 agent / shell / orchestrator |
| 189 个命令 / 27 个 Hook 全量 | 不现实 | 稳定子集 |
| 遥测 / GrowthBook / 自动更新 / Bridge / Voice / Buddy | 非内核扩展能力 | 不做 |
| 全局 AppState 可变单例 | 我们是服务化架构 | InstanceState + Bus |

---

## 6. 兼容策略

1. **配置双读**：以 `.novaway` 为主，同时读 `.claude` 的 commands/agents/skills/hooks/settings.json。
2. **插件双轨**：旧 JS 插件继续走 `plugin/index.ts`；新扩展走 `extension/registry.ts`，内部统一成 `Contribution`。
3. **Hook 双轨**：旧插件 Hook 由适配器映射到新事件，避免一次性迁移。
4. **Schema 版本化**：`plugin.json` 增加 `manifestVersion`，默认 `1`。
5. **Feature flag**：新 Hook 总线、Tool 能力、Extension 加载器、Coordinator 都放在 `RuntimeFlags` 后面，默认开启但可回退。
6. **数据不迁移**：SQLite 会话、消息、part 结构不动，只增加元数据字段。

---

## 7. 验收标准（合并两轮）

### 内核契约

1. Claude 格式插件目录（含 commands/agents/skills/hooks/mcp）可直接加载。
2. 现有 npm/git JS 插件无需修改。
3. 只读工具并发、写工具串行。
4. 工具参数校验失败返回模型可读错误。
5. 单工具/聚合结果超限自动落盘。
6. shell / HTTP Hook 能拦截并改写工具输入。
7. Hook exit 2 能把原因返回模型。
8. `.claude/skills` 技能可被 `skill` 工具调用。
9. `context: fork` 技能在隔离子代理运行。
10. Agent frontmatter 的 `tools/disallowedTools/skills/mcpServers/isolation` 生效。

### 多代理协作

11. coordinator 并行派 3 个 research worker，全部完成后自动汇总。
12. research worker 发现 bug 后，coordinator 用 `agent_message` 让同一个 worker 继续修复。
13. 两个 write worker 在各自 worktree 并行修改，互不干扰。
14. 一个 worker 失败，coordinator 用错误上下文继续它。
15. UI 实时显示 agent 状态、当前任务、当前工具。
16. 运行中给 worker 发消息，在下一个工具轮被注入。

### 编排

17. `orchestrator` 计划后台执行，不阻塞主会话，完成后通知。
18. 任务超时/失败后按策略重试或中止。
19. `workflow` pause/resume 真正生效。
20. Coordinator 模式模型无法直接写文件。

---

## 8. 风险与应对

| 风险 | 说明 | 应对 |
|---|---|---|
| 法律风险 | 参考项目为恢复/泄露源码 | 只参考格式与语义，代码自研 |
| 并发写冲突 | 多 worker 改同一文件 | worktree 隔离 + 文件集级串行 |
| Token 爆炸 | 每 worker 独立上下文 | prompt 预算、one-shot agent 精简尾部、结果压缩 |
| 无限派生 | worker 再派生 worker | 默认禁止子代理使用 task/agent；fork 递归检测 |
| 消息风暴 | 广播 + idle 通知 | 默认只 leader→worker，广播显式开启 |
| 任务列表漂移 | worker 忘更新状态 | 完成强制 task_update；Stop 自动标记 idle |
| 长任务卡住 | 无超时 | 每 task 默认超时 + task_stop |
| 后台丢失 | BackgroundJob 内存态 | P0 把 job 元数据落 SQLite |
| Hook 安全 | 可执行任意命令 / 外发数据 | 首次信任确认、env 白名单、SSRF 防护 |
| 功能膨胀 | 27 事件 / 189 命令 | 稳定子集先行，按 P0→P3 推进 |
| Windows 兼容 | shell Hook 引号/路径 | 统一 shell 配置，PowerShell/Bash 检测 |
| 权限回归 | 新来源与旧 session 批准冲突 | 旧规则作为 session 来源，优先级明确 |

---

## 9. 最终建议

### 9.1 顺序

```text
P0 契约底座
  Tool 能力 → Hook 总线 → Extension 清单
      ↓
P1 协作原语
  团队/任务/邮箱 → agent_message → 结构化通知 → worktree → Agent 面板
  Command/Skill/Agent frontmatter 对齐
      ↓
P2 编排
  Coordinator 模式 + Orchestrator 后台化 + Workflow pause/resume
      ↓
P3 高级
  Fork → Plan approval → 异步事件 → 市场版本化 → 隐私验证
```

### 9.2 最高 ROI 的五件事

1. **Tool 能力元数据 + 读写并发**——决定后续所有编排是否安全。
2. **共享任务列表 + agent_message**——多代理协作的地基。
3. **worktree 隔离**——并行写的前提，且我们已有完整实现，只差接线。
4. **Coordinator 提示词 + 工具面裁剪**——纯提示词工程，立刻获得自主编排能力。
5. **Extension Manifest + `.claude` 兼容**——直接吃下 Claude 生态的 skills/agents/commands/plugins。

### 9.3 终局形态

> **Claude Code 的协作协议 + NovaWay 的服务化内核 + NovaWay 的确定性编排。**

- 单代理：Tool 契约与 Hook 对齐 Claude；
- 多代理：共享任务列表、邮箱、idle 生命周期、coordinator 自主学习；
- 确定性：保留并强化 orchestrator DAG 与 workflow；
- 生态：统一 Extension Manifest，兼容 `.claude` 与 `plugin.json`；
- 多端：Web / Electron / TUI 共享同一套内核事件。

### 9.4 下一步建议

从 **P0 第 1–3 项**开始：

1. `tool/tool.ts` 增加 `Capabilities`；
2. `tool/registry.ts` 给全部内置工具标注能力；
3. `session/prompt.ts` 接入读写锁与参数校验。

这三项完成后，P1 的任务列表、消息队列、worktree 隔离才有安全的执行基础。
