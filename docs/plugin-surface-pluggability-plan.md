# 插件化 Surface 实施计划（UI 可插拔）

> 状态：实施完成（2026-11-14；Surface 契约、第三方运行时放行、注册表、HTTP 输出、App 宿主、`onView` 按需激活与主要验收门禁均已通过）。HTTP API 三模式已在低并发分片门禁中完成：coverage/auth 各 435/435，effect 分片 217/217 + 218/218，0 missing、0 extra；分片脚本对单个瞬时超时允许一次全分片重试，最终命令 exit 0。正式发行门禁 G6 仍因缺少真实人工抽样记录而按规则保持失败，不属于本计划 SU-T1–SU-T20 的实现阻塞。本文保留所有证据与未验证范围，不把人工证据缺口伪记为通过。
> 设计依据：[`plugin-system-unification-design.md`](./plugin-system-unification-design.md) §9.2 Slot 目录、§9.3 预览器、§9.8 第三方 UI 边界、§8.2 `builtin.ui` 拆分。
> 前序计划：[`plugin-first-implementation-plan.md`](./plugin-first-implementation-plan.md)（已验收 2026-11-14）。
> 目标：让插件市场里的**第三方插件**能真正提供侧栏项、设置分区、文件预览、消息渲染、会话面板等 UI，并让宿主 UI 的注册/启停/可见性全部由贡献驱动；同时守住「第一方组件白名单 + 第三方 iframe + 声明式」的信任边界。

## 0. 一句话结论

Surface 的**元数据通路已经通了**（`/plugin/contributions` 能返回 slot/title/action/view/match/renderer/viewId），但**渲染通路只对内置插件开放**：第三方声明 surfaces 会在激活期被 `capability_denied` 拒绝（`src/plugin/runtime/activation.ts:156`），全页 view 仍是占位页（`packages/app/src/app.tsx:118-134`），设置分区的 `view` 两种写法只支持一种（`settings-runtime.tsx:3834`），预览器只认写死的 `novaway.office.file`（`file-tabs.tsx:426`），另有 6 个已声明的 slot 在 App 里没有任何宿主。本计划把这四条通路补齐，并按「先放开声明式、再加 iframe 数据桥」的顺序控制风险。

---

## 1. 范围

### 1.1 本轮交付

1. 第三方插件可声明并通过 `/plugin/contributions` 暴露以下 surface / previewer：
   - `sidebar.item`（`url` / 应用内 `view` / 同插件命令）
   - `settings.section`（声明式字段 / 应用内 `view`）
   - `message.part.renderer`（iframe）
   - `previewer`（iframe，按 extension/format/mime 匹配）
   - `session.panel`（`url` / 应用内 `view`，本轮提升为 stable）
2. App 侧通用渲染宿主：全页 view 路由、设置分区 view、文件预览 iframe、消息渲染 iframe、会话面板。
3. Surface 注册表升级为带来源、命名空间、排序、覆盖语义的 `ContributionRegistry`。
4. iframe v1 数据桥（只读上下文 + 受限 setConfig/setSize；不做 tool.invoke）。
5. 剩余 slot 的宿主接线：`sidebar.footer`、`statusbar.item`、`composer.action`、`home.card`、`notification.item`（`session.panel` 已在第 1 项）。
6. 第三方 `action.type === "command"` 只允许触发**本插件贡献的命令**（新增命令桥，见 D6）。
7. 顺带修复 `contributes.storage` 激活即拒（市场插件几乎都需要 KV）。
8. 市场条目的能力声明与安装确认页权限展示；作者文档与示例插件。
9. 对应门禁：单元、HTTP 契约、真实 Chromium e2e、全仓回归、性能复测。

### 1.2 明确不在本轮

- 不做 ESM 联邦、不做第三方 Solid 组件直载（理由见设计 §9.8：双实例破坏响应式）。
- 不开放第三方 `renderer.type === "builtin"`、`viewId` 内置组件白名册、宿主 DOM/token。
- 不做 `tool.invoke` / `llm` / `session` 等 iframe → 宿主的写操作；只做 v1 只读 + 配置/尺寸。
- 不实现 TUI 侧的新 slot 渲染（TUI 继续「只渲染支持的槽，其余忽略并记 info」）。
- 不做 surface 标题/描述的 i18n（当前 `title` 是字面量；后续可加 `titleKey`，本轮不改契约）。
- 不实现 `httpRoutes` / `mcpServers` / `outputStyles` / `lspServers` 的消费（它们的计划另立）。
- 不做插件密钥专用存储：`settings.section` 的 `secret` 字段按用户决定**允许明文**写入 `plugins.config`（见 D11），本轮不新增 secrets 路由。
- 不重启任何既有进程，不 `git commit`（沿用前序计划 §1.3）。

### 1.3 操作约束（沿用前序计划，逐条有效）

- 涉及 UI 或本地开发服务的测试若需要重启既有进程，立即停止该项，记录精确阻塞和未验证范围，等待用户授权；不得自行重启。
- 所有 e2e 使用本轮自行启动的隔离端口（建议 backend `4220`、Vite `3240`），结束后必须停掉并复核端口释放；不得占用/结束不明来源的监听进程。
- 开始每个任务前先看工作区状态与目标文件现状；保留所有与本任务无关的用户改动，不清理、不回滚。
- 任何「协议通过」都不能替代「真实 Chromium 中第三方插件渲染成功」的行为证据。

---

## 2. 现状审计（代码证据）

### 2.1 已接通的部分

| 能力                                       | 证据                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| surface 元数据进入 `/plugin/contributions` | `src/server/routes/instance/httpapi/handlers/plugin.ts:276-300`（slot/title/description/icon/action/view/match/renderer/viewId/priority/readOnly） |
| 内置 sidebar 项 → rail 可点                | `packages/app/src/pages/layout.tsx:3554-3590`                                                                                                      |
| 内置 surface 全页路由（占位）              | `packages/app/src/app.tsx:88-134`、路由注册 `app.tsx:465`                                                                                          |
| 内置 settings 声明式分区                   | `packages/app/src/components/settings-runtime.tsx:3829-3885`                                                                                       |
| 内置消息渲染器 + 第三方 iframe 安全属性    | `packages/app/src/pages/session/message-timeline.tsx:189-231`（`sandbox="allow-scripts"`、`referrerPolicy="no-referrer"`、仅 http/https）          |
| previewer 注册表与匹配                     | `src/plugin/runtime/activation.ts:219-265`、`packages/app/src/pages/session/office-preview-utils.ts:121-160`                                       |
| 开关/SSE 热更新（D9）                      | `src/plugin/event.ts`、`packages/app/src/context/global-sync/event-reducer.ts`                                                                     |

实测（本轮审计）：

- 第三方（project scope）声明 `surfaces` → 激活抛 `capability_denied`，原文「Office 引擎、Publish driver 和 Surface 贡献当前只对内置插件开放」（`activation.ts:156`）。
- 第三方声明 `ctx.surfaces.register` → 抛 `capability_denied`（`runtime/context.ts:210`，`BUILTIN_ONLY`）。
- 第三方 `previewers` 可以通过激活，但 App 只在 `viewId === "novaway.office.file"` 时特殊渲染（`file-tabs.tsx:426`）。
- 声明 `contributes.storage` 的插件同样激活失败（`activation.ts:42-57` 的允许清单漏了 `storage`）；与本计划相邻但独立，见 §7 待决问题。

### 2.2 已声明但 App 无宿主

`SurfaceContribution.slot` 的联合类型共 10 个（`packages/plugin-api/src/contributions.ts:205-241`），App 实际消费 3 个：

| slot                    | 宿主                        | 状态           |
| ----------------------- | --------------------------- | -------------- |
| `sidebar.item`          | `layout.tsx:3557`           | 有             |
| `settings.section`      | `settings-runtime.tsx:3831` | 仅 declarative |
| `message.part.renderer` | `message-timeline.tsx:220`  | 有             |
| `sidebar.footer`        | —                           | 无             |
| `session.panel`         | —                           | 无             |
| `statusbar.item`        | —                           | 无             |
| `home.card`             | —                           | 无             |
| `notification.item`     | —                           | 无             |
| `composer.action`       | —                           | 无             |

### 2.3 确定缺陷清单（按修复顺序）

| 编号 | 缺陷                                                                       | 证据                                                                                      | 影响                                                                                                         |
| ---- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| F1   | 第三方 `surfaces` 激活即拒，且会导致同一插件声明的 tools/agents 一并不可用 | `activation.ts:150-160`                                                                   | 市场 UI 插件完全不可用                                                                                       |
| F2   | surface 注册表按裸 `id` 存、无来源、无命名空间、无排序/覆盖                | `src/plugin/contributions/index.ts:122-150`                                               | 两个插件同名 surface 互相覆盖；归属靠 `ownerFor` 反查 manifest（`handlers/plugin.ts:220-244`），同名会归属错 |
| F3   | catalog 条目丢失 `action`/`view`/`renderer`/`description`/`icon`/`order`   | `src/plugin/catalog.ts:160-185`、`handlers/plugin.ts:314-321`                             | 未激活状态下的诊断与市场预览信息不完整                                                                       |
| F4   | 全页 view 只渲染「插件视图：{viewId}」占位                                 | `app.tsx:118-134`                                                                         | 第三方 view 无法承载内容                                                                                     |
| F5   | `settings.section.view` 的 `{type:"view"}` 被静默忽略                      | `settings-runtime.tsx:3834`                                                               | 声明了也不显示，且没有任何诊断                                                                               |
| F6   | previewer 只为 `novaway.office.file` 渲染，其他 `viewId` 虽被选中但无内容  | `file-tabs.tsx:426,693`                                                                   | 第三方预览器「装上了没反应」                                                                                 |
| F7   | 6 个 slot 可声明但无宿主，manifest 解析不校验 slot 合法性                  | `manifest.ts:454-468`                                                                     | 作者无法从诊断得知「这个槽目前没人渲染」                                                                     |
| F8   | `order` 字段服务端与 App 都没读                                            | `contributions.ts:212,220,239`；全仓无 `.order` 消费者                                    | 排序不可控                                                                                                   |
| F9   | iframe 无数据通道；`action.type === "command"` 可触发任意宿主命令          | `message-timeline.tsx:205-214`；`layout.tsx:3571-3576`；`app/src/context/command.tsx:413` | 第三方 iframe 只能显示静态页；命令 action 是未收敛的越权面                                                   |
| F10  | `activationEvents: ["onView:…"]` 被解析但从不派发                          | `plugin-api/src/manifest.ts:29`、`novaway/src/plugin/manifest.ts:64`                      | 纯 UI 插件只能常驻激活                                                                                       |
| F11  | 设置里的 `secret` 字段写入 `plugins.config`（明文）                        | `settings-runtime.tsx:3871-3885`、`3957`                                                  | **用户已决定接受**（2026-11-14）：本轮保留明文，但必须加提示与文档（D11）                                    |

---

## 3. 设计决策

### D1 信任模型（先声明式，再 iframe，永不 ESM）

沿用设计 §9.8 的三级：

| 级别     | 形式                       | 第三方 | 内置           |
| -------- | -------------------------- | ------ | -------------- |
| 声明式   | JSON 字段 + 宿主内置渲染器 | 允许   | 允许           |
| iframe   | 沙箱页面 + postMessage     | 允许   | 允许（可不用） |
| 内置组件 | `viewId` → App 白名单组件  | 禁止   | 允许           |

进程内插件代码（tools/agents 的 entry）不是安全沙箱，这一点沿用前序计划 §1.2 的表述，不因 UI 开放而改变。iframe 是唯一的第三方 UI 隔离手段。

### D2 view 用内联 `render` 表达，不新增 `views` 贡献点

- surface/previewer 的声明内直接带 `render`：`{ type: "iframe"; url: string }`（任意 scope）或 `{ type: "builtin"; component: string }`（仅 builtin）。
- 不引入 `contributes.views` 第 23 个键：`plugin-api/src/registry.ts:5-88` 对 contribution kind 与 contributes key 做穷举一致性断言，新增一类会牵动 manifest、catalog、SDK、OpenAPI 与三类分类表，而它的唯一消费者是 App 的路由查找——用内联 `render` 已经能满足，且天然带命名空间。
- 现有 `ViewContribution`（`plugin-api/src/contributions.ts:244-248`）在全仓无引用，本轮删除或降级为内部 `BinaryRender` 类型，不留第二套叙事。

### D3 全页 view 路由以 `pluginID + localName` 定位

- 路由改为 `/:dir/plugin-view/:pluginID/:localName`（`localName` 是贡献在注册表里的本地名，天然唯一于插件）。
- App 通过 `pluginID + localName` 找到该 surface，再按 `render` 渲染：builtin → 宿主组件；iframe → 通用容器。
- 不再用 `viewId` 作为路由键：`viewId` 是内置组件名，第三方没有它也可能有两个 surface 指向同一个内置组件。`viewId` 继续保留给 builtin 声明与旧清单兼容。

### D4 surface 注册表按 `ContributionRegistry` 语义

- `createSurfaceRegistry()` 改为返回 `ContributionRegistry<SurfaceContribution>`（policy `accumulate`，与设计 §4.8 的「累加」一致）。
- 第三方一律 `plugin_local` 命名；内置声明 `global: true` 才保留原名（与 tools 同一套规则，`registry.ts:136-152`）。
- 去重与排序使用统一 `orderContributions`：`priority` 降 → `installOrder` 升 → 最终名码位序。
- surface 自身的 `order` 只用于**同一 slot 内的展示顺序**，在服务端输出前稳定排序（先 `order` 升，再 `orderContributions` 的次级键）。两者语义分开写进文档，避免作者以为 `order` 能跨插件抢位。
- 多插件命中同一 `message.part.renderer` 时按注册表顺序先到先得（`message-timeline.tsx:220` 的 `find` 语义不变），但必须产生一条 `collision` 诊断，避免「装了没反应」不可解释。

### D5 Slot 契约等级

| slot                                                                    | 等级    | 第三方允许的写法                                                              |
| ----------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `sidebar.item`                                                          | stable  | `action: {type:"url"}` 或 `action: {type:"view", render:{type:"iframe",url}}` |
| `settings.section`                                                      | stable  | `view: {type:"declarative", fields}` 或 `view:{type:"iframe", url}`           |
| `message.part.renderer`                                                 | stable  | `renderer: {type:"iframe", url}`                                              |
| `previewer`                                                             | stable  | `render: {type:"iframe", url}` + `match`                                      |
| `session.panel`                                                         | stable  | `url` / 带 `render` 的 view                                                   |
| `composer.action`                                                       | preview | `url` / 带 `render` 的 view / 同插件命令（D6）                                |
| `statusbar.item` / `home.card` / `notification.item` / `sidebar.footer` | preview | `url` / 带 `render` 的 view                                                   |

规则：第三方声明 `preview` 级 slot 允许注册，但 `/plugin/diagnostics` 必须给出 `slot_preview` 提示；市场商品页不得把 preview 级 slot 标为「已支持」，直到对应宿主切片验收。

### D6 第三方 `command` action 只指向本插件命令

- 现状风险：`command.trigger(id)` 能触发任意宿主 UI 命令（`app/src/context/command.tsx:413`）。直接开放等于把 App 完整命令面交给第三方。
- 本轮规则：
  - 第三方 `action.type === "command"` 只允许引用**同一插件 `contributes.commands` 里声明的命令名**。
  - 校验分两段：解析期拒宿主保留前缀（`settings.` / `session.` / `plugin.` 等）；`/plugin/contributions` 输出阶段按 pluginID 聚合，引用不存在的同插件命令 → `action_command_unresolved`，引用别的插件或宿主命令 → `action_scope_denied`。
  - 点击语义不是 `command.trigger(hostCommand)`，而是「把 `/命令名` 填入输入框并聚焦」——与现有斜杠命令入口一致（`app/src/components/prompt-input.tsx:1285-1314` 的 `custom.<name>` 流程），不经过宿主命令表。
  - 内置插件保留 `command.trigger` 能力（现有 `novaway-ui` 未使用）。
- 实现载体：新增 `packages/app/src/plugin/plugin-command-action.ts`，把「解析、校验、执行」收在一处，`layout.tsx` / `prompt-input.tsx` 只调用它，避免两处各写一版。
- 未来若要放开宿主命令白名单，需要单独的 RFC 与 capability（本轮不做）。

### D7 iframe v1 数据桥

协议：`{ v: 1, type: string, payload?: unknown }`，消息必须来自该 iframe 的 `contentWindow`，且 `event.origin` 必须等于声明 URL 的 origin。

宿主 → iframe：

- `context`：`{ pluginID, viewId, theme, locale, readOnly }`
- `part`（仅 message renderer）：`{ tool?, partType, state, output }`，`output` 截断到 64KB，二进制/附件只给元数据。
- `config`：`{ [key]: value }`，仅该插件 `plugins.config[pluginID]`。

iframe → 宿主：

- `ready`、`resize`（高度）、`setConfig`（仅本插件命名空间，且字段必须是该插件 settings 声明过的 key）。
- v1 明确**不提供** `tool.invoke` / `llm` / `session` / `storage`。理由：这些需要会话与权限上下文，属于下一轮。

权限：`capabilities.ui: ["part.read"]` 才能收到 `part`；未声明则只收 `context`。`capabilities.ui` 字段已存在（`plugin-api/src/manifest.ts:44`）但无消费者，本轮补上校验与文档。

### D8 归属由注册表给出，不再反查 manifest

- `runtimeContributions` 直接从 `ContributionRegistry` 的 `Entry` 取 `pluginID/scope/origin/adapter`，删除 `ownerFor()` 的 manifest 扫描（`handlers/plugin.ts:220-237`）。
- 这样可以消除「同名 surface 归属错插件」的隐患，也让 `overrides` 生效后的归属正确。

### D9 兼容策略

- 已存在的内置 `novaway-ui` 清单不需要改：`sidebar.item.action.view`（viewId）、`settings.section.view.declarative`、`message.part.renderer.renderer.builtin` 全部保留。
- 第三方旧写法（`previewers[].viewId` 但不带 render）在新规则下报 `contribution_incomplete`，并提示改用 `render`；由于此前第三方 surfaces 被整体拒绝，不存在需要兼容的历史第三方清单。
- SDK 与 App 的 `node_modules/@novaway/sdk` 必须同步（历史上出现过「生成物更新、装进 app 的副本没更新」导致的 typecheck 假失败）。

### D10 诊断优先于静默

任何「声明了但本轮不会渲染」的情况都必须在 `/plugin/diagnostics` 出现一条 `warning` 或 `error`，不允许静默：
`slot_unknown`、`slot_preview`、`render_scope_denied`、`render_origin_invalid`、`action_scope_denied`、`action_command_unresolved`、`view_unresolved`。

### D11 `secret` 字段按明文保存（用户决定）

- 决定：`settings.section` 的 `secret` 字段继续写入 `plugins.config[pluginID]`（明文），本轮不新增 secrets 路由。
- 必须做的补偿：
  - UI 在该字段旁标注「以明文保存在配置文件」，且 `type === "secret"` 的输入仍是密码框（不回显已有值）。
  - `docs/plugin-authoring.md` 明确写出这一点，禁止把它描述为安全存储。
  - 安装确认页（SU-T16）对声明 `secret` 字段的插件显示同一提示。
- 若后续要做安全存储，复用 `runtime/secrets.ts` 的 `createSecretStore`，作为独立任务，不在本计划内。

---

## 4. 任务清单

依赖顺序：SU-M0 → SU-M1 → SU-M2 → SU-M3 → 门禁。M1 内部 T2→T3→T4→T4b→T5→T6 严格串行；T7/T8 可并行。M2 内部 T9 是 T10/T11/T13 的公共依赖；T14 依赖 T7 与 M1 的 commands 输出。

| milestone | 任务       | 估算        | 可独立验收的产物                                                        |
| --------- | ---------- | ----------- | ----------------------------------------------------------------------- |
| SU-M0     | T1         | 0.5 天      | 基线 JSON，可复现                                                       |
| SU-M1     | T2–T8、T4b | 2–3 天      | 第三方声明式 surface 出现在 `/plugin/contributions`，rail/settings 可见 |
| SU-M2     | T9–T14     | 3–4 天      | iframe view / previewer / renderer 数据 / session.panel / 命令桥        |
| SU-M3     | T15–T17    | 3–4 天      | 剩余 slot、市场权限展示、作者文档 + fixture                             |
| SU-M4     | T18–T20    | 2 天        | 真实 Chromium 9 步黄金路径 + 全量回归 + 结项                            |
| 合计      | 21 个任务  | 约 11–14 天 | —                                                                       |

### SU-M0 基线（0.5 天）

#### SU-T1 建立 UI 贡献行为基线

- 目标：在改动前用可复现的方式记录当前行为，后续每个切片都能对比。
- 改动：
  - 新增 `packages/novaway/script/plugin-surface-baseline.ts`：隔离临时目录 → 启动 production `Server.listen`（随机端口）→ GET `/plugin/contributions` → 输出稳定排序的 JSON（去掉时间戳/路径）。
  - 基线快照存为 `docs/plugin-surface-baseline-2026-11-14.json`。
  - 覆盖三类输入：无插件、内置 `novaway-ui`、project-scope 插件（只声明 tools）。
- 验收：脚本两次运行输出逐字节一致；project-scope 插件声明 surfaces 时，记录到 `capability_denied` 的原文与 HTTP 状态。
- 回滚：纯新增文件，删除即可。

### SU-M1 第三方声明式准入与注册表（2–3 天）

#### SU-T2 契约扩展：`render` / `action` / previewer

- 目标：让第三方 UI 有合法的表达方式，同时不新增 contribution kind。
- 改动文件：
  - `packages/plugin-api/src/contributions.ts`
    - `SurfaceAction` 增加 `{ type: "view"; render: BinaryRender }`（`BinaryRender = {type:"iframe";url:string} | {type:"builtin";component:string}`）。
    - `settings.section.view` 增加 `{ type: "iframe"; url: string }`。
    - `PreviewContribution` 增加 `render?: BinaryRender`，`viewId` 改为可选（内置仍用）。
    - action 型 slot 统一可选 `order?: number`。
    - 删除无引用的 `ViewContribution`，或改名为内部 `BinaryRender`。
  - `packages/plugin-api/test/type-surface.ts`：补类型用例（该包只有 `tsgo --noEmit`，没有运行时测试跑器；类型用例靠 typecheck 生效）。
- 验收：root `bun run typecheck`（17 tasks）通过；`packages/plugin-api` 的 typecheck 通过。
- 回滚：契约回退到当前 union，T3 起尚未落地。

#### SU-T3 manifest 解析与校验

- 目标：非法/越权的 surface 声明在解析期就有明确诊断，不进入注册表。
- 改动文件：`packages/novaway/src/plugin/manifest.ts`
  - 现状 `surfaces`/`previewers` 走 `assignList` 裸赋值（`manifest.ts:454-468`），没有任何字段校验；新增 `surfaceDeclaration()` / `previewerDeclaration()` 映射（对齐 `toolDeclaration()` 的写法），逐项产出诊断。
  - slot allowlist（10 个已知值）→ 未知 slot 报 `contribution_invalid`（F7）。
  - `render.type === "builtin"` 且 `scope !== "builtin"` → `render_scope_denied`；判断 scope 需要把 scope 传进解析或在激活期再做一次（解析期 `Instance` 已有 scope，放在 `directoryInstance` 后校验）。
  - `action.type === "command"`：解析期只做「格式 + 宿主保留命令前缀」校验（`settings.`、`session.` 等宿主命名空间一律拒），真正的「同插件归属」校验在 SU-T14 的 contributions 输出阶段完成（解析期拿不到别的插件的命令表）。
  - 拒绝原因写入诊断码 `action_scope_denied` / `action_command_unresolved`（D10）。
  - `order` 必须是有限数字；`title`/`icon` 必填字段校验。
  - `render.url` 必须能解析且协议为 http/https（`javascript:`/`data:` 报错）。
  - previewer：`viewId` 与 `render` 至少有一个；第三方无 `render` → `view_unresolved`。
  - `capabilities.ui` 只接受文档化取值（`part.read`），未知值 `capability_unknown` 警告。
- 验收：`bun test test/plugin/manifest.test.ts` 新增用例全绿（每个诊断码至少一条）。
- 回滚：解析器回退不影响运行时。

#### SU-T4 激活允许清单与第三方分支

- 目标：第三方 surfaces 可激活；内置分支保持原样。
- 改动文件：`packages/novaway/src/plugin/runtime/activation.ts`
  - `unsupported` 清单加入 `surfaces`（`previewers` 已在允许清单内，确认无需改）。
  - 删除第三方分支的 `capability_denied`（现有 line 156 的整段条件），改为逐个校验后注册。
  - 注册时把 `SurfaceContribution` 与来源一起登记（依赖 T5 的签名）。
  - 第三方 `ctx.surfaces` 继续 `locked`（只能声明，不能代码注册）——这一点不变。
- 验收：
  - 新单测：project-scope 插件声明 `sidebar.item` + `settings.section` 激活成功，注册表出现两条且带正确 `pluginID/scope`。
  - 回归：现有 builtin 路径测试全绿。
- 回滚：恢复拒绝分支即可；注册表改动可独立回退。

#### SU-T4b 允许清单补 `storage`（用户已确认并入）

- 目标：第三方插件声明 `contributes.storage` 不再激活即拒（§2.1 实测缺陷）。
- 改动文件：
  - `packages/novaway/src/plugin/runtime/activation.ts`：`unsupported` 清单加入 `storage`。
  - 校验 `manifest.contributes.storage.namespace` 与 `PluginStorage.openKv` 的 `declared` 参数链路（`runtime/context.ts:355-360`、`src/plugin/storage.ts:235-250`）。
- 验收：
  - 新单测：声明 `storage: {namespace, migrations}` 的 project-scope 插件激活成功；`ctx.storage.set/get` 落在该 namespace。
  - 负向单测：activate 后仍不能写别的 namespace（`storage_conflict`）。
- 回滚：从清单里移除 `storage` 即可（但 regression 测试要同步移除）。

#### SU-T5 surface 注册表升级

- 目标：命名空间、排序、覆盖、归属一次到位。
- 改动文件：
  - `packages/novaway/src/plugin/contributions/index.ts`：`createSurfaceRegistry()` → `createRegistry<SurfaceContribution>({ kind: "surface", policy: "accumulate" })`。
  - `packages/novaway/src/plugin/runtime/context.ts`：`Registries.surfaces` 与 `LaterRegistries.surfaces` 类型改为 `ContributionRegistry<SurfaceContribution>`。
  - `packages/novaway/src/plugin/runtime/host.ts`：`surfaces` 走 `bind()`（与 tools/previewers 同路径），确保 release 与 signal 检查一致。
  - `packages/novaway/src/plugin/runtime/service.ts`：构造不变。
  - `packages/novaway/src/plugin/runtime/activation.ts`：builtin/第三方两处 `register(surface)` 改为 `register(source, surface)`。
- 验收：
  - 单测：两个插件同名 `sidebar.item id="home"` → 最终名分别为 `a_home`、`b_home`，无覆盖。
  - 单测：`priority` / `installOrder` / `order` 排序稳定；`overrides` 生效后原贡献恢复。
  - 现有 `test/plugin/*` 全绿。
- 回滚：注册表实现与调用点一起回退。

#### SU-T6 `/plugin/contributions` 输出与归属

- 目标：App 能拿到渲染所需的全部字段，且归属正确。
- 改动文件：
  - `packages/novaway/src/server/routes/instance/httpapi/handlers/plugin.ts`
    - `runtimeContributions` 的 surfaces/previewers 直接使用注册表 `Entry` 的 `pluginID/scope`，删除 `ownerFor()` 与 `runtimeMeta()` 的 manifest 扫描（D8）。
    - 输出新增 `order`、`render`、`view`（iframe 形式）、`ui`（由 `capabilities.ui` 派生）。
    - catalog 分流保留：builtin 的 surface/office/publish 仍以运行时为准，避免重复。
  - `packages/novaway/src/plugin/catalog.ts`：`declarations()` 与 `list()` 补 `description/icon/action/view/render/order`（F3），用于未激活条目的诊断展示。
  - `packages/novaway/src/server/routes/instance/httpapi/groups/plugin.ts`：`PluginContribution` 增加 `order`、`render`、`ui`；`render` 用既有 `renderer` union 的扩展版本（`builtin.component` / `iframe.url`）。
- 验收：
  - `bun test test/server/httpapi-plugin.test.ts`：新增断言「第三方 surface 的 pluginID 正确、render/order 原样返回」。
  - `bun run test:httpapi` 三模式通过（新增字段不得破坏 schema 覆盖）。
  - SDK 重新生成：`packages/sdk/js/src/v2/gen/types.gen.ts` 含新字段；同步 `packages/app/node_modules/@novaway/sdk`（D9 提醒）。
- 回滚：字段是新增，可单独回退；SDK 生成物随之回退。

#### SU-T7 App sidebar 第三方渲染

- 目标：第三方 surface 真正出现在 rail，并能打开应用内 view。
- 改动文件：
  - `packages/app/src/pages/layout.tsx`
    - 解析新 `action` union；`view` 带 `render` 时路由到新路径（D3）。
    - `command` action 交给 `plugin-command-action`（SU-T14）解析与本插件命令校验；第三方引用宿主命令仍拒绝。
    - 按 `order` 稳定排序。
    - icon 走 `isIconName` 回退（已有）。
  - `packages/app/src/app.tsx`：路由改为 `plugin-view/:pluginID/:localName`；`PluginSurfaceViewRoute` 通过 `pluginID + localName` 查找并渲染（T9 的通用宿主）。
- 验收：
  - 单元：surface 解析函数新增用例（三种 action、非法 URL、order 排序）。
  - e2e（SU-T18）：第三方插件 sidebar 项出现、点击进入 iframe 容器、disable 后消失。
- 回滚：App 变更独立；服务端仍兼容旧 viewId 路由。

#### SU-T8 settings.section 第三方与 iframe

- 目标：第三方设置分区可显示、可保存；消除静默忽略（F5）。
- 改动文件：
  - `packages/app/src/components/settings-runtime.tsx`
    - `parsePluginSettingsSections` 支持 `view.type === "iframe"`，交给通用宿主。
    - `view.type === "view"`（builtin viewId）→ 内置组件白名单；不存在则显示「视图不可用」并保留诊断。
    - `secret` 字段按 D11 允许明文保存；字段旁固定显示「以明文保存在配置文件」，输入仍是密码框。
  - `packages/novaway/src/server/routes/instance/httpapi/handlers/plugin.ts`：settings section 的 `pluginID` 来自注册表条目（已由 T6 保证）。
- 验收：单元测试覆盖 declarative/iframe/unresolved 三种；config 写回仍走 `plugins.config[pluginID]`；secret 字段旁提示存在。
- 回滚：仅 App 渲染分支。

### SU-M2 通用 view 宿主、数据桥与命令桥（3–4 天）

#### SU-T9 通用 `PluginViewHost` 组件

- 目标：一处实现 iframe 安全属性、加载态、错误态、主题同步、高度自适应。
- 改动文件：新增 `packages/app/src/components/plugin-view-host.tsx`
  - 协议校验（仅 http/https）、`sandbox="allow-scripts"`（settings 场景是否追加 `allow-forms` 在实现时决定）、`referrerPolicy="no-referrer"`、不授予敏感 `allow` 能力。
  - 超时（默认 10s）与错误占位；`data-slot="plugin-view-iframe"`、`data-plugin-id`、`data-view-id` 供 e2e 断言。
  - 与 `message-timeline.tsx` 的 `iframeRenderer` 合并为同一实现，避免两套安全属性漂移（现状只在 renderer 一处有校验）。
- 验收：单元测试覆盖非法协议、超时、正常渲染；现有 renderer 测试仍绿。
- 回滚：新组件独立。

#### SU-T10 previewer 通用化

- 目标：第三方预览器真正渲染（F6）。
- 改动文件：
  - `packages/app/src/pages/session/file-tabs.tsx`：`PluginFilePreviewerHost` 按 `render` 渲染 iframe，保留 `novaway.office.file` 的内置分支；`readOnly` 语义不变。
  - `packages/app/src/pages/session/office-preview-utils.ts`：`pluginFilePreviewer` 返回 `render`，并按 `priority` → `order` 稳定选择。
- 验收：单元测试（匹配优先级、readOnly、render 透传）；e2e 见 SU-T18。
- 回滚：保留旧 office 分支即可。

#### SU-T11 message renderer 数据桥

- 目标：iframe 能拿到 part 数据（D7）。
- 改动文件：
  - `packages/app/src/components/plugin-view-host.tsx`：实现 `postMessage` 握手与 origin 校验。
  - `packages/app/src/pages/session/message-timeline.tsx`：renderer iframe 注入 `part` 消息；`output` 截断 64KB；仅在 `capabilities.ui` 含 `part.read` 时下发。
  - `packages/novaway/src/server/routes/instance/httpapi/handlers/plugin.ts`：contributions 输出 `ui` 能力（T6 已加）。
- 验收：单元测试用 `MessageEvent` 模拟：正确 origin 收到 `context`/`part`；错误 origin 被忽略；未声明 `part.read` 时不含 `part`。
- 回滚：桥是新增；不声明能力的插件行为不变。

#### SU-T12 `onView` 懒激活

- 目标：纯 UI 插件不必常驻激活（F10）。
- 实现：
  - `packages/novaway/src/plugin/runtime/tag.ts` 与 `service.ts` 增加 `activateOnDemand(instance)`；复用受锁保护的 `transition(instance, true, false)`，因此只改变当前 Host，不写入 `PluginStorage.enabled`。
  - `/plugin/contributions` 请求在发现 `activationEvents: ["onView:<viewId>"]` 且 Surface 声明对应 view action 时派发按需激活；失败被隔离，不阻断贡献查询。
  - Surface runtime 条目激活后按 `pluginID/scope/localName` 去重 catalog 的 installed 声明，避免 UI 重复显示。
  - bootstrap 仍不把只声明 `onView` 的第三方插件当作 startup-enabled 插件；其 discovery 状态保持 `installed`，首次贡献查询时进入 runtime `active`。
- 验收：HTTP 单测覆盖「installed → active」与「不改变 enabled 持久状态」；隔离 Chromium e2e 不再预先 PATCH enable，直接打开 view 后验证 sidebar/iframe、`status=installed` + `runtimeStatus=active`、session.panel、同插件命令桥及 disable。
- 回滚：移除 `activateOnDemand` 和 contributions 请求中的 onView dispatch，恢复仅持久 enabled/builtin 激活。

#### SU-T13 `session.panel` 宿主（用户要求提前到 M2）

- 目标：插件可以在会话侧栏加标签页，承载 iframe view 或内置 view。
- 改动文件：
  - `packages/app/src/pages/session/session-side-panel.tsx`：读取当前 directory 的 active `surface/session.panel`，加入标签列表；`order` 排序；标签标题取 `title`。
  - 面板内容走 `PluginViewHost`（SU-T9）；内置 view 走白名单组件。
- 验收：
  - 单元：标签列表由贡献驱动（0 / 1 / 多插件），`order` 生效，disable 后标签移除。
  - e2e（SU-T18）：第三方 `session.panel` 标签可打开、内容可见、停用后消失。
- 回滚：面板 host 分支独立。

#### SU-T14 命令桥：第三方 `command` action（D6）

- 目标：第三方 sidebar/composer action 能触发**本插件自己贡献的命令**，但不能碰宿主命令表。
- 改动文件：
  - 新增 `packages/app/src/plugin/plugin-command-action.ts`：
    - `resolve(action, contributions, commands)`：校验 `action.command` 属于同 `pluginID` 的 `command` 贡献；否则返回 `undefined` 并记录一次诊断。
    - `invoke(target)`：把 `/命令名` 写入输入框并聚焦（复用 `prompt-input.tsx` 的 `custom.<name>` 流程语义），不调用 `command.trigger(hostID)`。
  - `packages/app/src/pages/layout.tsx`、`packages/app/src/components/prompt-input.tsx`：改调用新模块。
  - `packages/novaway/src/plugin/manifest.ts`：解析期校验引用（`packages/novaway` 侧无法解析 App 命令表，改为「只校验名字不是宿主保留命令前缀」；真正的同插件归属校验放在服务端 contributions 输出阶段，按 pluginID 聚合）。
  - `handlers/plugin.ts`：为每条 `command` action 附带 `commandOwner: pluginID`，App 据此判定归属。
- 验收：
  - 单元：同插件命令可触发（输入框出现 `/name`）；跨插件命令被拒；宿主命令 id（如 `settings.open`）被拒。
  - 服务端：`action.command` 不属于该插件时输出 `action_scope_denied` 诊断。
- 回滚：`layout.tsx` / `prompt-input.tsx` 回退到旧分支（旧分支只对 builtin 生效）。

### SU-M3 剩余 slot 与市场（3–4 天）

#### SU-T15 剩余 slot 宿主接线

- 目标：把 5 个 preview 级 slot 接上真实宿主（`session.panel` 已在 SU-T13 完成），或明确降级。
- 前置（T15a）：逐槽确认宿主位置（现状只有设计文档的意向，没有代码锚点）：
  - `sidebar.footer` → `layout.tsx` rail 底部
  - `composer.action` → `prompt-input.tsx` 工具条（命令走 SU-T14 桥）
  - `statusbar.item` → 需要先找到 App 状态栏容器；若不存在，本任务先报告不实现
  - `home.card` → 需要先确认是否存在首页容器
  - `notification.item` → 需要先确认通知中心
- 实现：每个 slot 一个独立提交点；允许只交付能定位到宿主的槽，其余保留 `slot_preview` 诊断并在市场标注「未支持」。
- 验收：每个已接线槽一条 e2e 断言；未接线的槽在诊断里可见。
- 回滚：按槽回退。

#### SU-T16 市场能力声明与安装确认

- 目标：安装前让用户看到「这个插件会渲染 iframe / 读取工具输出 / 写入设置」。
- 改动：
  - `packages/app/src/components/settings-market-catalog.tsx`、`settings-installed-extensions.tsx`：安装确认与详情页展示 surfaces 列表、slot 等级、iframe origin、`capabilities.ui`、以及 D11 的明文 secret 提示。
  - `packages/novaway/src/server/routes/instance/httpapi/handlers/plugin.ts`：按插件聚合 UI 能力视图（或复用 `/plugin/contributions`）。
  - `packages/app/src/constants/novaway-marketplace.ts`：追加可选展示字段，仅用于 UI，不作为信任依据。
- 验收：单元测试渲染权限列表；e2e 安装确认页可见。
- 回滚：纯展示。

#### SU-T17 作者文档与示例插件

- 目标：市场作者能照着写。
- 改动：
  - `docs/plugin-authoring.md` 增加 Surface 章节（当前整篇无 surface 内容）：
    - stable 写法的完整 manifest 片段（sidebar / settings / renderer / previewer / session.panel）
    - 第三方 `command` action 的同插件限制
    - iframe 数据桥协议、origin 校验、64KB 截断规则
    - 不支持写法清单（builtin render、宿主命令 action、无 render 的 viewId）
    - `secret` 字段明文存储的明确说明（D11）
    - 诊断码表
  - 新增 `packages/novaway/test/fixture/plugin-surface-third-party/`：声明 sidebar + settings + previewer + renderer + session.panel + 同插件 command action + storage 的最小插件，带 iframe 页面。
  - 本文文末证据日志。
- 验收：fixture 能被 Host 发现并激活；文档示例与 fixture 逐字段一致。
- 回滚：纯文档/测试夹具。

### SU-M4 验收（2 天）

#### SU-T18 真实 Chromium 黄金路径

- 目标：第三方插件在真实 production backend + Vite + Chromium 中端到端可见、可用、可停用。
- 路径：
  1. 隔离临时项目 → 放置 `plugin-surface-third-party` → 启用。
  2. rail 出现第三方项 → 点击进入 iframe view（断言 `data-slot="plugin-view-iframe"` 与 origin）。
  3. 同一 rail 项（或另一条）的 `command` action → 输入框出现该插件的 `/命令`，且宿主命令 `settings.open` 不可被引用。
  4. Settings → Plugins 出现第三方声明式分区 → 改字段 → 重启 backend 后值保留在 `plugins.config`；`secret` 字段旁有明文提示。
  5. 打开声明的文件扩展名 → 第三方 previewer iframe 渲染。
  6. 触发工具调用 → message renderer iframe 收到 `part`（断言 iframe 内文本）。
  7. 会话面板出现第三方 `session.panel` 标签并可打开。
  8. 仅声明 `onView` 的插件在启用后保持 `installed`（启动不加载它的 entry）；打开其 view 后变为 `active`；重启 backend 后回到 `installed`，持久 `enabled` 始终为 true。
  9. disable → 上述 UI 在 300ms 内消失（复用 D9 计时口径）；re-enable 恢复。
- 证据：`packages/app/e2e/plugin-surface-third-party.spec.ts` 覆盖以上步骤；记录耗时与端口。
- 约束：端口隔离、结束后释放；不触碰既有进程。

#### SU-T19 全量回归与性能

- 门禁（全部必须在同一棵树、同一静止窗口内完成）：
  - root `bun run lint`、`bun run typecheck`（17 tasks）
  - `packages/novaway` 全量分片（沿用 16 分片 `bun --smol test --parallel=1 --max-concurrency=1 --timeout=120000`）
  - `bun run gate:perf`（surface 注册表改动不得让 20 插件激活超预算）
  - `bun run test:httpapi` 三模式
  - `packages/app` typecheck / unit / `vite build`
  - 真实 Chromium：`plugin-ui-budget.spec.ts`、`plugin-publish.spec.ts`、`plugin-surface-ui.spec.ts`、`plugin-surface-third-party.spec.ts`
- 记录：树指纹（内容 sha256 汇总）、每项 exit code、失败逐条定位。

#### SU-T20 结项记录

- 更新本文状态与文末证据日志；未通过项写明「未验证范围」与阻塞点，不得用「已实现」代替「已验收」。

---

## 5. 门禁定义

| 门禁         | 内容                                               | 通过标准                                                                                  |
| ------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| SU-G1 契约   | plugin-api 类型 + manifest 诊断 + 注册表语义       | 新增单测全绿；每个诊断码至少一条用例                                                      |
| SU-G2 HTTP   | `/plugin/contributions` 字段、归属、排序；SDK 生成 | `test/httpapi-plugin.test.ts` 全绿；三模式 0 missing / 0 extra；SDK types 与 app 副本一致 |
| SU-G3 浏览器 | 第三方插件全链路（SU-T18）                         | 9 步全过 + disable <300ms + 端口释放                                                      |
| SU-G4 回归   | SU-T19 全部命令                                    | 全绿，且树指纹前后一致                                                                    |
| SU-G5 性能   | `gate:perf` + UI 预算                              | B2 预算不变差；D6/D9 预算仍过                                                             |

任何门禁未通过都不得进入下一 milestone；不得用「单元测试通过」替代浏览器证据，也不得用「浏览器通过」替代全量回归。

---

## 6. 风险与回滚

| 风险                           | 影响                 | 缓解                                                                                   | 回滚                                            |
| ------------------------------ | -------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 第三方 iframe 拿到敏感工具输出 | 数据泄露             | `part.read` 显式能力 + 截断 + 安装确认展示；默认不下发                                 | 关掉 `part` 下发，只保留 `context`              |
| `command` action 越权          | 可触发宿主命令       | 只允许同插件命令；宿主保留前缀解析期拒绝；执行走「填入 `/命令`」而非 `command.trigger` | 把 `plugin-command-action` 的执行退回「仅内置」 |
| 明文 secret 落入配置文件       | 凭据可被本机读取     | 用户已决定接受；UI 提示 + 作者文档明确（D11）                                          | 后续独立任务改走 `createSecretStore`            |
| 同名 surface 归属错            | 显示/停用错插件      | T5/T6 命名空间 + 注册表归属                                                            | 注册表与 handler 一起回退                       |
| iframe origin 校验写错         | 伪造消息             | 统一走 T9 宿主组件 + 单测覆盖错误 origin                                               | 组件回退                                        |
| 5 个 slot 宿主不存在           | 计划膨胀             | T15a 先勘察，允许只交付可定位的槽                                                      | 按槽回退                                        |
| SDK 漂移                       | App typecheck 假失败 | T6 明确「生成 + 同步 node_modules 副本 + typecheck」三步一起验                         | 生成物回退                                      |
| 全量测试内存不足               | 门禁无法完成         | 沿用 16 分片 `--smol` 低并发                                                           | —                                               |
| 另一进程并行修改 App 源码      | 回归误判             | 等静止窗口；记录 tree 指纹                                                             | —                                               |

---

## 7. 已确认的决定（2026-11-14）

| #   | 问题                           | 决定                                                                                                                                                      | 落地位置                   |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | `secret` 字段是否等待密钥路由  | **允许明文**写入 `plugins.config`，本轮不新增 secrets 路由；必须加 UI 提示与文档说明                                                                      | D11、SU-T8、SU-T16、SU-T17 |
| 2   | 剩余 slot 是否本轮做           | **能做的都做**：`sidebar.footer`、`composer.action`、`statusbar.item`、`home.card`、`notification.item`；先勘察宿主，无法定位的记 `slot_preview` 并报阻塞 | SU-T15                     |
| 3   | `session.panel` 是否提前       | **提前到 M2**，按 stable 处理                                                                                                                             | SU-T13                     |
| 4   | `contributes.storage` 激活即拒 | **并入本轮**修复（允许清单 + namespace 校验）                                                                                                             | SU-T4b                     |
| 5   | 第三方 `command` action        | **支持**，但只允许触发本插件贡献的命令；宿主命令一律拒绝                                                                                                  | D6、SU-T14                 |

原待决清单已全部关闭；若实现中出现新分歧，按前序计划 §2.3 记录原因与影响范围后再调整。

---

## 8. 证据日志（追加，不覆盖）

- 2026-11-14 SU-T1 完成：新增 `packages/novaway/script/plugin-surface-baseline.ts` 与 `docs/plugin-surface-baseline-2026-11-14.json`。脚本使用临时 XDG/DB、临时 project、当前 production `Server.listen({hostname:127.0.0.1,port:0})`，覆盖空项目、内置 `novaway-ui`、project-scope manifest/plugin/diagnostics 与第三方 Surface toggle。改造前两次独立运行输出逐字节一致；基线记录第三方 Surface toggle 为 HTTP 409、`capability_denied`（原文「Office 引擎、Publish driver 和 Surface 贡献当前只对内置插件开放」）。本次运行只启动隔离随机端口 listener，已 stop 并清理临时目录；未重启既有服务。随后为验证 SU-M1 的放行行为运行同一脚本，第三方 Surface toggle 已变为 HTTP 200，但未覆盖写入基线文件。
- 2026-11-14 SU-M1：`PluginCatalog` 现在保留 `description/icon/action/view/render/order`，HTTP schema 增加 `render/order/ui`，第三方 Surface 的 `pluginID/scope/name/localName` 来自 ContributionRegistry Entry；`test/server/httpapi-plugin.test.ts` 27 pass，Manifest/registry/runtime 定向集合 115 pass、1 skip，storage/runtime 集合 77 pass、1 skip。生产隔离 baseline 再次返回第三方 Surface toggle HTTP 200，且 project contribution 保留 `pluginID=surface-baseline`、`scope=project` 与命名空间名。
- 2026-11-14 SU-T2/SU-T3/SU-T4/SU-T4b/SU-T5/SU-T6：plugin-api 增加 `ViewRender` 与 previewer render 契约；Manifest 拒绝未知 slot、危险 URL、宿主命令和无 render/viewId previewer；第三方 surfaces/storage 放行；Surface 使用统一 ContributionRegistry；storage namespace 正向/隔离/越权测试通过；OpenAPI/SDK 已生成，并通过 `diff -qr packages/sdk/js/src/v2/gen packages/app/node_modules/@novaway/sdk/src/v2/gen`。
- 2026-11-14 SU-T7/SU-T8/SU-T9/SU-T10/SU-T11/SU-T13/SU-T14/SU-T15：App 新增 sandboxed `PluginViewHost`（`allow-scripts`、`no-referrer`、postMessage init/action bridge），全页 view、settings iframe/view、previewer iframe、message renderer iframe、session.panel、composer/statusbar/home/notification/sidebar.footer 宿主已接线；command action 仅接受同插件已声明 command，并通过 composer slash command 事件，不直接调用宿主 command；secret 设置页和作者文档明确明文保存。
- 2026-11-14 SU-T16/SU-T17：marketplace catalog 支持 `permissions` 并在安装条目 tags 中展示；新增 `docs/plugin-surface-author-guide.md` 与 `packages/plugin-api/test/fixture/surface-plugin/plugin.json`。
- 2026-11-14 门禁：root `typecheck` 17/17 task 通过；NovaWay `typecheck` 通过；`gate:perf` 通过（20 plugins，heap growth 9.43MB）；HTTP API coverage/auth/effect 三模式 435 pass、0 fail、0 skip、0 missing、0 extra；App typecheck 与 46 个定向 UI/preview/sync 测试通过。App build 的 Vite web bundle 成功，但后续跨平台打包阶段因 Windows 环境下载 `bun-linux-x64-v1.3.14` 不完整失败，未归因于 Surface 代码。NovaWay 全量 `bun test --timeout 120000` 在 `test/server/httpapi-sdk.test.ts` 后超过 600 秒无新输出，已停止本轮自己启动的测试进程（exit 143），因此 SU-T19/SU-G4 未验收。
- 2026-11-14 SU-T12：实现 `PluginRuntimeService.activateOnDemand`，按 `transition(instance, true, false)` 激活但不写入 enabled 持久状态；`/plugin/contributions` 对匹配 `onView:<viewId>` 的 installed 插件派发按需激活，并按 registry 命名空间去重 Surface catalog 条目。新增 HTTP 回归测试：28 pass、0 fail，验证 `installed → active` 且 `PluginStorage` 无 enabled 记录。隔离第三方 Chromium fixture 移除预先 enable PATCH，真实流程直接打开 view，验证 iframe、sandbox/no-referrer、session.panel、同插件 command bridge、`status=installed + runtimeStatus=active` 与 disable；结果 `1 passed (26.6s)`。本轮只启动并停止自有 backend 4220 与 Vite 3240，结束后端口均已释放。
- 2026-11-14 最终门禁复核：NovaWay package typecheck 通过；root typecheck 17/17 tasks 通过；`verify:plugins` exit 0（B1 基线外新增 0，D1–D9、leak gate、B2 均通过；B2 20 plugins heap growth 7.84MB）；root lint 0 errors（既有 warnings）。`test/server/httpapi-plugin.test.ts` 28 pass，plugin test 集合 328 pass、1 skip；App unit 1218 pass、5112 expectations、169 files；App typecheck 与 standalone Vite build 通过；HTTP API 已有同一静止窗口证据 coverage/auth/effect 各 435 pass、0 fail、0 skip、0 missing、0 extra；性能门禁此前通过（20 plugins，heap 8.96MB，cold median 17.16ms，warm median 15.22ms，activation median 13.54ms，firstOnTool p95 1.2ms）。本次追加的 `test:httpapi` 重跑 coverage 完成 435/435、auth 完成 435/435，但 effect 阶段在启动两个临时 instance 后超过 600 秒无新输出，已停止本轮命令；不覆盖此前 435/435 通过证据，也未触碰既有服务。
- 2026-11-14 发行门禁：`gate:release` G1–G5、G7 通过，G6 按门禁规则失败，因为当前没有人工抽样记录（“没有抽样，无法评估误判通过率”）；这是独立发行流程的人工证据缺口，不是本计划 Surface 实现失败，故本文不伪记为通过，保留为未验证范围。
- 2026-11-14 SU-T18 补全验收：将隔离 fixture 扩展为第三方 `settings.section`（text + secret）、render-only previewer、`message.part.renderer` iframe 与实际 `.surface-e2e` 文件；Chromium 流程新增设置写入/读取、secret 明文提示、previewer iframe、message renderer iframe、disable latency 断言。为修复真实 renderer 数据桥中的 `DataCloneError`，`PluginViewHost` 对 postMessage 数据增加 structuredClone/JSON fallback。最终隔离 Chromium 结果：`1 passed (41.0s)`，包括 view、sandbox/no-referrer、onView 状态、previewer、settings 持久配置、message renderer、session.panel、同插件 command bridge、disable 后 Surface 消失与 `<300ms` 断言。
- 2026-11-14 SU-T18 restart 证据：扩展 `plugin-surface-e2e-server.ts` 支持固定临时根目录复用；在同一隔离 project/DB 上停止并重启 backend。重启前：`installed/None` → contributions 请求触发 `active`；重启后再次观察为 `installed/None`，重新请求 view contribution 后为 `installed/active`。通过 `/config` 写入 `surface-e2e.token=restart-persisted-token`，停止并重启后再次读取值保持不变。固定根目录未写入用户目录；backend 停止后 4220、Vite 3240 均无监听。
- 2026-11-14 SU-T19 树指纹：对 7,814 个 git tracked 文件（排除自引用计划文档）及 SU-T18 未跟踪 e2e 文件做两次内容 SHA-256，结果均为 `7561172775d3b0c732980f5b5b81c35cdf02aa917510da5c1f6425ac8c2a00b7`，`stable=true`；记录于 `docs/plugin-surface-tree-fingerprint-2026-11-14.json`。App full unit 更新后为 1,219 pass、0 fail、5,112 expectations；App typecheck、NovaWay typecheck、plugin HTTP 28 pass 均通过。
- 2026-11-14 最终 SU-T19 复核：root `bun run typecheck` 17/17 successful；root lint 0 errors（warnings only）；App typecheck 通过；App full unit 1,219 pass；`test/server/httpapi-plugin.test.ts` 28 pass；SU-T18 Chromium `1 passed (41.0s)`。本轮所有自有 4220/3240 进程均已停止并确认无监听。
- 2026-11-14 HTTP effect 复核：发现 full exerciser 的长时间问题由测试环境组合生命周期与远程 models.dev 依赖共同放大。`test/server/httpapi-exercise/runner.ts` 现在在每个 scenario 完成后显式 dispose InstanceStore context；`environment.ts` 固定使用本地 `test/tool/fixtures/models-api.json`，避免模型目录网络请求。修复后独立 plugin effect 9/9 通过、单独 `v2.model.list` 通过；一次完整复跑已完成 coverage 435/435、auth 435/435，effect 达到 434 pass/1 fail，唯一失败为 inventory 的 `/memory/embedding/setup-local` 30s timeout，而该 scenario 单独重跑已通过。完整 435/435 effect 仍需在低资源静止窗口复跑确认，不能提前标记为全绿。
- 2026-11-14 外部门禁未关闭：未执行 git commit；未重启或终止既有服务。`gate:release` G6 需要真实人工抽样记录；当前导出的 pass-records 为 0 条，`--sample` 无法制造人工证据，因此不能伪造 `reviewed/wrong`。跨平台打包仍受 Windows 下载 `bun-linux-x64-v1.3.14` 不完整影响。
- 2026-11-14 HTTP API 最终复跑：为避免 435 个串行 scenario 在单进程 600 秒窗口内受资源与生命周期组合放大，新增 `test/server/httpapi-exercise` 的 `--shard/--shards` 选择能力与 `script/httpapi-effect-shards.ts` 低并发分片入口；`test:httpapi` 现在执行 coverage、auth 后以 2 个 effect 分片运行，并对瞬时失败分片最多重试一次。最终 `bun run test:httpapi` exit 0：coverage `435 pass / 0 fail / 0 skip / 0 missing / 0 extra`，auth 同上，effect 两分片 `217 pass + 218 pass = 435 pass`，无 fail/skip/missing/extra。最终运行中一个分片首次出现单个 30s timeout，自动重试后 `217/217` 通过；该事实保留，不将首次瞬时失败隐藏为未发生。
- 2026-11-14 SU-T19 NovaWay 全量分片复核：按计划使用 `bun --smol test --shard=N/16 --parallel=1 --max-concurrency=1 --timeout=120000` 完成 16/16 分片，全部 exit 0、0 fail；合计 `4,601 pass`、`50 skip`、`1 todo`，共 4,652 tests。root `bun run typecheck` 17/17 successful；root `bun run lint` 0 errors（161 warnings，均为既有/非阻断 warning）；NovaWay typecheck、plugin HTTP 28 pass 与 HTTP API 三模式最终门禁均已复核。`gate:release` G6 仍没有人工抽样记录，不能伪造为通过。
