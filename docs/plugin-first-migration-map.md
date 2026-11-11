# 插件迁移依赖图与候选内核审查（2026-11-08）

> 这是阶段 0 的滚动证据，不是阶段 0 验收完成证明。按实现进度更新；“未核全”项仍然阻断阶段门槛。
> 证据范围：当前源码调用/import、`kernel.manifest.json` 与 `test/architecture/kernel-boundary.baseline.json`。完整符号级 DAG 仍需在迁移切片中逐步补齐，不把下列高层依赖图冒充全仓 DAG。

## 1. 生产依赖图（当前代码，不是目标图）

```text
HTTP instance routes (server.ts / instanceRoutes)
  ├─ Plugin HTTP handlers
  │    ├─ PluginHost.inspect: discovery / parse / dependency checks (no execution)
  │    ├─ PluginRuntimeService (per InstanceState directory)
  │    ├─ PluginStorage (plugin_state / KV / migration ledger)
  │    └─ Bus plugin.changed (handler-local generation / SSE)
  ├─ ToolRegistry.defaultLayer (same route layer + InstanceState)
  │    ├─ Runtime Host tool registry -> PluginToolRuntime.adaptTool -> Tool.Def
  │    ├─ static first-party Tool.Def imports (capability implementations)
  │    ├─ ExtensionLoader custom tool scan / old Plugin hooks
  │    └─ ids/tools/all -> LLM/tool execution; experimental MCP tool call is separate
  └─ Agent / Command / Skill and domain service layers
       ├─ Agent reads configured/markdown and static `agencyAgents`
       ├─ Command reads filesystem/config/MCP and static templates
       ├─ Skill reads built-in prompt markdown + ExtensionLoader contributions
       ├─ Provider uses legacy `Plugin`/auth/config registration and provider registry
       ├─ Office Platform has an independent office engine/service route
       └─ Publish / surfaces / schedulers / events lack a unified production consumer

PluginContext (third-party, in-process L0; not a sandbox)
  -> manifest capability guards + Host-bound contribution registries
  -> per-activation AbortSignal/resources -> runtime registry snapshot consumers
```

### 目前可证明的顺序约束

1. M0 Host/identity/secrets/toggle/snapshot contract → ToolRegistry 统一读取和缓存失效 → 先完成 D1/D9 的工具演练；否则后续业务插件没有可信执行通路。
2. Tool/Agent/Skill/Command 的目标 consumers 与 legacy adapters 都稳定后，才迁 Provider/Office/Publish/UI；这些已有各自 service 与权限/生命周期，不应先把声明显示出来就称为统一运行。
3. 任一 domain plugin slice：声明发现/校验 → 同一 Host 激活/失败/停用 → consumer snapshot 更新 → 真实调用 → restart-free toggle test → 桥退出测试。跨域依赖以调用图重新校正，不先假定领域互相独立。
4. 默认发行组合与宿主 UI 在可运行 contribution slices 后做；D1–D9 全集、B1–B3 和适用全仓回归最后结项。

## 2. 候选内核工具逐项判断（审查结论，后续须以迁移测试证实）

| 候选 | 当前证据/初步结论 | 目标边界 |
|---|---|---|
| `read` | 工具调用协议、路径权限和文件读取实现分离；具体文件读取是可替换能力 | 保留 tool protocol/permission，迁移 file capability |
| `write` | 写入权限、冲突/审查与文件 IO 相联 | 保留执行协议与权限，文件 writer 以受管贡献替换；兼容原 permission 行为 |
| `edit` | 编辑命令实现属 capability，变更协议/权限属内核 | 同 write；D1 安全/权限行为对照 |
| `apply_patch` | patch parsing/application 是特定文件能力，调用授权仍是内核边界 | capability contribution；保留共享 patch DTO/权限核查 |
| `glob` | 工作区扫描与 ignore/路径规则是 file capability | 移出静态分发，统一文件访问/范围权限 |
| `grep` | ripgrep 执行与工作区权限分属 capability / kernel | capability contribution；保留进程与路径限制原语 |
| `bash` | 命令执行、进程隔离、权限确认不可下放为无治理插件 | shell tool 可替换；spawn/终止/授权作为 kernel API |
| `task` | subagent orchestration 与领域流程高度耦合，当前依赖 SessionPrompt、Agent、BackgroundJob、Team | 执行循环/权限留核；工作流可拆成有权限的 agent/command contribution；需迁移证明 |
| `task_status` | 后台任务状态适配，依赖 BackgroundJob/Session 状态协议 | 保留 job handle/protocol，状态工具包装可插件化 |
| `todowrite` | session-local todo 功能与持久化协议相关 | 保留会话状态原语，UI/提示/具体 manager 可贡献化 |
| `question` | permission/elicitation 边界是内核服务；交互呈现可替换 | 保留请求与权限协议，具体界面 adapter 是 UI contribution |
| `skill` | 消费 Skill 注册表和会话提示拼接 | skill 搜索/内容应来自统一贡献；执行器/提示注入协议留核 |
| `tool_search` | ToolRegistry 延迟加载/当前工具快照与模型协议耦合 | 保留 schema/调用协议，索引和具体工具声明统一来自 Host |

## 3. 迁移阶段映射与兼容桥退出条件

| slice | 当前生产代码/现状 | 迁移顺序及桥退出条件 |
|---|---|---|
| Runtime Host/API | `plugin/host.ts` discovery 与 `plugin/runtime/host.ts` activation 是两层；HTTP toggle 使用 `PluginRuntimeService`，项目 `InstanceBootstrap` 现按 `plugin_state.enabled` 经 `PluginHost.inspect` 冷启动激活 v2 插件，并由真实 InstanceStore/HTTP 集成测试验证 | 已有 toggle 与启动闭环切片；仍须验证跨实例/全局 scope、初始化失败/关闭清理、single Host 对照及全阶段门槛后，才能称统一入口唯一 |
| Tool | `tool/registry.ts` 静态 imports + Runtime tools + ExtensionLoader/custom + 旧 Plugin hooks 同存；Runtime tools 当前读得到，但注册者仅在 toggle | D1、D7、D9 对照；移除 per-tool static/legacy duplicate，ToolRegistry 只消费 Host 有效快照 |
| Agent | `agent/agent.ts` 构建静态 agency/config/markdown agents；实际 agent consumer 与权限协议已在内核 | 先注册/resolve/override/停用和 prompt snapshot，再删静态领域注入；D2 |
| Skill | `skill/index.ts` 内置 prompt markdown + ExtensionLoader contribution | Skill contribution 唯一索引，保留 prompt composition/permission；D2、D7 |
| Command | `command/index.ts` filesystem/config/MCP/template 来源混合 | 先适配到 Host + command invoke lifecycle，再移除重复 command loader；D2 |
| Provider | `provider/provider.ts` 通过 legacy `Plugin` 注册/provider auth/config/service | 需先定义 ProviderAdapter consumer、auth/config/secret scope 与回滚；D3；消除 `Plugin` legacy registry 双路径 |
| Office | Office engine 位于 `packages/core/src/office/engine/*`，业务/编辑器在 `src/office/*` 与 App；有独立 office Platform | adapter 接统一 Host 后验证 read/write/export/preview，以及停用退化；D4 |
| Publish/UI | 生产插件目录里无完整统一 publish/UI consumers 的证据；App/console 有独立静态 UI | 分别实现 contribution consumer，slot 缺席可降级，restart-free route/UI 验收；D5/D6 |
| TUI/legacy | `plugin/tui/*` 生命周期和 `@novaway/plugin` TUI runtime 属不同执行上下文 | 保留显式 transport/API 兼容；禁止将 TUI 插件误认为 server plugin 已统一，D6 |
| 默认发行组合 | 尚无 install/enable/no-credential integrated golden path 证据 | 所有将进入 distribution 的 slices 通过独立安装、权限提示、卸载清理验收之后实施 |

## 3.1 旧 `Plugin.Service` 的生产消费者清点（2026-11-09 首轮）

基于 `git grep` 对 `packages/novaway/src` 的调用证据，旧服务并非只有启动 loader：它同时支撑 Agent/Provider/Tool/Session 请求和运行时事件。下表是迁移切片清单，不是删除承诺；每组须补行为基线及 Runtime Host 替代测试后才可断开旧 Hook。

| 消费者 | 当前用途/可见调用证据 | 迁移归属与退出证据 |
|---|---|---|
| `project/bootstrap.ts` | `Plugin.Service.init()` 仍强制触发旧插件初始化；另有启动时读取 persisted-enabled 并激活 v2 Runtime Host 的生产路径 | 冷启动 v2 activation 已有集成用例；仍需处理/证明 legacy Hook 并存、故障恢复与退出清理，之后才能迁除旧启动入口 |
| `agent/agent.ts`、`session/prompt.ts` | `experimental.chat.system.transform` 修改 Agent/系统提示；prompt 还调用多种旧 hook | 阶段 2 Agent/prompt contribution；提示快照、覆盖/停用和下一轮更新对照测试 |
| `hook/service.ts` | 将总线事件交给旧 `hook` handler | Runtime lifecycle/event contribution consumer 建立后比较事件次序、错误隔离和卸载订阅 |
| `provider/auth.ts`、`provider/provider.ts`、`cli/cmd/providers.ts` | 旧 hooks 注册 Provider/Auth/模型相关实现，CLI 和 `/provider` 读取其结果 | Provider slice（阶段 3）；模型发现、secret/auth、API 列表和流式请求回归后迁移 |
| `session/llm.ts`、`session/processor.ts`、`session/compaction.ts` | 旧 hook 参与请求参数/headers、消息变换、工具调用/压缩过程；已检索到 `experimental.session.compacting`、`experimental.chat.messages.transform` 等调用 | 按模型请求和 session 生命周期细分贡献契约；请求/消息顺序、失败和取消行为逐项对照 |
| `tool/registry.ts`、`tool/shell.ts`、`pty/index.ts` | `tool.definition` 修改工具定义；shell.env 给工具/PTY 注入环境 | 阶段 2 工具与 shell capability；工具目录、执行参数、env/权限以及无双重执行回归 |
| `tool/plugin-install.ts` | 安装后调用 `Plugin.reload()` 使旧 hook cache 重新加载 | 安装/卸载必须调用唯一 Runtime discovery/activation 生命周期；不再依赖旧 Hook cache |
| `session/compaction.ts` | 注入 compaction context/prompt，并变换 compact 后消息 | 保留已有产品行为，迁到有明确 hook ID/顺序/权限的 runtime interceptor；成功/失败补偿测试 |

以上 15 个生产文件命中 `Plugin.Service`，另有多个显式 `plugin.trigger(...)` 调用点。尚未完成 provider/auth Hook 字段级清单、legacy plugin 实际包清单、逐 hook 调用顺序测试和完整符号级依赖 DAG，因此阶段 0 仍未过门槛。Runtime Host 的 toggle 与 persisted-enabled 冷启动激活已接入，但 v2 Host 与旧 `Plugin.Service` 仍并行；后续先证明 Tool/Agent/Skill/Command consumers 的 Host 替代路径和单次执行，再迁 Provider/Auth 与通用事件/拦截器；在替代路径具备前不删除 `Plugin.Service`。

## 4. 当前基线欠账（跟踪项）

- B1 棘轮：最新扫描 51 kernel / 150 capability，15 条存量依赖边（28 次边命中豁免范围），0 新增。机器快照见 `plugin-first-boundary-2026-11-09.json`；不能以棘轮通过替代迁除 15 边。
- 旧边至少包括 `session/prompt.ts` → `memory/*`、`team/*` 多个服务，`session/session.ts` → `memory/service`、`storage/schema.ts` → `memory/memory.sql`。它们是 capability 依赖债，不应以扩大 kernel 白名单解决。
- 全仓 typecheck 最近已通过（17/17 packages）；novaway 全量测试串行尝试仍出现许多失败/超时，未取得全量成功；局部插件 Runtime Host、API、registry/storage/secrets 测试已通过。
- 根 lint 降并发仍因 Windows Go/TypeScript checker/oxlint `VirtualAlloc errno=1455` OOM失败。
- App production build 曾通过，但不等于真实 UI 验收；D1–D9、B2 全口径启动/激活性能仍未验收。
- 当前旧 `Plugin.Service` 的生产消费者初步清点见本图 §3.1；启动/自动激活、consumer 单路径和阶段 0 符号级 DAG仍为阻塞项。
