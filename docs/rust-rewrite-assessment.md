# NovaWay Matrix 用 Rust 重写：完整评估

> 评估日期：2026-10-27  
> 评估对象：NovaWay Matrix 当前 monorepo、ZCode（zai-org/ZCode）、cc（E:\AImoney\cc）  
> 结论先行：**不建议一次性全量重写。建议采用“Rust 内核 + 保留现有 TS UI + 绞杀式迁移”的路线；先做 6–8 周技术验证，再决定是否全面转 Rust。**

---

## 0. 一页结论

### 0.1 三个必须先说清楚的事实

1. **ZCode 和 cc 都不是 Rust 项目。**  
   ZCode 主仓库约 18,266 个文件，其中 `.ts` 8,234 个、`.tsx` 1,023 个、`.rs` 0 个，技术栈是 TypeScript + React/Ink + Electron。cc 同样是 TypeScript/Ink。  
   所以“结合 ZCode/cc 的优势用 Rust 重写”并不是把现成 Rust 代码搬过来，而是：**借鉴它们的架构、协议和 Agent 行为语义，用 Rust 重新实现。**

2. **真正值得 Rust 化的核心约 14–15 万行，而不是全部 46 万行。**  
   当前生产代码约 463,636 行 TS/TSX（不含测试）。其中后端/内核约 13 万行、LLM 约 0.9 万行；Web UI 约 10.9 万行、共享 UI 约 3.2 万行、TUI 约 4.6 万行、桌面端约 1.2 万行、生成 SDK 约 3 万行。  
   **Web UI、Office、浏览器自动化、发布平台、Electron 平台能力不适合第一批重写。**

3. **重写的收益主要来自分发、启动、内存和长期可维护性，不是“模型回复更快”。**  
   Agent 是 I/O 密集型系统，Rust 不会让 LLM 推理变快；它能让单二进制分发、冷启动、常驻内存、并发会话、PTY/流式处理和崩溃隔离明显更好。  
   如果这些不是未来 12 个月的前三目标，**不应该做全量 Rust 重写**。

### 0.2 推荐方案

**目标形态：B 方案（Rust 内核 + 现有 TS UI）；落地方式：C 方案（绞杀式迁移）。**

- Rust 守护进程 `novawayd`：Agent Loop、Session、Provider、Tool、Permission、Storage、MCP/LSP/PTY、HTTP/WS/SSE Server。
- 保留现有 SolidJS Web UI、Electron 桌面壳、Office/浏览器/发布 sidecar。
- 通过**兼容现有 HTTP API + OpenAPI** 让现有 Web UI 直接连 Rust 后端，避免 10 万行前端重写。
- TUI 先保留 TS 薄客户端；等内核稳定后，再决定是否用 ratatui 重写。
- 桌面端先保留 Electron；后续可迁 Tauri，但不是第一优先级。

### 0.3 量级预估

| 目标 | 工作量 | 日历时间（4–6 人） | 置信度 |
|---|---:|---:|---|
| Rust 内核 MVP（3 Provider + 10 工具 + Session + Server + 权限） | 10–14 PM | 3–4 个月 | 中 |
| 内核功能对齐（P0–P2，不含 UI/TUI/Office） | 30–42 PM | 9–12 个月 | 低–中 |
| 内核 + TUI + 桌面 + sidecar 产品对齐 | 45–62 PM | 12–18 个月 | 低 |
| 全量 parity（含 Office/浏览器/发布/插件生态） | 55–75 PM | 18–24 个月 | 低 |

> PM = person-month（人月）。以上为量级估算，误差 ±40%。如果团队没有 Rust 生产经验，取上限再上浮 20–30%。

---

## 1. 评估基线：我们到底有多大

### 1.1 代码规模（生产代码，不含测试与生成代码）

| 包 | 生产 TS/TSX 行数 | 说明 |
|---|---:|---|
| `packages/novaway` | 130,481 | 核心 CLI/Server/Session/Tool/Provider/知识库/办公等 |
| `packages/app` | 109,403 | SolidJS Web UI |
| `packages/tui` | 46,035 | OpenTUI/SolidJS 终端 UI |
| `packages/ui` | 32,110 | 共享 UI 组件 |
| `packages/sdk-v2-latest` | 30,087 | 生成 SDK，不应手写重写 |
| `packages/core` | 12,053 | 共享工具 |
| `packages/desktop` | 11,521 | Electron 主进程/渲染层/平台能力 |
| `packages/llm` | 8,828 | Effect Schema-first LLM 核心 |
| `packages/web` | 6,899 | 官网 |
| 其他 | ~3,000 | plugin/enterprise/function/slack 等 |
| **合计** | **约 463,636** | 不含测试 |

### 1.2 关键规模指标

| 指标 | 当前值 | 对重写的含义 |
|---|---:|---|
| 后端测试文件 | 314 个 | 可复用为行为契约，但需重写为 Rust 测试 |
| 后端测试代码 | 85,890 行 | 测试资产是重写的“安全网”，也是工作量 |
| App 测试文件 | 124 个 | Playwright/E2E 可继续跑在 Rust 后端上 |
| HTTP API 端点 | 325 个（42 个 group） | 兼容 API 是保留 Web UI 的关键 |
| 工具定义 | 约 80 个 | P0 只需 10–15 个，长尾工具可 sidecar |
| SQLite 表 | 11 个 | 数据迁移风险中等 |
| 数据库迁移 | 64 个 | 必须保留向后兼容 |
| Provider 模型标识 | 89 个 | 多数走 OpenAI-compatible，可统一适配 |
| i18n key | 2,132 个 | UI 保留则无需重写 |
| Electron IPC handler | 89 个 | 桌面端平台能力复杂，不建议首批重写 |
| `packages/novaway` 运行时依赖 | 109 个 | 依赖面很大，Rust 可显著收敛 |
| `node_modules` | 6.3 GB | 分发/安装痛点明确 |
| 平台二进制包 | 约 180 MB/平台 | Rust 单二进制可降到约 30–60 MB |

### 1.3 当前技术耦合（重写难度的真实来源）

| 技术 | 涉及文件数（近似） | 迁移影响 |
|---|---:|---|
| Effect v4 | 776 | 核心业务大量使用 Effect 的 Layer/Service/Schema/Scope；Rust 需要等价抽象（trait + actor + cancellation） |
| SolidJS | 579 | Web UI/TUI 深度绑定；保留 UI 则不受影响 |
| OpenTUI | 204 | TUI 重写成本高 |
| Drizzle ORM | 75 | SQLite schema/查询需迁移到 sqlx/rusqlite |
| Bun 专有 API | 53（`Bun.file` 等） | 需要 Rust 文件/进程抽象 |
| Hono | 11 | Server 路由可被 axum 替代 |
| node-pty / @lydell/node-pty | 5 | 用 `portable-pty` 替代 |
| Electron | 29 | 桌面端保留或迁 Tauri |
| Playwright | 17 | 浏览器自动化建议保留 sidecar |

**判断：** 当前系统的复杂度不在“代码量”，而在**Effect 运行时语义、跨端协议、插件生态、Office/发布平台、数据迁移**。Rust 重写必须把这些逐个拆开，不能一次性搬。

---

## 2. ZCode 与 cc 的优势拆解

### 2.1 ZCode 的优势：工程分层 + 多端统一 + 产品化

ZCode 最值得借鉴的不是某个功能，而是它的**边界设计**。其 `apps/zcode-cli/docs/design/v2/architecture.md` 明确把 CLI 分成四层：

- `contracts/`：稳定的 port、event、error、capability、schema，不放业务实现。
- `core/`：session、turn、agent loop、tool lifecycle、permission、compact、rewind、subagent、mailbox、memory、hooks、mode，**不直接做外部 I/O**。
- `adapters/`：文件系统、子进程、HTTP、SQLite、provider、MCP、app-server、config、logger、metrics、sandbox。
- `bootstrap/`：composition root，唯一把 core 和 adapter 组装起来的地方。

这四层对 Rust 非常友好，几乎可以一对一映射为 crate：

```
contracts -> novaway-contracts
core      -> novaway-core
adapters  -> novaway-adapters
bootstrap -> novaway-runtime
```

ZCode 的其他可借鉴点：

1. **Event-first Agent Loop**  
   `Turn Input -> Event Creation -> State Transition (Reducer) -> Projection -> UI`。  
   好处：UI 只消费 projection，不直接改 core 状态；支持恢复、重放、审计、多端同步。

2. **App Server 协议统一多端**  
   `zcode app-server --stdio` 用 NDJSON frame；Web/SSH/Docker/Desktop 都作为 client 连同一个 server。  
   server 统一维护 session、模型、思考强度、模式、消息、动态、eventSeq/stateRevision。  
   这正好解决我们当前“TUI/Web/Desktop 各自一套状态”的问题。

3. **Permission Service 与 Permission Broker 分离**  
   Service 做同步判定：`allow/ask/deny`；Broker 做异步客户端协商：`allow/modify/deny/escalate`，支持超时、取消、pending 清理。  
   这比把权限弹窗逻辑塞进 Tool 里干净得多。

4. **Provider 注册表/配置覆盖/模型能力解析**  
   provider config overlay、model capability、reasoning level、stream compat、reasoning history replay、stream error retry。  
   这些是“多模型可用”的真正脏活，值得在 Rust 里做成独立 crate。

5. **Session SQLite 持久化模型**  
   `session` / `message` / `part` 分层，`part` 保存 text/reasoning/file/tool/patch/compact；另有 `todo`、`session_entry`、`permission`、`input_history`。  
   这是 Event Sourcing + Projection 的落地方式，适合 Rust + SQLite。

6. **产品化能力**  
   Web/桌面/TUI 统一、远程 SSH/WSL/Docker、UI Plugin、gen-ui、Office/PDF/Spreadsheet 插件、浏览器/Android/iOS 模拟器插件、Bots（飞书/Telegram/微信）。  
   这些不一定要全部学，但说明“Agent 工作台”应该长什么样。

### 2.2 cc 的优势：成熟的 Agent 行为语义

cc 是恢复版 Claude Code 源码，代码规模约 50 万行 TS/TSX（仅 `src/` 顶层目录合计就约 50 万行）。它的价值主要在**行为语义**，不是架构：

1. **QueryEngine / query loop**  
   `src/QueryEngine.ts`（约 1,295 行）、`src/query.ts`（约 1,729 行）把多轮工具调用、流式输出、中断、恢复、usage/cost 累计、compact boundary 串起来。  
   这是最值得做“行为对齐测试”的部分。

2. **Tool 契约**  
   `src/Tool.ts`（约 792 行）定义了工具描述、输入 schema、权限、并发、流式输出、结果格式化。  
   `src/tools/` 有 36 个工具目录：Bash/PowerShell/Read/Edit/Write/Glob/Grep/LSP/MCP/Notebook/Agent/Task*/Team*/Todo/Plan/Worktree/WebFetch/WebSearch/Skill/SyntheticOutput 等。  
   我们的 80 个工具可以按这个契约重新归类，去掉重复和产品特化。

3. **Hooks**  
   PreToolUse / PostToolUse / PostToolUseFailure / UserPromptSubmit / Stop / SubagentStart/Stop / PreCompact / PermissionRequest / SessionStart/End。  
   Hook 是“可编程 Agent”的关键扩展点，Rust 里可以用子进程 + JSON stdin/stdout 实现。

4. **权限模式与 canUseTool**  
   default/acceptEdits/plan/dontAsk/yolo/auto 等模式，配合 allow/deny 规则和交互式审批。  
   注意：cc 的 yolo/auto 语义有安全风险，不能无脑照搬。

5. **上下文管理**  
   compact、memory、file state cache、read-file-state resume、cost tracker、session memory、team memory sync。  
   这些是长会话体验的核心。

6. **Subagent / Team / Task / Background / Cron**  
   子 Agent、任务列表、后台任务、定时任务、团队协作、mailbox。  
   我们的 orchestrator/team/workflow 已经有类似能力，但语义可以对齐。

7. **Headless / SDK / ACP / Remote IO**  
   `claude -p`、stream-json、SDK、ACP、remote session。  
   我们如果要被 IDE/自动化平台集成，这层协议必须稳定。

8. **TUI/Commands/Skills**  
   大量命令、快捷键、Vim 模式、技能加载、插件市场。  
   UI 交互可以借鉴，但不要复制代码。

### 2.3 能力对照

| 能力 | ZCode | cc | NovaWay 当前 | Rust 目标 |
|---|---|---|---|---|
| Agent Loop | Event-first + reducer/projection | QueryEngine + streaming tool loop | `session/prompt.ts` + processor | Rust actor + event store |
| 多端统一 | app-server NDJSON + WS/API | TUI/headless/SDK | HTTP + SSE + SDK，多端各自状态 | 统一协议 + 多客户端 |
| Provider | 注册表/配置覆盖/能力解析 | Anthropic 为主，多 Bedrock/Vertex | 89 模型、多 Provider | trait + 适配器 |
| 工具 | core 工具 + 插件 | 36 类工具 | 80 个工具定义 | 核心 Rust + 长尾 sidecar |
| 权限 | Service/Broker 分离 | 模式 + canUseTool + hooks | 权限服务 + UI | Service/Broker 分离 |
| 持久化 | SQLite session/message/part | 文件/DB 混合 | Drizzle SQLite 11 表 | SQLite event store |
| 扩展 | UI Plugin/gen-ui/技能 | Hooks/插件/市场/技能 | plugin/skill/extension | WASM + JS sidecar |
| 远程 | SSH/WSL/Docker/Web | remote/teleport/bridge | 部分 | 后期 |
| 产品化 | Office/浏览器/模拟器/Bots | Chrome/IDE/移动端 | Office/发布/数据库/桌宠 | 保留 sidecar |

### 2.4 法律与代码复用边界

- **ZCode 是 Apache-2.0**，但仓库有 `NOTICE.md` 和 `third-party/`，如果复制代码必须保留版权/许可/第三方声明。  
- **cc 是“恢复版 Claude Code 源码”**，来源和授权并不清晰，且包含大量 Anthropic 品牌、远程服务、遥测代码。  
  **建议只把它当作行为参考，不复制任何代码、文案、提示词或常量。**  
- “架构思想、协议模式、产品交互”可以借鉴；具体实现应 clean-room 重写。  
- 如果未来要开源/商业分发，必须让法务在 Phase 0 出具意见。

---

## 3. 我们当前的核心资产（重写时必须保住）

这些是 NovaWay 相对 ZCode/cc 的差异化，不能为了 Rust 而丢：

1. **中文场景与国产模型**：DeepSeek、通义千问、智谱 GLM、Kimi、OpenAI-compatible 生态，89 个模型标识。
2. **办公自动化**：PPT/Word/Excel 生成与预览、文档/表格/PDF、图片/视频/旁白生成。
3. **内容发布闭环**：小红书、抖音、快手（含签名）、B 站、微信公众号、视频号、闲鱼；Electron webview 登录态管理。
4. **工作台能力**：文件树/编辑器、Git 面板、数据库客户端（MySQL/PostgreSQL/SQLite/Redis 等）、MCP/LSP 状态、后台任务、子 Agent。
5. **知识与记忆**：knowledge、memory、evolution、rules、skill。
6. **团队与编排**：team、workflow、orchestrator、goal、checkpoint、plan。
7. **桌面形态**：Electron 主窗口 + 悬浮桌宠 + 通知中心 + 多平台账号。
8. **TUI 体验**：46k 行 OpenTUI，多标签、侧边栏、命令面板、快捷键。
9. **本地优先/隐私**：相比 cc 的大量远程/遥测依赖，这是优势，重写时应保持“核心不依赖远程”。

**结论：** 重写的边界应该是“内核”，不是“产品”。产品层（UI/Office/发布/桌宠）优先保留，避免把差异化一起重写掉。

---

## 4. Rust 化的收益与代价

### 4.1 收益（按可信度排序）

| 收益 | 说明 | 可信度 |
|---|---|---|
| 单二进制分发 | 不再依赖 Node/Bun/npm；安装成功率、国内下载体验显著改善 | 高 |
| 冷启动 | Rust daemon 可做到 100–300ms 级别；当前 Bun/Node + 大量模块加载通常更慢 | 高 |
| 常驻内存 | 无 V8/GC 堆；长会话、多会话更稳 | 中–高 |
| 并发/流式 | tokio 处理多会话、SSE/WS、PTY、MCP/LSP 子进程更自然 | 高 |
| 崩溃隔离 | 单会话 panic 可控；sidecar 隔离 Office/浏览器 | 中 |
| 类型与协议 | serde + JSON Schema + ts-rs 可让 Rust/TS 契约同源 | 高 |
| 依赖收敛 | 109 个运行时依赖可大幅减少；供应链更可控 | 高 |
| 企业/离线 | 静态二进制、审计、沙箱、无遥测 | 高 |
| 长期维护 | 显式 trait/actor 边界，比 Effect Layer 更直观 | 中 |

### 4.2 代价

| 代价 | 说明 |
|---|---|
| 工作量 | 内核 30–42 PM；全量 55–75 PM |
| 生态差距 | Office/PPT、浏览器自动化、发布平台、富文本渲染，Rust 生态弱于 Node |
| 异步复杂度 | tokio + cancellation + backpressure + actor，设计不当会死锁/泄漏 |
| 编译时间 | 大 workspace 编译慢，需要 sccache/增量/CI 缓存 |
| 招聘/学习 | Rust 生产经验 + Agent 领域知识都要时间 |
| 双栈维护 | 迁移期 TS/Rust 并存，修 bug 要修两遍 |
| 迭代速度 | 产品需求变化时，Rust 改动成本高于 TS |
| Provider 变化 | Anthropic/OpenAI 协议频繁演进，Rust 适配器要手工跟 |
| UI/UX | Rust 重写 TUI/Web 的收益低、成本高，容易丢细节 |

### 4.3 不适合第一批 Rust 化的部分

1. **Web UI（109k 行 SolidJS）**：保留。它通过 SDK/HTTP 与后端解耦，Rust 只需兼容 API。
2. **共享 UI 组件（32k 行）**：保留。
3. **Office 生成/预览**：`pptxgenjs`、`docx`、`xlsx`、PDF 渲染在 Node 生态更成熟；先 sidecar。
4. **浏览器自动化**：Playwright 的稳定性和生态远好于 Rust 方案；先 sidecar。
5. **发布平台**：Electron webview + 平台 JS 签名/登录态，重写风险极高、收益极低；保留。
6. **插件宿主**：现有 JS/TS 插件生态不能丢；先 Node/Bun sidecar，长期再加 WASM。
7. **桌面端平台能力**：89 个 IPC handler、悬浮窗、托盘、自动更新；先保留 Electron，后续 Tauri。

---

## 5. 目标架构

### 5.1 总体形态

```
┌────────────────────────────────────────────────────────────┐
│                        Clients                             │
│  Rust CLI/TUI (ratatui, 后期)   SolidJS Web   Electron/Tauri│
└───────────────┬──────────────────────┬─────────────────────┘
                │ NDJSON/JSON-RPC      │ HTTP + SSE / WS
                ▼                      ▼
┌────────────────────────────────────────────────────────────┐
│                     novawayd (Rust)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Agent Runtime│  │ Session Store│  │ Event Bus        │  │
│  │ turn/loop    │  │ SQLite       │  │ seq + replay     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                   │            │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌────────▼─────────┐  │
│  │ Tool Runtime │  │ Permission   │  │ Provider Runtime │  │
│  │ 80+ tools    │  │ Service+Broker│ │ adapters         │  │
│  └──────┬───────┘  └──────────────┘  └────────┬─────────┘  │
│         │                                     │            │
│  ┌──────▼─────────────────────────────────────▼─────────┐  │
│  │ Adapters: FS / PTY / LSP / MCP / Git / Sandbox       │  │
│  └──────┬───────────────────────────────────────────────┘  │
└─────────┼──────────────────────────────────────────────────┘
          │ sidecar JSON-RPC
          ▼
┌────────────────────────────────────────────────────────────┐
│  Node/Bun sidecars: Office / Browser / Publishing / Plugin  │
└────────────────────────────────────────────────────────────┘
```

### 5.2 Rust workspace 布局

```
crates/
  novaway-contracts/     # 协议类型、事件、错误、capability、JSON Schema
  novaway-core/          # agent loop、session、turn、tool、permission、compact、memory、hooks
  novaway-providers/     # Provider trait + Anthropic/OpenAI/Gemini/OpenAI-compatible
  novaway-tools/         # 内置工具
  novaway-storage/       # SQLite、迁移、projection、FTS
  novaway-runtime/       # composition root、config、paths、logging
  novaway-server/        # axum、SSE、WS、auth、workspace routing
  novaway-cli/           # clap、headless、print/stream-json
  novaway-tui/           # ratatui（Phase 3）
  novaway-plugin-host/   # WASM/JS sidecar 协议
  novaway-adapters/      # fs、pty、lsp、mcp、git、sandbox、browser sidecar
  novaway-testkit/       # cassette、fixtures、contract tests
```

### 5.3 关键协议

- **统一 envelope**：`{ id, method, params, result, error, eventSeq, sessionId, revision }`。
- **传输**：
  - stdio：NDJSON，一行一帧，适合 TUI/CLI/远程 agent。
  - HTTP：REST/OpenAPI，兼容现有 Web UI。
  - WebSocket/SSE：事件流，支持断线重连 + `afterSeq` 回放。
- **事件**：`session.created`、`message.part.updated`、`tool.started`、`tool.output.delta`、`tool.completed`、`permission.requested`、`permission.resolved`、`turn.completed`、`session.compacted`。
- **快照 + 回放**：客户端先取 snapshot，再按 `afterSeq` 订阅；服务端保留事件窗口，支持 resume。
- **类型同源**：Rust `serde` + `schemars` 生成 JSON Schema；`ts-rs` 生成 TS 类型；CI 校验 breaking change。

### 5.4 并发模型

- 每个 Session 一个 actor：拥有状态，接收 `Command`，发出 `Event`。
- 每个 Turn 一个 `CancellationToken`；取消时中止 provider stream、tool 子进程、MCP 请求。
- Tool 执行用 `JoinSet`；输出通过 `mpsc` 流式回传，避免阻塞 agent loop。
- Event bus 用 `tokio::broadcast`；慢客户端丢弃/合并，不反压核心。
- 全局限制：并发 session 数、并发 tool 数、子进程数、内存/输出上限。

### 5.5 存储

- SQLite WAL；`sqlx` 或 `rusqlite`（建议 `sqlx` 便于异步/迁移）。
- 表：`session`、`message`、`part`、`event`、`todo`、`permission`、`checkpoint`、`project`、`workspace`、`account`。
- 事件表 append-only；projection 表用于 UI 查询；FTS5 用于全文搜索。
- 迁移与现有 64 个 migration 对齐；提供 `novaway migrate` 工具。
- 大对象（图片/附件/快照）落文件，DB 存路径与 hash。

### 5.6 Provider 抽象

```rust
#[async_trait]
pub trait Provider: Send + Sync {
    fn id(&self) -> ProviderId;
    fn capabilities(&self, model: &ModelId) -> ModelCapabilities;
    async fn stream(
        &self,
        request: ChatRequest,
        sink: EventSink,
        cancel: CancellationToken,
    ) -> Result<ChatResponse, ProviderError>;
}
```

统一内容块：`text / reasoning / tool_call / tool_result / image / file`。  
统一 usage：`input / output / cache_read / cache_write / reasoning`。  
适配器：
- Anthropic Messages
- OpenAI Chat Completions
- OpenAI Responses
- Gemini
- OpenAI-compatible（DeepSeek/Qwen/GLM/Kimi/OpenRouter/…）
- Bedrock/Vertex/Azure（后期）

不要直接依赖某个“大而全”的 Rust LLM 框架；provider 的怪癖太多，薄适配器 + 共享流处理更可控。

### 5.7 工具与权限

- Tool trait：`name / description / schema / permission / concurrency / timeout / execute / stream`。
- P0 工具：`read`、`write`、`edit`、`apply_patch`、`bash`、`glob`、`grep`、`todo`、`webfetch`、`question`。
- P1：`pty`、`lsp`、`mcp`、`git`、`worktree`、`task`、`agent_task`、`memory`、`skill`。
- 权限规则：`allow/ask/deny` × `session/project/global` × `tool/pattern`。
- Bash 权限：shell AST（tree-sitter-bash）+ 命令白/黑名单 + 路径边界；不要只做字符串前缀匹配。
- Sandbox：Phase 2 后再做；Windows Job Objects/AppContainer、macOS `sandbox-exec`、Linux bubblewrap/seccomp。

### 5.8 兼容现有 Web UI

这是降低风险的核心策略：

1. 先实现现有 OpenAPI 的一个子集（session/chat/event/config/provider）。
2. 用现有 108 个 `@novaway/sdk` 引用文件做契约测试。
3. Rust server 与 TS server 同端口二选一，或反向代理按路径分流。
4. 事件流必须保持 SSE 格式、字段名、顺序语义。
5. 用 Playwright 跑现有 app e2e，验证 UI 无感切换。
6. 分阶段扩大路由覆盖率，直到 100%。

### 5.9 插件与 sidecar

- **短期**：Node/Bun plugin host sidecar，JSON-RPC；现有插件/技能不改。
- **中期**：新插件走 WASM（wasmtime/extism），提供 capability 权限模型。
- **长期**：内置插件 Rust 化；第三方 JS/WASM 双轨。
- Office/Browser/Publishing 作为受控 sidecar，由 Rust daemon 管理生命周期、超时、日志、权限。

---

## 6. 方案对比

| 方案 | 内容 | 工作量 | 时间 | 风险 | 分发收益 | 建议 |
|---|---|---:|---:|---|---|---|
| A. 全量 Rust | Core + Server + TUI + Web + Desktop 全重写 | 60–90 PM | 18–30 个月 | 极高 | 高 | 不建议 |
| B. Rust 内核 + 现有 UI | Rust daemon + 保留 SolidJS/Electron/TUI | 30–45 PM | 9–15 个月 | 中 | 高 | **推荐目标** |
| C. 绞杀式 | 先 Rust 化 PTY/索引/Provider/Server 热点，逐步扩大 | 10–25 PM | 4–9 个月 | 低–中 | 中 | **推荐落地方式** |
| D. 只重构 TS | 借 ZCode 分层，不换语言 | 6–12 PM | 3–6 个月 | 低 | 低 | 备选 |

### 6.1 方向性评分（5 分制）

| 方案 | 交付速度 | 功能 parity | 性能/分发 | 维护性 | 风险 | 团队适配 | 加权 |
|---|---:|---:|---:|---:|---:|---:|---:|
| A 全量 Rust | 1 | 2 | 5 | 5 | 1 | 2 | 2.7 |
| B 混合 | 4 | 4 | 4 | 4 | 4 | 3 | 3.9 |
| C 绞杀 | 5 | 5 | 3 | 3 | 5 | 4 | 4.2 |
| D TS 重构 | 5 | 5 | 1 | 3 | 5 | 5 | 3.9 |

> 如果“单二进制/企业分发”是硬指标，B 的权重应高于 C；如果“6 个月内看到价值”是硬指标，C 更高。**推荐 B 作为目标、C 作为路径。**

### 6.2 什么情况下不该重写

- 未来 12 个月的核心目标是**产品市场验证/功能迭代**，不是分发或企业化。
- 团队没有 2 名以上 Rust 生产经验工程师。
- 无法接受 12 个月内核心功能 parity 风险。
- Office/发布平台/插件生态仍是主要收入来源，且无法 sidecar 化。
- 当前 Node/Bun 的性能/安装问题可以用更便宜的方式解决（例如单文件 SEA、压缩依赖、镜像、预编译）。

---

## 7. 分阶段路线图

### Phase 0：立项与技术验证（4–6 周）

**目标：** 用最小成本验证“Rust 内核能跑通我们最核心的链路”。

交付：
1. 架构决策记录（ADR）与 feature parity matrix。
2. 当前基线 benchmark：冷启动、RSS、TTFT、工具延迟、安装包大小、崩溃率。
3. Rust spike：
   - Provider streaming（Anthropic + OpenAI-compatible）
   - Session SQLite（session/message/part）
   - 5 个工具：read/write/edit/bash/glob
   - axum HTTP + SSE
   - 现有 Web UI 连接一个只读/聊天子集
4. 法律意见：ZCode Apache-2.0/NOTICE；cc 不复制代码。
5. 团队评估：Rust 生产力、招聘/培训计划。

**Exit criteria：**
- 能完成一轮“读文件 → 改文件 → 跑命令 → 流式返回”的完整 turn。
- 现有 Web UI 能连上 Rust server 并显示消息。
- 基线性能目标达成 ≥70%。

### Phase 1：Rust 内核 MVP（3–4 个月）

范围：
- Provider：Anthropic、OpenAI、OpenAI-compatible（DeepSeek/Qwen/GLM/Kimi）。
- 工具：read/write/edit/apply_patch/bash/glob/grep/todo/webfetch/question。
- Session：创建/恢复/取消/分页/事件流。
- 权限：allow/ask/deny + 审批 broker。
- MCP：stdio client。
- Server：兼容现有 API 子集；SSE 事件。
- CLI：headless `run` / `serve`。
- 测试：契约测试 + 50 个 e2e 场景 + provider cassette。

**Exit criteria：**
- 现有 Web UI 的核心聊天/会话/文件功能可用。
- 核心 API 契约测试通过率 ≥95%。
- 冷启动 <300ms、空闲 RSS <100MB、单二进制 <60MB。
- 内部 dogfood 一周无 P0 崩溃。

### Phase 2：内核 parity（4–6 个月）

范围：
- 80 个工具中的 P0/P1（LSP、PTY、git/worktree、task/subagent、memory、skill、websearch）。
- compaction、checkpoint/rewind、hooks、file state cache。
- 多 Provider 注册表、模型能力、reasoning、retry。
- 多 Session/后台任务/orchestrator。
- 数据迁移工具；SQLite 兼容。
- 性能/稳定性/可观测性。

**Exit criteria：**
- 核心功能 parity ≥85%。
- 现有后端测试行为对齐 ≥80%。
- 崩溃-free session ≥99.5%。
- 性能目标全部达成。

### Phase 3：产品层迁移（3–5 个月）

范围：
- TUI：决定 ratatui 重写或保留 TS 薄客户端。
- 桌面：Electron 继续用 Rust daemon；评估 Tauri。
- 插件宿主：Node sidecar → WASM/双轨。
- Office/Browser/Publishing：sidecar 协议稳定化。
- 远程 workspace（SSH/WSL/Docker）：按需。
- 发布/自动更新/签名。

**Exit criteria：**
- 桌面端安装包显著缩小。
- 插件/Office/发布功能无回退。
- 用户无感切换。

### Phase 4：全量 parity 与收尾（6+ 个月）

- 剩余长尾工具/平台。
- TUI/Office 可选 Rust 化。
- 删除 TS 内核，保留 UI/sidecar。
- 文档、贡献指南、插件 SDK、迁移指南。

### 7.1 Go / No-Go 门槛

| Gate | 时间 | 通过条件 | 不通过 |
|---|---|---|---|
| G0 | Phase 0 结束 | 核心链路跑通、性能 ≥70%、团队有信心 | 停在 C 方案 |
| G1 | Phase 1 结束 | 契约 ≥95%、dogfood 稳定、UI 可连 | 退回 C，保留 Rust 热点 |
| G2 | Phase 2 结束 | parity ≥85%、崩溃率达标、用户接受 | 延长 1 个季度或缩小范围 |
| G3 | Phase 3 结束 | 产品无回退、分发包达标 | 保留双栈，停止扩张 |

**Kill criteria：** 连续 2 个月进度 <计划的 50%，或 parity bug 导致核心用户流失，或团队 Rust 关键人员流失。

---

## 8. 工作量与成本估算

### 8.1 分模块估算

| 模块 | 现有 TS LOC | 优先级 | 策略 | Rust PM |
|---|---:|---|---|---:|
| contracts/protocol | ~2k | P0 | 新写 | 1.5–2.5 |
| session/agent loop | 13k | P0 | 重写 | 3–4 |
| tools | 14k | P0 | 核心重写，长尾 sidecar | 4–6 |
| server/API | 16k | P0 | axum 重写 | 3–4 |
| providers/llm | 9k | P0 | 重写 + 适配器 | 3–4 |
| storage/config | 6k | P0 | sqlx + 迁移 | 2–3 |
| permission/hooks/sandbox | 3k | P0 | 重写 | 2–3 |
| MCP/LSP/PTY/git | 6k | P1 | 重写 | 2.5–3.5 |
| CLI/headless | 8k | P1 | clap | 1.5–2 |
| subagent/background/orchestrator | 4k | P1 | 重写 | 2–3 |
| knowledge/memory/evolution | 10k | P2 | 重写或 sidecar | 3–4 |
| plugin/skill | 5k | P2 | JS sidecar/WASM | 2–3 |
| TUI | 46k | P3 | ratatui 或保留 | 8–12 |
| Web UI | 109k | 保留 | 0 | 0 |
| Desktop | 12k | P3 | Tauri 或保留 | 3–5 |
| Office/browser/publishing | ~15k | P3 | sidecar | 4–6 |
| 测试/CI/文档 | — | P0–P3 | — | 4–6 |

### 8.2 汇总

| 范围 | PM | 4–6 人日历 |
|---|---:|---:|
| MVP（P0 子集） | 10–14 | 3–4 个月 |
| 内核 parity（P0–P2） | 30–42 | 9–12 个月 |
| 内核 + TUI + 桌面 + sidecar | 45–62 | 12–18 个月 |
| 全量 parity | 55–75 | 18–24 个月 |

### 8.3 团队配置

建议最小配置：
- 2 名 Rust 系统工程师（tokio/axum/sqlx/trait 设计）
- 1 名前端/桌面工程师（SolidJS/Electron/Tauri）
- 1 名 QA/DevOps（跨平台 CI、e2e、发布、签名）
- 0.5 名架构/产品（协议、parity、优先级）

如果只有 1–2 人，**不要做 B 方案**，只做 C 方案的热点 Rust 化。

### 8.4 成本量级

按 45–62 PM、每 PM 全成本 ¥5–8 万估算：

- 直接工程成本约 **¥225–496 万**；
- 加上机会成本（同期不能做的新功能）、招聘、法务、跨平台签名/分发，实际预算应上浮 20–30%。

> 仅为量级参考，具体取决于团队所在地、资历和外包策略。

---

## 9. 风险清单

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 功能 parity 长期达不到 | 高 | 高 | parity matrix、双跑、feature flag、按 P0/P1/P2 收敛 |
| Office/PPT/发布生态缺失 | 高 | 高 | 保留 Node sidecar；不要首批重写 |
| 浏览器自动化能力下降 | 中 | 高 | Playwright sidecar；Rust 只做编排 |
| 插件生态断裂 | 高 | 中 | Node plugin host；WASM 双轨 |
| 数据迁移丢失/损坏 | 中 | 高 | 备份、迁移工具、双读校验、回滚包 |
| 协议不兼容导致 UI 回归 | 中 | 高 | OpenAPI 契约测试、Playwright e2e、灰度 |
| Windows 兼容（路径/PTY/WSL/Git Bash） | 高 | 高 | Windows 优先 CI、ConPTY、路径规范化 |
| 异步死锁/取消泄漏 | 中 | 中 | actor + CancellationToken + 超时 + 压测 |
| Rust 招聘/学习曲线 | 高 | 高 | 先 spike、2 名资深、外部顾问 |
| 双栈维护成本 | 高 | 中 | 时间盒、单一写者、明确退役日期 |
| 编译/CI 变慢 | 中 | 中 | sccache、增量、分层 workspace、nightly 门禁 |
| Provider 协议变化 | 高 | 中 | 薄适配器 + cassette + 快速回归 |
| 安全（命令注入/沙箱） | 中 | 高 | AST 权限、路径边界、sandbox、审计 |
| 法务（cc 源码/ZCode NOTICE） | 中 | 高 | clean-room、法务评审、保留 NOTICE |
| 性能未达预期 | 中 | 中 | Phase 0 基线、压测、火焰图 |
| 团队流失/关键人依赖 | 中 | 高 | 文档、pair、模块轮换 |

---

## 10. 关键设计决策（建议写成 ADR）

| ADR | 决策 | 理由 |
|---|---|---|
| ADR-001 | Rust 只重写内核，保留 Web UI/Electron | 降低 10 万行前端重写风险 |
| ADR-002 | 兼容现有 HTTP API + 新增 NDJSON/WS | 现有 SDK/UI 可无感迁移 |
| ADR-003 | SQLite event store + projection | 恢复/重放/多端一致 |
| ADR-004 | Provider 薄适配器，不用大框架 | 控制 reasoning/tool/usage 怪癖 |
| ADR-005 | Office/Browser/Publishing 用 sidecar | Rust 生态不成熟，保留产品能力 |
| ADR-006 | 插件先 Node sidecar，后 WASM | 不破坏现有生态 |
| ADR-007 | TUI 暂缓，保留 TS 客户端 | 46k 行、收益低 |
| ADR-008 | 桌面先 Electron，后评估 Tauri | 发布 webview/桌宠依赖 Electron |
| ADR-009 | 不复制 cc 代码 | 授权不清、品牌/遥测耦合 |
| ADR-010 | 默认本地优先、遥测可选 | 差异化与合规 |

---

## 11. 建议的下一步（现在就能做）

### 第 1–2 周：定边界

1. 冻结“Rust 内核”范围：只做 `novaway` + `llm`，不做 `app`/`tui`/`desktop`/`office`。
2. 建 feature parity matrix（P0/P1/P2/P3），标出“必须 Rust / 可 sidecar / 保留 TS”。
3. 跑基线 benchmark：
   - `novaway` 冷启动、空闲 RSS、首 token 延迟、工具延迟；
   - 安装包大小、`node_modules` 大小、CI 时间；
   - 10 个典型任务的端到端耗时。
4. 法务评审 ZCode NOTICE 与 cc 授权。
5. 确定 2 名 Rust owner。

### 第 3–8 周：技术 spike

最小验证链路：

```
Web UI -> Rust HTTP/SSE -> Session Actor -> Provider Stream -> Tool(read/edit/bash) -> SQLite -> Event -> Web UI
```

验收：
- 3 个 Provider（Anthropic/OpenAI/OpenAI-compatible）流式；
- 5 个工具；
- 会话恢复/取消；
- 权限 allow/ask/deny；
- 现有 Web UI 能完成一轮真实任务；
- 冷启动/RSS/二进制大小达到目标的 70%。

### 第 9 周：Go/No-Go

- 如果达标：进入 Phase 1，按季度 gate 推进。
- 如果不达标：转 C 方案，只 Rust 化 PTY/文件索引/Provider 代理/Server 热点，保留 TS 内核。

---

## 12. 附录

### 12.1 Feature parity 分层

**P0（MVP 必须有）**
- 会话创建/恢复/取消/分页
- 消息/part 流式
- Anthropic/OpenAI/OpenAI-compatible Provider
- read/write/edit/apply_patch/bash/glob/grep/todo/webfetch/question
- 权限 allow/ask/deny + 审批
- SQLite 持久化
- HTTP/SSE（兼容现有 UI）
- MCP stdio
- 错误/重试/usage

**P1（内核 parity）**
- compaction、checkpoint/rewind
- hooks
- subagent/background/orchestrator
- LSP、PTY、git/worktree
- memory/skill
- websearch
- provider 注册表/能力/reasoning
- 多 workspace

**P2（产品增强）**
- knowledge/evolution
- database client
- team/workflow
- plugin host
- remote SSH/WSL/Docker
- TUI Rust

**P3（保留/后期）**
- Office 生成/预览
- 浏览器/CUA
- 发布平台
- 桌宠/通知
- 图片/视频/旁白
- Android/iOS 模拟器
- Web share

### 12.2 建议的 Rust 依赖

| 领域 | 推荐 |
|---|---|
| 异步运行时 | tokio |
| HTTP/WS | axum + tower + tower-http |
| 序列化/Schema | serde + schemars + ts-rs |
| SQLite | sqlx（或 rusqlite） |
| PTY | portable-pty |
| 文件监听 | notify |
| Glob/Grep | ignore + globset + grep-searcher |
| Diff/Patch | similar + diffy |
| 语法/AST | tree-sitter + tree-sitter-bash |
| Markdown | pulldown-cmark / comrak |
| 高亮 | syntect / tree-sitter-highlight |
| Git | gix / git2 |
| MCP | rmcp（官方 Rust SDK） |
| LSP | lsp-types + async-lsp |
| 终端 UI | ratatui + crossterm |
| 桌面 | Tauri 2 |
| 密钥 | keyring |
| 剪贴板 | arboard |
| Office | zip + quick-xml + calamine + rust_xlsxwriter + docx-rs |
| 浏览器 | chromiumoxide / headless_chrome（或 Playwright sidecar） |
| CUA | enigo + xcap/scap |
| 日志/追踪 | tracing + tracing-subscriber + opentelemetry（可选） |
| 错误 | thiserror + anyhow |
| CLI | clap |

### 12.3 术语

- **PM**：person-month，人月。
- **Parity**：与现有产品行为/功能对齐。
- **Sidecar**：独立进程，通过 JSON-RPC/stdio 与 Rust 内核通信。
- **Event Sourcing**：只追加事件，状态由事件投影得到。
- **Projection**：面向 UI/查询的状态视图。
- **Strangler**：逐步替换旧系统，而不是一次性重写。

---

## 13. 最终建议

1. **不要把“Rust 重写”当成目标本身。** 先明确它要解决的是分发、启动、内存、企业化，还是代码质量。不同目标对应不同方案。
2. **ZCode 值得学的是分层、协议、事件驱动、权限 broker、多端统一；cc 值得学的是 Agent loop、工具契约、hooks、上下文管理、子 Agent。** 两者都不是 Rust，不能直接搬代码。
3. **最优解是 B + C：Rust 内核 + 保留 TS UI + 绞杀式迁移。**  
   - 先 Rust 化核心 14 万行，不碰 10 万行 Web UI 和 4.6 万行 TUI。  
   - 用现有 HTTP API/OpenAPI 让 Web UI 无感切换。  
   - Office/浏览器/发布/插件先用 sidecar 保住产品能力。
4. **先做 6–8 周 spike，再决定是否全面转 Rust。** 如果 spike 的启动、RSS、二进制大小、开发速度不达预期，停在 C 方案，仍然能获得大部分性能/分发收益。
5. **如果团队只有 1–2 人，或未来 12 个月以功能迭代为主，建议只做 C，不做全量 Rust。**

> 一句话：**Rust 化内核是合理的，重写整个产品是不合理的；先借 ZCode 的骨架和 cc 的行为语义，把“内核”做成一个可独立演进、可 sidecar 扩展、可被现有 UI 复用的 Rust 服务。**
