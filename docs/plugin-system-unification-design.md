# NovaWay「万物皆插件」改造设计

> 版本：v3.1（2026-11-07）
> 状态：定稿（验收 D1–D9、门禁 B1–B3、决策 Q1–Q21、M0 任务拆解、作者迁移指南）
> 姊妹篇：`docs/super-agent-plugin-design.md`（super-agent 运行时改造，与本篇共用插件底座）
> 取代：v3.0（2026-11-05，本版只修订实现层，未改动任何验收、门禁、决策与里程碑）
> 取代：v2.2（补齐错误模型、可观测性、市场、插件管理 UI、会话内权限、存储 schema、UI 性能预算）
> 取代：v2.0（补齐边界声明、核心工具判据、依赖顺序、宿主面贡献点）
> 历史：v1.0（以「统一三套插件机制」为目标），已被取代
> 目标版本：NovaWay 1.16 → 1.20
> 验收口径：**在不修改内核任何文件的前提下，能新增一个工具、Agent、Provider、Office 格式、发布平台、界面入口；并且停用任意内置插件后，对应能力从工具、UI、提示词中一起消失。**

---

## 0. 验收标准（先写验收，再写设计）

### 0.1 一句话定义

「万物皆插件」不是「有一个插件目录」，而是：

> **内核不知道任何具体能力的存在。所有能力——包括 NovaWay 自带的——都以插件形式注册，内核只认识贡献点（contribution）和注册表（registry）。**

判断是否做到，不看代码结构，看下面 9 个演练能不能通过。

### 0.2 九项验收演练

每个演练都是「只新增文件 + 一份 manifest，然后观察行为」，并且明确列出**禁止修改**的文件。任何一条需要改内核文件，都算不通过。

| 编号   | 演练                                                             | 必须生效                                                                                                                      | 禁止改动                                                                                                                                                            |
| ------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | 新增一个工具 `weather`                                           | 模型工具列表出现该工具（默认 `<pluginID>_weather`，声明 `global: true` 时为 `weather`）；调用返回结果；`tool_search` 能发现它 | `src/tool/registry.ts`、`src/session/prompt.ts`、`src/agent/agent.ts`                                                                                               |
| **D2** | 新增一个 Agent + 一个 Skill + 一个 Command                       | Agent 选择器可见；Skill 可加载；Command 面板可执行（命名按 §4.8）                                                             | `src/agent/agent.ts`、`src/skill/index.ts`、`src/command/index.ts`                                                                                                  |
| **D3** | 新增一个 Provider `acme`                                         | `/provider` 列表出现 `acme`；配置 Key 后模型可选；流式对话可用                                                                | `src/provider/provider.ts`、`src/provider/transform.ts`、`src/provider/schema.ts`                                                                                   |
| **D4** | 新增一种 Office 格式 `.foo` + 一个预览器                         | `officeFormatOf` 识别 `.foo`；文件页签选中后走新预览器；读写 API 可用                                                         | `packages/core/src/office/engine/registry.ts`、`packages/app/src/pages/session/file-tabs.tsx`                                                                       |
| **D5** | 新增一个发布平台 `acme`（含驱动 + 能力声明）                     | 账号页出现 `acme`；发布能力矩阵自动包含它；发布流程可执行                                                                     | `packages/desktop/src/main/platform/index.ts`、`packages/app/src/pages/pulse/publish-capabilities.ts`、`packages/app/src/pages/pulse/AddAccountModal.tsx`           |
| **D6** | 新增一个界面入口（侧栏项 + 整页 + 设置分组 + 工具结果渲染器）    | rail 出现图标；点击打开插件页面；设置里出现分组；自定义工具结果按新渲染器显示                                                 | `packages/app/src/pages/layout.tsx`、`packages/app/src/app.tsx`、`packages/app/src/components/settings-runtime.tsx`、`packages/app/src/pages/session/file-tabs.tsx` |
| **D7** | 停用任意内置插件                                                 | 其工具、Agent、Skill、UI 入口、预览器一起消失；会话不报错；其他插件不受影响                                                   | 无（只改配置/调用停用 API）                                                                                                                                         |
| **D8** | 第三方插件覆盖一个内置贡献（`overrides: ["builtin.knowledge"]`） | 同名工具/命令解析到第三方实现，提示词里只有一个；内置插件状态 `overridden`；停用第三方后内置恢复                              | 任何源码或 `builtin.*` 插件文件（只加插件 + 改配置）                                                                                                                |
| **D9** | 会话进行中停用/启用插件（不重启进程）                            | 当前轮不崩；下一轮工具列表更新；UI 经 SSE 即时变化；重新启用后完全恢复                                                        | 无（只调 API）                                                                                                                                                      |

D8 与 D9 把「上帝视角下能装」升级成「运行期真的可插拔」：前者验证覆盖与优先级，后者验证快照与热更新（§4.9、§4.11）。

### 0.3 三项硬门禁

| 门禁            | 判定方式                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **B1 依赖方向** | `kernel.manifest.json` 里 `kernel` 列出的文件，不得 import `capability` 列表里的任何文件；CI 静态扫描失败即阻断              |
| **B2 性能**     | 20 个插件冷启动新增开销 < 400ms；每轮拦截器总开销 < 15ms；停用插件后无残留定时器/监听                                        |
| **B3 回归**     | `bun lint`、`bun typecheck`、`packages/novaway` 全量测试、`packages/app` 构建通过；旧插件、旧 Extension、Claude 插件行为不变 |

### 0.4 什么不算通过

以下做法看似「插件化」，实际仍然绑死内核，不算通过：

- 在 `tool/registry.ts` 里加一行 `import { WeatherTool }`。
- 在 `provider.ts` 里加一个 `if (providerID === "acme")` 分支。
- 在 `engineFor` 里加一个 `if (format === "foo")`。
- 在 `publish-capabilities.ts` 的 `MATRIX` 里加一行。
- 在 `layout.tsx` 的 `railItems` 里加一个对象。
- 把插件代码放进 `packages/novaway/src`，只是换了个目录名。

### 0.5 明确不做的边界

「万物皆插件」不等于「内核为零」。下面五条是**刻意不做**的，写在这里比写在风险里更有约束力：

| 不做                                                                          | 原因                                                                     | 替代方案                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 核心工具插件化（read / write / edit / bash / glob / grep / task / todowrite） | 插件加载本身依赖读文件和执行命令，抽出去会形成「加载插件需要插件」的循环 | 白名单 + 新增需 RFC（§8.1.1）                                    |
| 前端 ESM 联邦（插件动态 `import()` Solid 组件）                               | Solid 双实例会破坏响应式；CSP、版本偏移、桌面端 `file://` 都是长期负担   | 第一方 `viewId`（宿主组件，路由级懒加载），第三方 iframe（§9.8） |
| 内核热更新                                                                    | 内核是唯一稳定层，热更新等于没有稳定层                                   | 插件热启用/停用；内核随版本发布                                  |
| 第三方继承团队编排 / 工作流引擎                                               | 并发模型、成本归属、权限尚未稳定                                         | 以稳定的工具契约暴露（`task`、`task_status`），不做继承（Q13）   |
| 零字节残留                                                                    | 第一方 UI 组件仍在 App 打包产物里                                        | 要求**零行为残留**：停用后入口消失、路由 404、贡献不可见（D7）   |

---

## 1. 现状：为什么现在做不到

### 1.1 内核被具体能力硬编码

| 事实                                                                 | 位置                                                                                                  | 后果                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 62 条工具 import、115 次 `Tool.init(...)`                            | `packages/novaway/src/tool/registry.ts`（1427 行）                                                    | 新增工具必须改内核；停用只能靠 `config.tools[id] = false` 隐藏，代码仍在 |
| Provider 3112 行，二十多个 SDK 适配器 + 85 处 `providerID` 分支/赋值 | `packages/novaway/src/provider/provider.ts`（3112 行）                                                | 新增厂商必须改内核；免费额度、模型发现、协议差异都写死在主文件           |
| 19 个内置 Agent 的提示词、工具集、权限写死                           | `packages/novaway/src/agent/agent.ts`（965 行）                                                       | 停用 Agent 只能从配置里删，提示词仍打包                                  |
| `engineFor` 是一串 `if (format === ...)`                             | `packages/core/src/office/engine/registry.ts`                                                         | 新增格式必须改 core；app 与 CLI 都依赖这个 switch                        |
| 平台注册表 + 渲染层能力矩阵两份真相                                  | `packages/desktop/src/main/platform/index.ts`、`packages/app/src/pages/pulse/publish-capabilities.ts` | 加平台要改 4 处（主进程、矩阵、i18n、UI），漏一处就置灰                  |
| 侧栏入口硬编码                                                       | `packages/app/src/pages/layout.tsx`（3475 行，`railItems` 在 3060 行附近）                            | 第三方无法加入口；停用能力后入口不会消失                                 |
| 设置页硬编码分节                                                     | `packages/app/src/components/settings-runtime.tsx`（4319 行）                                         | 插件无法提供自己的设置界面                                               |
| 预览分发硬编码                                                       | `packages/app/src/pages/session/file-tabs.tsx`（4415 行）                                             | 新预览器必须改这个巨型组件                                               |

### 1.2 三套插件机制并存

| 机制          | 入口                           | 能贡献                                                     | 核心缺陷                                       |
| ------------- | ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------- |
| Server Plugin | `config.plugin`                | tool / auth / provider models / 拦截器                     | 只能加 Hook，不能加 UI；工具名不隔离           |
| Extension     | `plugin.json` 等 4 种 manifest | command / agent / skill / hook / MCP / tool / output-style | 无 `apiVersion`；与 Server Plugin 两套命名规则 |
| TUI Plugin    | `@novaway/plugin/tui`          | 路由 / 命令 / 快捷键 / 对话框 / 主题 / Slot                | 只在 TUI 生效；Web 无对应物                    |

### 1.3 已经具备的资产（不需要从零造）

| 资产                       | 位置                                                 | 在目标架构里的角色                 |
| -------------------------- | ---------------------------------------------------- | ---------------------------------- |
| 声明式 Manifest + 目录发现 | `extension/schema.ts`、`extension/loader.ts`         | 统一 Manifest 的基础               |
| 版本 / 依赖校验            | `extension/validate.ts`                              | `apiVersion` / `engines` 校验      |
| zip / git 安装与卸载       | `extension/marketplace.ts`                           | 唯一安装通道                       |
| spec 解析与 npm 安装       | `plugin/shared.ts`、`plugin/loader.ts`               | 解析器                             |
| 延迟工具激活               | `tool/activation.ts`                                 | 惰性激活的现成机制                 |
| 工作区适配器注册表         | `control-plane/adapters/index.ts`                    | 「内置 + 插件注册」的样板          |
| Office 引擎契约            | `packages/core/src/office/engine/contract.ts`        | 注册表的接口基础                   |
| 发布驱动数据结构           | `desktop/src/main/platform/publish/drivers.ts`       | 已经是数据驱动，只差注册           |
| TUI 内置插件化             | `packages/tui/src/feature-plugins/*`（12 个）        | 证明「第一方也走插件」在 UI 侧可行 |
| HTTP API 组织              | `server/routes/instance/httpapi/groups/extension.ts` | `/plugin` 组的模板                 |

---

## 2. 目标架构

### 2.1 三层

```
┌──────────────────────────────────────────────────────────────────┐
│ ① 内核 Kernel（对能力一无所知）                                    │
│                                                                   │
│  Session / Message / AgentLoop / ToolRuntime / Permission         │
│  Storage / Bus / LLM Transport / ConfigMerge                      │
│  ContributionRegistry · PluginHost · InterceptorRuntime           │
│                                                                   │
│  只 import：plugin-api（类型）、shared（工具函数）、其他内核文件    │
└──────────────▲──────────────────────────────▲───────────────────┘
               │ 注册贡献                      │ 调用/事件
┌──────────────┴───────────────┐  ┌───────────┴───────────────────┐
│ ② 第一方插件 First-party      │  │ ③ 第三方插件 Third-party       │
│                              │  │                               │
│  builtin.office              │  │  用户目录 / npm / 市场          │
│  builtin.office-engines      │  │  子进程隔离（L1）               │
│  builtin.providers           │  │  iframe（L2，UI）               │
│  builtin.browser             │  │                               │
│  builtin.team / workflow     │  │                               │
│  builtin.memory / knowledge  │  │                               │
│  builtin.publish / ui        │  │                               │
│                              │  │                               │
│  同 manifest、同生命周期、     │  │  同 manifest、同生命周期、       │
│  但持有 KernelApi（特权）      │  │  只持有 PluginContext（受限）    │
└──────────────────────────────┘  └───────────────────────────────┘
```

**关键区别不是「是不是插件」，而是「拿到哪一层 API」**。第一方与第三方走同一套 Manifest、注册表、生命周期、诊断；差别只在能力授权（§5、§11）。

### 2.2 依赖方向（唯一硬约束）

```
plugin-api  ←──  kernel  ←──  builtin plugins
    ↑                                  ↑
    └──────────  third-party plugins ──┘
```

规则：

1. `plugin-api` 只含类型与纯函数，不依赖 kernel、不依赖任何 SDK。
2. `kernel` 只能 import `plugin-api` 与 `shared`，不得 import `kernel.manifest.json` 里 `capability` 列出的文件，也不得 import `src/plugins/**` 或 `packages/plugins/**`。
3. 插件只能 import `plugin-api`；第一方额外允许 import `kernel` 的公开导出（`KernelApi` 类型）。
4. App / Desktop / TUI 通过 **HTTP 贡献发现接口** 获取插件能力，不通过编译期 import。

### 2.3 内核边界清单

新增 `packages/novaway/kernel.manifest.json`：

```json
{
  "version": 1,
  "milestone": "M0",
  "kernel": [
    "src/session/session.ts",
    "src/session/prompt.ts",
    "src/session/message-v2.ts",
    "src/tool/tool.ts",
    "src/tool/registry.ts",
    "src/tool/activation.ts",
    "src/permission/**",
    "src/storage/**",
    "src/bus/**",
    "src/plugin/**",
    "src/config/config.ts",
    "src/provider/provider.ts",
    "src/agent/agent.ts"
  ],
  "shared": ["src/util/**", "src/id/**", "src/effect/**"],
  "capability": [
    "src/tool/office-*.ts",
    "src/tool/browser*.ts",
    "src/tool/computer.ts",
    "src/tool/memory*.ts",
    "src/tool/knowledge*.ts",
    "src/tool/database.ts",
    "src/tool/task-tools.ts",
    "src/tool/team-run.ts",
    "src/tool/cron.ts",
    "src/tool/monitor.ts",
    "src/tool/subscribe.ts",
    "src/office/**",
    "src/browser/**",
    "src/computer/**",
    "src/memory/**",
    "src/knowledge/**",
    "src/team/**",
    "src/orchestrator/**",
    "src/dynamic-workflow/**",
    "src/plugin/codex.ts",
    "src/plugin/azure.ts",
    "src/plugin/poe.ts",
    "src/plugin/cloudflare.ts",
    "src/plugin/digitalocean.ts",
    "src/plugin/github-copilot/**",
    "packages/core/src/office/**",
    "@novaway/core/office/**"
  ]
}
```

边界测试（`test/architecture/kernel-boundary.test.ts`，扫描器 `script/scan-boundary.ts`）扫描 `kernel` 文件里的 import：

- 命中 `capability` 路径 → 失败，错误信息给出「该能力应改为插件贡献」。
- **只放过整条 `import type` 声明**（`import type { X } from "..."`）。`import { type X, y } from "..."` 里的 `type` 说明符**按运行时依赖计算**——扫描器用 AST，不做文本猜测，宁可多报也不漏报：漏报会让能力依赖从门禁里消失，多报只是基线多一行、可以豁免。
- 动态 `import("...")` 与 `export ... from "..."` 同样计入。

匹配一条 import 时依次用三种形态去撞 `capability` glob：解析后的**仓库相对路径**、去掉 `packages/novaway/` 前缀的**包内路径**、以及**原始 specifier**（`@/memory/service` 这类别名保留原样）。因此同一份清单既能写包内 glob，也能写跨包 glob，还能拦住还没解析成功的别名——扫描器不依赖 tsconfig 的 paths 配置。

`capability` 里除了本包的目录，还必须包含 **`packages/core/src/office/**`** 和 **`@novaway/core/office/**`**：§1.1 的「Office 格式」演练点名的就是 core 包里的 `engineFor` switch，只声明本包 glob 会漏掉这条跨包依赖。

**过渡期豁免**（必须带到期里程碑，到期未清即 CI 失败）：

```json
{
  "exempt": [
    {
      "file": "src/tool/registry.ts",
      "reason": "115 个能力工具仍静态 import",
      "until": "M1"
    },
    {
      "file": "src/plugin/index.ts",
      "reason": "内置认证插件仍直接 import",
      "until": "M2"
    }
  ]
}
```

上一版这里的第三条 `src/config/config.ts`（"仍读取 Extension 目录"）已删：实测它对 `capability` 的**运行时**依赖为 0，而门禁会把「一条债务都没盖到的豁免」判为失败项（理由见下），留着只会让 CI 红。它读 Extension 目录这件事仍然真实存在，但那是 §13 迁移章节的问题，不是 B1 的问题。

豁免之外还有一份**逐条边界的基线** `test/architecture/kernel-boundary.baseline.json`（`file -> specifier` 的集合）。原因：`exempt` 按文件粒度放行，一旦 `src/tool/registry.ts` 被豁免，在同一文件里新加一条能力 import 门禁看不见。基线把粒度压到「边」：

- 基线里没有的违规 → **新增违规**，CI 失败。
- 基线里有、代码里已经不再有 → **陈旧基线**，CI 失败（防止有人偷偷删条目而不是删依赖）。
- 豁免到期（`until` 里程碑 ≤ 当前 `milestone`）→ 失败。
- 豁免没盖到任何一条实际违规 → 失败。
- `kernel`/`shared`/`capability` 里匹配不到任何文件的 glob（**死 glob**）→ 失败。
- `packages/plugin-api` 里出现任何运行时 npm/宿主 import（`Bun.*`、`process.*`、非相对 import）→ 失败，即 §2.2 规则 1 的机器化。

实测结果与债务分布见附录 G。

这条豁免机制是必要的：如果 M0 一上线就让全量边界测试变红，团队第一件事就是把它关掉。豁免把「已知债务」变成「有到期日的债务」，基线保证它只会单向收窄。

**这份清单是渐进收窄的**：M0 只纳入已经干净的文件，每个里程碑把新迁出的能力从 `kernel` 移到 `capability`。清单本身就是进度表。

### 2.4 内核只保留核心工具

Agent Loop 的语义依赖它们，迁出去会让「插件坏了连读文件都不行」：

| 工具                                      | 为什么必须在内核                       |
| ----------------------------------------- | -------------------------------------- |
| `read` / `write` / `edit` / `apply_patch` | Agent 的产物就是文件                   |
| `glob` / `grep`                           | 上下文发现的基础                       |
| `bash`                                    | 执行环境入口（权限键同为 `bash`）      |
| `task` / `task_status`                    | 子代理是 Agent Loop 的一部分，不是能力 |
| `todowrite`                               | 计划语义                               |
| `question`                                | 人机交互通道                           |
| `skill` / `tool_search`                   | 能力发现机制本身                       |

其余全部可迁移。注意 `task` 保留，但「团队编排」「动态工作流」这类基于 `task` 的上层能力是插件。

---

## 3. 扩展点矩阵

18 个扩展点。每个都对应一个内核接口、一个注册表，前 14 个各有演练。后 4 个是宿主面能力——它们在现有 Claude 兼容 schema 里已经存在，迁移时不能丢。

super-agent 运行时（`docs/super-agent-plugin-design.md` §12.1）再增加 6 个：触发器、快速路径规则、路由策略、Worker 类型、监督规则、通知通道。它们走同一套 Manifest 与注册表，因此本文的 M0 地基必须先把注册表抽象做对，否则后面还要返工。

| #   | 扩展点       | 内核接口                                                | 现状                                    | 目标                     | 演练  |
| --- | ------------ | ------------------------------------------------------- | --------------------------------------- | ------------------------ | ----- |
| 1   | 工具         | `ToolRuntime.register`                                  | 静态 import                             | 注册表 + 命名空间        | D1    |
| 2   | Agent        | `AgentRegistry.register`                                | 写死在 `agent.ts`                       | 注册表                   | D2    |
| 3   | Skill        | `SkillRegistry`（目录索引）                             | 扩展目录扫描                            | 贡献声明 + 热刷新        | D2    |
| 4   | Command      | `CommandRegistry`                                       | config + 目录                           | 注册表                   | D2    |
| 5   | Provider     | `ProviderRegistry.register`                             | 3000 行主文件                           | 适配器 + 注册表          | D3    |
| 6   | Office 引擎  | `OfficeRegistry.registerEngine`                         | `engineFor` switch                      | 注册表                   | D4    |
| 7   | 文件预览器   | `PreviewRegistry.register`                              | `file-tabs.tsx` 分发                    | 注册表                   | D4/D6 |
| 8   | 发布驱动     | `PublishRegistry.registerDriver`                        | 两份真相                                | 注册表 + 单一能力源      | D5    |
| 9   | 侧栏导航     | `SurfaceRegistry.registerSlot("sidebar.item")`          | `layout.tsx` 硬编码                     | Slot                     | D6    |
| 10  | 整页视图     | `SurfaceRegistry.registerView`                          | `app.tsx` 路由                          | 注册表 + 通用路由        | D6    |
| 11  | 设置分组     | `SurfaceRegistry.registerSlot("settings.section")`      | `settings-runtime.tsx`                  | Slot                     | D6    |
| 12  | 工具结果渲染 | `SurfaceRegistry.registerSlot("message.part.renderer")` | 硬编码                                  | Slot                     | D6    |
| 13  | 拦截器       | `InterceptorRuntime.register`                           | 现有 `Hooks`                            | 隔离 + 超时 + 熔断       | —     |
| 14  | 定时/事件源  | `SchedulerRegistry`、`EventSourceRegistry`              | `cron`、`monitor`、`subscribe`          | 注册表                   | —     |
| 15  | MCP Server   | `McpRegistry`                                           | `extension/schema.ts` 已有 `mcpServers` | 注册表 + 生命周期        | —     |
| 16  | 输出风格     | `OutputStyleRegistry`                                   | 同上 `outputStyles`                     | 注册表                   | —     |
| 17  | LSP Server   | `LspRegistry`                                           | 同上 `lspServers`                       | 注册表                   | —     |
| 18  | HTTP 路由    | `RouteRegistry`，强制前缀 `/plugin/<id>/`               | 散落在 server 路由                      | 注册表 + 前缀隔离（Q18） | —     |

前端不参与编译期拼装：所有 Surface 贡献通过 `GET /plugin/contributions?kind=...` 获取，由通用渲染器渲染。

---

## 4. 注册表设计

### 4.1 通用 ContributionRegistry

所有注册表共享同一套语义：

```ts
type ContributionKind =
  // ①–⑱ 本文 §3
  | "tool"
  | "agent"
  | "skill"
  | "command"
  | "provider"
  | "office-engine"
  | "previewer"
  | "publish-driver"
  | "surface"
  | "interceptor"
  | "mcp"
  | "output-style"
  | "scheduler"
  | "event-source"
  | "http-route"
  | "lsp"
  // ⑲–㉔ super-agent（docs/super-agent-plugin-design.md §12.1）
  | "trigger"
  | "fast-path"
  | "routing-policy"
  | "worker-type"
  | "watchdog-policy"
  | "channel"

interface Registry<T> {
  register(item: T): Disposable
  resolve(id: string): T | undefined
  list(): ReadonlyArray<T>
  onDidChange(fn: () => void): Disposable
}
```

统一行为：

- **命名**：外部插件默认 `plugin_local`；内置插件可声明 `global: true` 保留原名（见 §4.8）。
- **冲突**：不抛错，确定性地追加后缀并写诊断。
- **覆盖**：`scope` 优先级 `builtin < global < project < session`，其次 `priority`，最后插件 id 字典序。
- **释放**：`Disposable` 逆序释放；停用插件后 `list()` 立即变化。
- **通知**：`onDidChange` 驱动 UI 与模型工具列表刷新，不需要重启。

### 4.2 ToolRegistry

```ts
type ToolContribution = {
  id: string
  description: string
  /** plugin-api 里这个类型叫 `JSONSchema`：只声明用到的结构子集，不 import `@types/json-schema`——那是运行时之外的依赖（§2.2 规则 1）。 */
  parameters: JSONSchema7
  /** 与内核 TOOL_META 对齐；缺省按最保守值处理（见下表）。 */
  safety?: {
    readOnly?: boolean
    concurrencySafe?: boolean
    destructive?: boolean
    idempotent?: boolean
    maxResultBytes?: number
    deferLoading?: boolean
    searchHint?: string
    interrupt?: "cancel" | "abort"
  }
  execute(args: unknown, ctx: ToolExecutionContext): Promise<ToolResult>
}
```

`ToolExecutionContext` 上一版只出现在签名里、没有定义，而它恰好是最容易写错的一层——它**不是** `PluginContext`。补齐（与现有 `packages/plugin/src/tool.ts` 的 `ToolContext` 字段同名，迁移时作者无需改代码）：

```ts
/** 内核每次工具调用现构造，绑定到具体会话；不含插件自己的 API（http/secrets/storage 都在 PluginContext 上）。 */
type ToolExecutionContext = {
  sessionID: string
  messageID: string
  agent: string
  /** 当前会话的项目目录；解析相对路径优先用它，而不是 `process.cwd()`。 */
  directory: string
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void
  ask(input: PermissionAskInput): Promise<void>
}

type ToolResult =
  | string
  | { title?: string; output: string; metadata?: Record<string, unknown>; attachments?: ToolAttachment[] }

/** §5.2 `permissions.ask` 与这里的 `ask` 共用同一个入参，不另设类型。 */
type PermissionAskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata?: Record<string, unknown>
}
```

两条边界，都必须由适配层（`plugin/runtime/*`）承担，不许转嫁给插件作者：

1. **Effect → Promise。** 现有 `ToolContext.ask` 返回 `Effect.Effect<void>`，而 §5.1 规定 `PluginContext`「不能拿 Effect Service」——所以 plugin-api 侧的 `ask` 声明成 `Promise<void>`，在调用点 `Effect.runPromise`。同理 `directory`/`worktree` 传字符串而不是 `InstanceState` 句柄。
2. **两个 ctx 不许混。** `execute(args, ctx)` 的第二个参数是上面这个执行上下文，**没有** `ctx.http`；要用插件自己的 API，只能在 `activate(api)` 里闭包注入（附录 F 旧示例里的 `ctx.http.get` 把这层写成了一层，已改）。

**`safety` 不是可选的装饰**。现在 `tool/registry.ts` 的 `TOOL_META` 决定四件内核行为：权限判定、并行调度、结果截断、失败重试。插件工具不带这些元数据，就会出现「插件工具被当成只读并发执行，实际在写文件」这类事故。

缺省值取最保守：

| 字段              | 缺省     | 影响                            |
| ----------------- | -------- | ------------------------------- |
| `readOnly`        | `false`  | 为 `false` 时串行执行、需要权限 |
| `concurrencySafe` | `false`  | 同一轮内不与其他工具并行        |
| `destructive`     | `true`   | 权限弹窗、需要确认              |
| `idempotent`      | `false`  | 失败不自动重试                  |
| `maxResultBytes`  | `20_000` | 超出截断                        |
| `deferLoading`    | `false`  | 常驻工具块                      |

所以「工具能用」和「工具安全地混在现有调度里」是两件事，D1 必须同时断言：新工具出现在工具列表里，且**不带 `safety` 时按串行 + 需确认执行**。

内置插件在构建期从 TS 定义抽取 `safety`（§6.3），第三方手写；manifest 校验时对「`readOnly: true` 但声明了 `write` 类副作用名称」给出 warning，不阻断。

内核 `tool/registry.ts` 的变化：

| 现在                                | 目标                                         |
| ----------------------------------- | -------------------------------------------- |
| 62 条 import + 115 次 `Tool.init`   | 0 条能力 import；只保留 §2.4 的核心工具      |
| `filtered = allTools.filter(...)`   | 保留同样的过滤逻辑，但 `allTools` 来自注册表 |
| `toolOverrides[tool.id] === false`  | 保留，作为单工具开关，与插件启停并存         |
| `deferLoading` + `tool_search`      | 复用为插件惰性激活的一半（§6.3）             |
| `plugin.trigger("tool.definition")` | 保留                                         |

#### 4.2.1 工具列表必须确定性

工具块进的是系统提示，**顺序不稳定会直接击穿 provider 的 prompt 缓存**，每轮多付一次全量 prefill。规则：

1. 工具列表按 `(source priority desc, pluginID asc, tool id asc)` 排序，同一配置两次启动结果逐字节相同。
2. `capabilities.deferLoading` 的过滤在排序**之后**做，长尾工具的顺序同样确定。
3. `tool_search` 的索引与工具列表共用同一快照；搜索命中的新增工具按同一排序键追加，不插队。
4. 提示词里只出现最终名（`<pluginID>_<local>`），不出现来源信息。
5. CI 有 `test/architecture/tool-block-snapshot.test.ts`：固定插件集合 → 断言工具块文本快照；任何顺序变化都会让快照失败。

排序逻辑集中在一个函数 `orderContributions()`，所有注册表共用（§4.9），不允许各调用点自己 sort。

### 4.3 AgentRegistry

```ts
type AgentContribution = {
  id: string
  description: string
  mode: "primary" | "subagent"
  prompt: string | { file: string }
  tools?: string[]
  disallowedTools?: string[]
  permission?: PermissionConfig
  options?: { displayName?: string; category?: string; modeGroup?: string; scene?: string }
  model?: { providerID: string; modelID: string }
}
```

`agent.ts` 保留：`Agent.Service`、配置合并、权限合并、`builtin` 标记。移除：19 个内置 Agent 的字面量。

**工具允许列表的解析**：`tools: ["office_pptx"]` 在激活时按最终名匹配；插件改名（命名空间化）时，Agent 定义由同一个插件提供，因此两边一起变，不会有悬空引用。跨插件引用使用 `plugin:local` 形式，加载时展开。

### 4.4 ProviderRegistry（D3 的核心）

现状把三类东西混在 3112 行里：SDK 加载、模型目录、厂商怪癖。拆成适配器：

```ts
type ProviderAdapter = {
  id: string
  name: string
  sdk?: string | { package: string; factory: string }
  auth?: {
    type: "api" | "oauth" | "env"
    key?: string[]
    oauth?: OAuthSpec
  }
  models?: Record<string, ModelInfo> | (() => Promise<Record<string, ModelInfo>>)
  discoverModels?: (input: { apiKey: string; baseURL: string }) => Promise<Record<string, ModelInfo>>
  transform?: {
    languageModel?: (model: LanguageModelV3, options: Record<string, unknown>) => LanguageModelV3
    headers?: (input: { modelID: string; apiKey: string }) => Record<string, string>
    params?: (input: { modelID: string }) => Record<string, unknown>
  }
  options?: { baseURL?: string; requireZeroPricing?: boolean; freeTier?: boolean }
  quirks?: { toolChoice?: boolean; systemRole?: "system" | "developer"; reasoning?: boolean }
}
```

内核保留（`provider.ts` 收缩到约 600 行）：

- 配置合并、auth 读取、模型目录缓存、`CatalogUpdated` 事件
- SDK 动态加载与实例缓存
- 统一的 `list()` / `getModel()` / `getLanguageModel()`
- 免费模型过滤与健康检查

迁移映射：

| 现在                                                                                            | 目标                                                               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `BUNDLED_PROVIDERS` 二十多条                                                                    | 每个厂商一个 `ProviderAdapter`，放进 `builtin.providers`           |
| 85 处厂商分支                                                                                   | 收敛到 `transform` / `quirks` / `options` 三个字段                 |
| `plugin/codex.ts`、`azure.ts`、`poe.ts`、`cloudflare.ts`、`digitalocean.ts`、`github-copilot/*` | 转成 `auth` + `models` 适配器，仍在 `builtin.providers` 内按需激活 |
| `ENV_ONLY_PROVIDERS`                                                                            | `auth.type = "env"` + `auth.key` 列表                              |

验收：D3 新增 `acme` 只写一个适配器文件 + manifest 条目；`provider.ts` 的 diff 为空。

### 4.5 OfficeEngineRegistry（D4）

现状：

```ts
export function engineFor(format: OfficeFormat) {
  if (format === "docx") return docxEngine
  if (format === "pptx") return pptxEngine
  // ...
}
```

目标：

```ts
type OfficeEngineContribution = {
  format: string
  kind: "document" | "spreadsheet" | "presentation" | "pdf" | "richtext" | "plaintext"
  extensions: string[]
  aliases?: Record<string, string>
  readOnly?: boolean
  engine: OfficeEngine<unknown>
}
```

- `packages/core/src/office/engine/registry.ts` 变成注册表：`register` / `engineFor` / `officeFormatOf` / `kindOfPath`。
- 9 个内置引擎（docx / xlsx / pptx / pdf / csv / html / md / text / legacy）改为 `builtin.office-engines` 贡献。
- `extensions` 与 `aliases` 由贡献提供，因此 `.foo` 不需要改核心映射表。
- CLI（`cli/cmd/office.ts`）与 `document-export.ts` 通过注册表取引擎，代码不变。
- **App 端**：浏览器里不能直接用 Node 引擎注册表，因此 UI 通过 `GET /plugin/contributions?kind=office-engine` 拿 `{ format, extensions, aliases, kind }` 用于选择预览器；真正的解析与编辑仍走服务端 API。

### 4.6 PublishDriverRegistry（D5）

现状两份真相：

- 主进程：`desktop/src/main/platform/index.ts` 的 `platformRegistry`（7 个类）+ `publish/drivers.ts` 的 `DRIVERS`。
- 渲染层：`app/src/pages/pulse/publish-capabilities.ts` 的 `MATRIX`。

目标：

```ts
type PublishDriverContribution = {
  id: string
  name: string
  icon?: string
  hosts?: string[]
  supports: PublishKind[]
  urls: Partial<Record<PublishKind, string>>
  editorUrl?: (token: string) => string
  automation: PublishAutomationSpec
  account: { login: "oauth" | "qrcode" | "cookie"; profileFields: string[] }
  ui?: { accent?: string; docs?: string }
}
```

- 主进程注册表只保留 `getDriver(id)` 与 `listDrivers()`。
- 渲染层 `supportsPublish` 改为读取贡献的 `supports`，`MATRIX` 删除。
- 账号页的可添加平台列表来自贡献列表，不再来自 `getSupportedPlatforms()` 的硬编码返回。
- i18n：平台名由贡献提供，缺翻译时回退 `name`。

验收：D5 新增 `acme` 只写驱动 + manifest；`publish-capabilities.ts` 与 `platform/index.ts` 的 diff 为空。

### 4.7 SurfaceRegistry（D6）

UI 是「万物皆插件」最容易失守的地方。规则：

> **Web / 桌面端的界面贡献必须能从 HTTP 拉取，不能靠编译期 import。**

```ts
type SurfaceContribution =
  | {
      slot: "sidebar.item"
      id: string
      title: string
      icon: string
      accent?: string
      order?: number
      action: { type: "view"; viewId: string } | { type: "command"; command: string } | { type: "url"; url: string }
    }
  | {
      slot: "settings.section"
      id: string
      title: string
      description?: string
      view: { type: "declarative"; fields: SettingsField[] } | { type: "view"; viewId: string }
    }
  | {
      slot: "message.part.renderer"
      id: string
      match: { tool?: string; partType?: string }
      renderer: { type: "builtin"; id: string } | { type: "iframe"; url: string }
    }
  | {
      slot: "session.panel" | "statusbar.item" | "home.card" | "notification.item" | "composer.action"
      id: string
      title: string
      action: SurfaceAction
    }
```

注册表接口与贡献点一一对应：

```ts
interface SurfaceRegistry {
  registerSlot(item: SurfaceContribution): Disposable
  registerView(item: ViewContribution): Disposable
  list(input: { slot?: string; viewId?: string }): ReadonlyArray<SurfaceContribution | ViewContribution>
}

type ViewContribution = {
  viewId: string
  title: string
  /** 第一方：App 里已有的组件 id；第三方：iframe 地址。 */
  render: { type: "builtin"; component: string } | { type: "iframe"; url: string }
}
```

预览器单独一个 `PreviewRegistry`（见 §9.3），因为它有独立的匹配语义（扩展名 / 格式 / MIME），和 Slot 的渲染方式不同。

`SettingsField` 的形状（声明式渲染的最小集合）：

```ts
type SettingsField =
  | { key: string; type: "text" | "secret" | "number"; label: string; placeholder?: string }
  | { key: string; type: "boolean"; label: string; default?: boolean }
  | { key: string; type: "select"; label: string; options: string[]; default?: string }
  | { key: string; type: "list"; label: string; item: "text" | "secret" }
```

视图分三类：

| 类型         | 适用                           | 实现                                            |
| ------------ | ------------------------------ | ----------------------------------------------- |
| **声明式**   | 设置分组、简单列表与表单       | 内核渲染，插件只给字段定义                      |
| **内置视图** | 复杂界面（数据库、团队、运营） | 插件声明 `viewId`，App 里有对应组件，第一方专用 |
| **iframe**   | 第三方 UI                      | 沙箱 iframe + 版本化 postMessage                |

第三方默认只能声明式或 iframe；`viewId` 需要 App 侧存在同名组件，属于第一方白名单。

### 4.8 命名、冲突与覆盖

```ts
function resolveName(input: {
  pluginID: string
  localName: string
  global?: boolean
  reserved: ReadonlySet<string>
  taken: ReadonlySet<string>
}): { name: string; collision: boolean } {
  const local = sanitize(input.localName) // 小写，非 [a-z0-9_-] 转 _，首尾去 _，截断 48
  const base = input.global && !input.reserved.has(local) ? local : `${sanitize(input.pluginID)}_${local}`
  if (!input.taken.has(base)) return { name: base, collision: false }
  let index = 2
  while (input.taken.has(`${base}_${index}`)) index += 1
  return { name: `${base}_${index}`, collision: true }
}
```

- `reserved` 由内核启动时注入：内核 8 个工具 + 现有内置工具名，保证旧提示词不坏。
- 内置插件在迁移期内声明 `global: true`，保留 `office_pptx`、`browser_navigate` 等原名。
- 外部插件默认命名空间化。
- 冲突写 `contribution.collision` 诊断，并在 `/plugin/diagnostics` 展示。

覆盖规则：

1. `scope`：`builtin < global < project < session`
2. `priority`：数字大者优先，默认 0
3. 插件 id 字典序：小者优先，保证确定性

可覆盖：`agent`、`command`、`output-style`、`mcp`、`previewer`。
累加：`tool`、`skill`、`interceptor`、`scheduler`、`surface`。

---

### 4.9 顺序、依赖与卸载

贡献不是无序集合。任何「按注册顺序生效」的地方（同名覆盖、拦截器链、Slot 渲染、预览器匹配）都必须有确定顺序，否则同一份配置在两次启动里行为可能不同。

**排序键**（前一项相等才比较下一项）：

1. `priority` 降序（manifest 级，默认 0）
2. 安装顺序（`plugin_state.installed_at`；内置插件按 manifest 顺序）
3. 贡献 id 字典序

**覆盖语义**（D8）：

同名贡献只保留一个，胜出来源按 §10.5 的 scope 优先级，其次按上面的排序键。插件可以显式声明覆盖，避免「装了没反应」：

```jsonc
{
  "overrides": [
    "builtin.knowledge", // 覆盖该插件的全部贡献
    "builtin.knowledge:knowledge_search", // 或只覆盖其中一项
  ],
}
```

- 不含 `:` → 覆盖该插件的全部贡献；含 `:` → 只覆盖指定贡献。被覆盖的条目从注册表移除，未覆盖的条目照常生效。
- 原插件仍保持 `enabled`，状态额外标记 `overridden`（诊断页列出「被谁覆盖了哪几项」）。
- 覆盖者被停用/卸载后，原贡献**自动恢复**，无需重启。
- 覆盖内置插件需要在安装确认里显示「将替换 NovaWay 内置能力」，并列出具体条目。
- 不允许覆盖内核工具（§8.1.1 白名单）；尝试覆盖直接 `invalid`。

这样「第三方增强」和「第三方劫持」区分开：前者明确声明、可见、可撤销，后者因为名称命名空间（§4.8）默认不会发生。

**插件依赖**：manifest 的 `dependencies` 是硬依赖。

- 激活前做拓扑排序；有环 → 环上全部 `blocked`，错误信息列出环。
- 依赖未启用 → 被依赖方 `blocked`，**不自动启用**（避免「只想刷个工具，结果装进来 5 个插件」）。
- 依赖版本不满足 → `blocked`。
- 卸载被依赖方 → 拒绝；`force` 时级联停用依赖方。

**贡献级引用必须惰性解析**，不能在 `activate` 时硬取：

```ts
// 反例：插件 A 在 activate 时拿到插件 B 的工具对象
const bTool = ctx.tools.get("b_run")! // B 可能还没激活，或已被停用

// 正例：只存名字，调用点解析
await ctx.tools.call("b_run", input) // 未就绪返回 ToolUnavailable，由调用方降级
```

同理，Agent 的 `tools: ["b_run"]`、Surface 的 `command: "b.deploy"` 都只存名字。这样停用 B 只会让 A 返回明确的「能力不可用」，而不是激活期崩溃。

**卸载语义**：

| 动作                        | 贡献     | 数据                               | 定时器/监听                   |
| --------------------------- | -------- | ---------------------------------- | ----------------------------- |
| `disable`                   | 立即消失 | 保留                               | `dispose()` 后归零（B2 门禁） |
| `uninstall`                 | 消失     | 保留                               | 同上                          |
| `uninstall` + `purge: true` | 消失     | 删 `plugin_kv` / 插件表 / 数据目录 | 同上                          |

`dispose()` 没清干净的定时器，Host 在停用后统一 `unref()` 并在诊断里记 `leak`，不静默吞掉。

### 4.10 能力开关（`capabilities.*`）与插件启停统一

现状：`capabilities.has("question")`、`capabilities.browser`、`capabilities.pdf` 等开关决定工具是否注册（`tool/registry.ts` 里大量 `capabilities.has(...)`）。插件化之后，如果还保留两套开关，会出现「插件已停用但能力开关仍为真」的幽灵贡献。

规则：

| 层                                    | 语义             | 谁写            |
| ------------------------------------- | ---------------- | --------------- |
| 插件启停                              | 能力是否存在     | 用户 / 配置     |
| `plugins.config.<id>.enabled`         | 单个插件的开关   | 用户            |
| 旧 `capabilities.*`                   | **派生值**，只读 | Host 计算       |
| `plugins.overrides.<id>.capabilities` | 显式覆盖派生值   | 高级用户 / 迁移 |

- `capabilities.browser === true` 当且仅当 `builtin.browser` 处于 `active`。
- 旧配置里的 `capabilities: { browser: false }` 在迁移时转成 `plugins.config["builtin.browser"].enabled = false`，配置键保留但标注 deprecated。
- 工具过滤只读一遍：`session.capabilities` 是 Host 在会话开始时算好的快照，会话中途停用插件不会改变已开始会话的工具集（见 §4.11）。

这条是把「能力开关」从内核知识降级为插件状态的投影，否则 §2.2 的依赖方向永远会有漏洞。

### 4.11 快照与热更新语义

插件会在**对话进行中**被激活（`onTool`）或停用（用户点开关）。两者与正在跑的 Agent Loop 交互必须有确定答案，否则表现为偶发不一致。

| 时刻                               | 规则                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| 一轮请求组装时                     | 取当前代数（generation）的贡献快照，整轮使用；不中途变化                               |
| 轮内惰性激活（`tool_search` 命中） | 新工具追加到**下一轮**的工具块；当前轮已发出的请求不变                                 |
| 轮内停用                           | 立即从注册表移除，但当前轮已组装的工具列表不回收；调用已移除工具返回 `ToolUnavailable` |
| 轮结束后                           | 代数 +1，所有缓存（工具块、`tool_search` 索引、贡献列表）一起失效                      |
| UI                                 | 收到 `plugin.changed` SSE 后重新拉取；不需要重新加载页面                               |

```ts
type ContributionSnapshot = {
  generation: number
  tools: ReadonlyMap<string, ToolContribution>
  agents: ReadonlyMap<string, AgentContribution>
  // …
}
```

`session/prompt.ts` 只在轮开始时调用 `host.snapshot()` 一次，其余地方读快照，不读活注册表。这条约束让「插件热启停」和「prompt 缓存」可以同时成立。

### 4.12 其余贡献点的类型定义

§4.2–§4.7 只详述了有演练的六个注册表。其余贡献点同样要有明确契约，否则实现时会各写各的。

```ts
// Skill：目录索引，不执行代码
type SkillContribution = {
  id: string
  /** SKILL.md 路径或内联内容 */
  source: { file: string } | { text: string }
  /** 触发条件（写进系统提示的 description） */
  description: string
  allowedTools?: string[]
  metadata?: Record<string, string>
}

// Command：斜杠命令
type CommandContribution = {
  id: string
  description: string
  /** 模板正文；支持 $ARGUMENTS / $1..$9 */
  template: string
  argumentHint?: string
  /** 执行前拦截器可改写 */
  model?: string
  agent?: string
  subtask?: boolean
}

// Interceptor：与生命周期 Hook 严格分开（Q3）
type InterceptorRegistration = {
  id: string
  hook:
    | "chat.message"
    | "chat.params"
    | "chat.headers"
    | "tool.definition"
    | "tool.execute.before"
    | "tool.execute.after"
    | "permission.ask"
    | "command.execute.before"
    | "shell.env"
    | "event"
  handler: (input: unknown, output: unknown) => void | Promise<void>
  /** 可选：只对某些工具/命令生效，减少无关调用 */
  filter?: { tool?: string[]; agent?: string[] }
}

// MCP Server：沿用现有 extension/schema.ts 的形状
type McpServerContribution = {
  id: string
  type: "local" | "remote"
  command?: string[] // local
  url?: string // remote
  env?: Record<string, string>
  headers?: Record<string, string>
  /** 该 MCP 提供的工具是否默认进初始工具块 */
  eager?: boolean
}

// Output style：系统提示的输出风格段
type OutputStyleContribution = {
  id: string
  name: string
  source: { file: string } | { text: string }
}

// LSP：语言服务器
type LspServerContribution = {
  id: string
  languages: string[]
  command: string[]
  rootPatterns?: string[]
  initializationOptions?: unknown
  /** 诊断是否进上下文 */
  diagnostics?: "off" | "on-save" | "always"
}

// Scheduler：可被插件注册的定时器（与 super-agent 的 timer 触发器共用实现）
type SchedulerContribution = {
  id: string
  /** cron 表达式或固定间隔 */
  schedule: { cron: string } | { everyMs: number }
  timezone?: string
  run: (ctx: SchedulerContext) => Promise<void>
  /** 是否在错过后补跑 */
  catchUp?: boolean
}

// Event source：把外部信号转成总线事件
type EventSourceContribution = {
  id: string
  kind: "fs" | "webhook" | "poll" | "custom"
  config?: JSONSchema7
  start(emit: (event: { type: string; properties: unknown }) => void): Promise<Disposable>
}

// HTTP route：强制前缀，避免命名空间冲突（Q18）
type HttpRouteContribution = {
  id: string
  method: "GET" | "POST" | "PUT" | "DELETE"
  /** 相对路径，宿主自动加 /plugin/<pluginID> 前缀 */
  path: string
  handler: (req: PluginHttpRequest) => Promise<PluginHttpResponse>
  /** 是否要求已登录用户 */
  auth?: "none" | "session"
}
```

两条通用约束：

1. **所有 `run` / `handler` / `start` 都受 §10.3 的超时与熔断约束**，包括 `scheduler.run`——否则一个卡住的定时任务会拖垮调度器。
2. **所有贡献都必须能 `dispose`**：`start()` 返回 `Disposable`，`register()` 返回 `Disposable`；停用插件时按注册逆序释放（§4.9）。

---

## 5. PluginContext API

### 5.1 两层 API

| API               | 谁用                           | 原则                                                            |
| ----------------- | ------------------------------ | --------------------------------------------------------------- |
| **KernelApi**     | 第一方插件（`scope: builtin`） | 可以操作会话、调度、LLM、后台任务；等价于「内核内部模块」       |
| **PluginContext** | 第三方插件                     | 只暴露窄接口 + DTO；不能拿 Effect Service、数据库句柄、内部模块 |

两层共用同一形状的前半部分（tools/agents/commands/storage/secrets/log），第一方额外多出宿主机能力。这样第一方代码迁移时不用改写法，只换类型。

### 5.2 KernelApi

```ts
interface KernelApi {
  readonly id: string
  readonly scope: "builtin" | "global" | "project" | "session"

  // 注册表
  readonly tools: Registry<ToolContribution>
  readonly agents: Registry<AgentContribution>
  readonly skills: Registry<SkillContribution>
  readonly commands: Registry<CommandContribution>
  readonly providers: Registry<ProviderAdapter>
  readonly office: Registry<OfficeEngineContribution>
  readonly publish: Registry<PublishDriverContribution>
  readonly surfaces: Registry<SurfaceContribution>
  readonly interceptors: Registry<InterceptorRegistration>
  readonly schedulers: Registry<SchedulerContribution>
  readonly eventSources: Registry<EventSourceContribution>

  // 会话
  readonly sessions: {
    create(input: { title?: string; parentID?: string; agent?: string }): Promise<SessionHandle>
    prompt(input: { sessionID: string; text: string; agent?: string; model?: ModelRef }): Promise<PromptResult>
    messages(sessionID: string): Promise<MessageDto[]>
    abort(sessionID: string): Promise<void>
  }

  // 工具
  readonly toolRuntime: {
    execute(input: { tool: string; args: unknown; sessionID: string; agent: string }): Promise<ToolResult>
    list(input?: { sessionID?: string }): Promise<ToolInfo[]>
  }

  // LLM
  readonly llm: {
    stream(input: { model: ModelRef; messages: MessageDto[]; system?: string[] }): AsyncIterable<Chunk>
    complete(input: { model: ModelRef; messages: MessageDto[]; system?: string[] }): Promise<string>
  }

  // 后台与调度
  readonly background: {
    start(input: { type: string; title?: string; run: (signal: AbortSignal) => Promise<string> }): Promise<JobHandle>
    cancel(jobID: string): Promise<void>
    list(): Promise<JobInfo[]>
  }
  readonly scheduler: {
    every(ms: number, fn: () => Promise<void>): Disposable
    cron(expr: string, fn: () => Promise<void>): Disposable
  }

  // 事件
  readonly events: {
    on(event: string, handler: (payload: unknown) => void): Disposable
    emit(event: string, payload: unknown): void
  }

  // 基础设施
  readonly storage: PluginStorage
  readonly files: { read(path: string): Promise<string>; write(path: string, data: string): Promise<void> }
  readonly http: HttpClient
  readonly secrets: SecretStore
  readonly config: ConfigSlice
  readonly permissions: { ask(input: PermissionAskInput): Promise<void> }
  readonly log: Logger
  readonly signal: AbortSignal
}
```

**`KernelApi` 只有 11 个注册表字段，比 §3 的 18 个扩展点少 4 类，这是刻意的。** `mcp` / `output-style` / `lsp` / `http-route`（§3 的 #15–18）各自有内核侧注册表（`McpRegistry` 等），但不暴露成插件可写的 `Registry` 字段：它们的唯一消费者是宿主自己（MCP 客户端、输出风格渲染、LSP 客户端、路由挂载），插件用 manifest 声明（§7.4）就够了；`/mcp` 这类「列出已声明的」需求由贡献索引（§6.5）只读提供。将来真需要代码注册时再加字段——加码不破坏（§5.5 的同一条原则）。

**注册表字段名与 manifest 键名故意不一致**：API 用短名 `office` / `publish`，manifest 与贡献点全集用长名 `officeEngines` / `publishDrivers`（§7.4）。映射表只存在于 `plugin/host.ts` 一处，作者要记的是「manifest 写长名，代码用短名」。

### 5.3 PluginContext（第三方）

在 KernelApi 基础上删掉：`sessions`、`llm`、`toolRuntime`、`background` 的 `run`、`events.emit`、`config.write`、`files` 的任意路径写。

保留：

```ts
interface PluginContext {
  readonly id: string
  readonly scope: "global" | "project" | "session"

  readonly tools: Registry<ToolContribution>
  readonly agents: Registry<AgentContribution>
  readonly commands: Registry<CommandContribution>
  readonly skills: Registry<SkillContribution>
  readonly interceptors: Registry<InterceptorRegistration>

  readonly storage: PluginStorage
  readonly secrets: SecretStore
  readonly http: HttpClient
  readonly log: Logger
  readonly signal: AbortSignal

  // 未开放时调用给出明确错误，而不是 undefined
  readonly providers: RestrictedRegistry<ProviderAdapter>
  readonly surfaces: RestrictedRegistry<SurfaceContribution>
}
```

`RestrictedRegistry.register()` 抛 `PluginError("capability_denied")`，错误信息写清「该贡献点当前只对内置插件开放」。注意用的是 `capability_denied` 而非 `permission_denied`：§5.5 的错误码集合里没有 `permission_denied` 这一项，「未授权想碰某个 API/贡献点」与「manifest 未声明 capability」在宿主侧走同一套策略（提示改 manifest），不必分成两个码。

### 5.4 能力检查在调用点

- `ctx.storage`：写入时校验 namespace 属于当前插件。
- `ctx.http`：请求前按 `capabilities.network` 白名单校验主机。
- `ctx.secrets`：只允许读取 `capabilities.secrets` 列出的 key。
- `ctx.files`：按 `capabilities.fs` 校验路径（`plugin-data` / `workspace-read` / `workspace-write`）。
- `ctx.tools.execute`（第一方）：按 `capabilities.tools` allowlist 校验。

**未声明即拒绝**，错误信息包含缺哪个 capability，便于插件作者修 manifest。

### 5.5 错误模型

现在插件错误是散落的字符串与裸 `Error`。宿主要对失败做策略（停用、熔断、降级、回滚），就必须能**分类**错误，而不是解析文本。

```ts
type PluginError = Error & {
  code:
    | "capability_denied" // 越权调用：未声明 capability 或碰了只对内置开放的贡献点，含缺失项名
    | "api_version" // apiVersion 不支持
    | "activation_failed" // activate() 抛错，含原始堆栈
    | "contribution_invalid" // 注册的贡献不合法（重复 id、非法 viewId…）
    | "tool_unavailable" // 调用了已停用插件的能力
    | "timeout" // 拦截器/激活超时
    | "circuit_open" // 熔断中
    | "storage_conflict" // KV namespace 越权
    | "transport" // L1 子进程崩溃 / 协议错误
  pluginID?: string
  contributionID?: string
  retryable?: boolean
}
```

规则：

- 宿主对 `PluginError` 做策略，对未知错误按 `activation_failed` 处理。
- `tool_unavailable` 是**正常路径**（§4.9），调用方必须处理，不算插件故障，不触发熔断。
- 所有错误进 `plugin_state.last_error` 与诊断事件，用户可见的是人话（「Acme 插件需要网络权限 api.example.com」），不是堆栈。
- 错误码是 `plugin-api` 的一部分，与 `apiVersion` 一起演进；加码不删码。

---

## 6. 惰性激活

### 6.1 为什么必须有

「万物皆插件」意味着内置插件会从 0 个变成 15 个以上。如果全部 eager 激活、全部 import，启动会明显变慢，内存也会上涨。参照 VS Code 的做法：**声明是 eager 的，代码是 lazy 的**。

- Manifest 解析、贡献索引：启动时完成，不执行插件代码。
- 插件模块 `import()` 与 `activate()`：由 `activationEvents` 触发。

### 6.2 事件类型

```jsonc
{
  "activationEvents": [
    "onStartup",
    "onTool:weather",
    "onCommand:deploy",
    "onProvider:acme",
    "onView:pulse.dashboard",
    "onPreview:.foo",
    "onSessionStart",
    "onEvent:session.idle",
  ],
}
```

| 事件              | 触发点                              | 典型插件                           |
| ----------------- | ----------------------------------- | ---------------------------------- |
| `onStartup`       | 内核启动                            | 拦截器、基础设施类                 |
| `onTool:<id>`     | 模型请求该工具 / `tool_search` 命中 | 大多数能力工具                     |
| `onCommand:<id>`  | 用户执行命令                        | 命令类插件                         |
| `onProvider:<id>` | 请求该厂商模型 / 打开配置页         | `builtin.providers` 内的单个适配器 |
| `onView:<id>`     | 打开该视图                          | 数据库、团队、运营                 |
| `onPreview:<ext>` | 打开该扩展名文件                    | Office 引擎、预览器                |
| `onSessionStart`  | 新会话创建                          | 记忆注入、上下文类                 |
| `onEvent:<name>`  | 总线事件                            | 监听类插件                         |

未声明 `activationEvents` 的插件按 `onStartup` 处理（兼容旧插件）。

### 6.3 与现有 deferLoading / tool_search 的关系

现有机制解决的是「工具 schema 占 token」，新机制解决的是「插件代码占启动时间」。两者互补：

| 阶段     | 机制                                        | 效果                       |
| -------- | ------------------------------------------- | -------------------------- |
| 请求组装 | `capabilities.deferLoading` + `tool_search` | 长尾工具不进初始工具块     |
| 插件加载 | `activationEvents`                          | 插件模块不进初始 import 图 |

具体做法：

- 工具贡献在 manifest 里必须能给出 `description` 与 `parameters`（JSON Schema），否则视为 eager。
- 内置插件允许在构建期生成 manifest（`script/gen-plugin-manifest.ts` 从 TS 定义抽取工具 schema），避免手写两份。
- 第三方插件如果无法内联 schema，则标记 eager，并在诊断里提示「该插件会拖慢启动」。

### 6.4 性能预算

| 指标                                | 目标                                                    |
| ----------------------------------- | ------------------------------------------------------- |
| 20 个插件、仅解析 manifest          | < 120ms                                                 |
| 20 个插件全部 `onStartup` 激活      | < 400ms                                                 |
| 单个插件激活                        | < 50ms（P95）                                           |
| 首次 `onTool` 触发的激活 + 首次调用 | < 300ms                                                 |
| 停用插件后的残留                    | 0 个定时器、0 个监听器（用 `why-is-node-running` 校验） |

**UI 端预算**（§6.4 只有后端，D6/D9 依赖前端表现）：

| 指标                                            | 目标                                           |
| ----------------------------------------------- | ---------------------------------------------- |
| 启动后首次 `/plugin/contributions` 到 rail 可点 | < 500ms（本地服务），期间显示骨架项            |
| 停用插件到 rail 图标消失（SSE → 重渲染）        | < 300ms                                        |
| 贡献接口未就绪时的降级                          | 只渲染基础项，不白屏、不报错；就绪后一次性补全 |
| App 不因插件接口失败而阻塞                      | 接口 3s 超时后永久降级，本轮不再重试           |

### 6.5 贡献索引缓存

「声明 eager、代码 lazy」的前提是：解析 manifest 足够快。15 个内置插件 + 若干第三方，每次启动都读 JSON、校验 Schema、算名称，冷启动会吃掉预算的一半。

做法：

- 缓存文件 `~/.novaway/cache/plugin-index.json`（桌面端放 userData）。
- 键是 `(manifest 路径, mtime, size, apiVersion, hostVersion)` 的哈希；任一变化即失效。
- 缓存内容只含**解析结果**（贡献索引、最终名、`activationEvents`），不含模块代码与函数。
- 缓存损坏或版本不匹配时静默重建，不报错。
- 首次启动（无缓存）允许慢一次；之后 `discover` 目标是 < 30ms。

`shadow` 模式下新旧索引都建，但缓存只写 v2 的，避免两套格式互相覆盖。

### 6.6 可观测性

没有观测的插件体系，「为什么我的会话变慢了」永远查不出来。三个层面：

**指标**（Host 内建，零配置）：

| 指标                                      | 类型      | 用途                                       |
| ----------------------------------------- | --------- | ------------------------------------------ |
| `plugin.activate.duration_ms{plugin}`     | histogram | 激活耗时（P95 对应 §6.4 预算）             |
| `plugin.hook.duration_ms{plugin,hook}`    | histogram | 拦截器耗时                                 |
| `plugin.hook.failures_total{plugin,hook}` | counter   | 熔断依据的原始数据                         |
| `plugin.tool.calls_total{tool}`           | counter   | 能力使用统计（停用不用的插件有依据）       |
| `plugin.activation.reason{plugin,reason}` | counter   | `onTool` 触发频率，校准 `activationEvents` |
| `plugin.snapshot.generation`              | gauge     | 代数推进是否正常                           |

**日志**：插件日志带 `pluginID` 前缀进宿主日志流；`ctx.log` 默认 info，`NOVAWAY_PLUGIN_LOG=<id>=debug` 可按插件开 debug，不用重启。

**追踪**：会话 trace 里，插件拦截器与插件工具调用是独立 span，能看到「这一轮里哪个插件吃了多少毫秒」。诊断页直接消费这些数据，不做第二套采集。

---

## 7. Manifest（v2）

### 7.1 文件与发现

文件名顺序：`.claude-plugin/plugin.json` → `plugin.json` → `extension.json` → `manifest.json`。

目录顺序（低 → 高）：

1. 内置插件目录（随包分发）
2. `~/.novaway/extensions`、`~/.novaway/plugins`
3. `<config>/extensions`、`<config>/plugins`、`<config>/marketplace`
4. `~/.claude/plugins`
5. `<project>/.novaway/extensions`、`<project>/.novaway/plugins`
6. `<worktree>/.novaway/extensions`
7. `<project>/.claude/plugins`

### 7.2 字段

| 字段               | 必填               | 说明                                                                                 |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------ |
| `name`             | 是                 | 插件 id，小写字母/数字/`-`/`_`                                                       |
| `version`          | 否                 | semver                                                                               |
| `apiVersion`       | 是（旧插件缺省 1） | 宿主 API 版本                                                                        |
| `engines.novaway`  | 否                 | 宿主版本范围                                                                         |
| `kind`             | 否                 | `declarative` / `code` / `mixed`                                                     |
| `main`             | 代码型必填         | 入口模块，默认导出 `activate`                                                        |
| `activationEvents` | 否                 | 惰性激活事件                                                                         |
| `dependencies`     | 否                 | 插件 id → 版本范围；硬依赖，拓扑激活（§4.9）                                         |
| `capabilities`     | 否                 | 权限声明                                                                             |
| `contributes`      | 是                 | 贡献点                                                                               |
| `priority`         | 否                 | 覆盖优先级，默认 0                                                                   |
| `overrides`        | 否                 | 显式覆盖：`builtin.knowledge`（全部）或 `builtin.knowledge:knowledge_search`（单项） |
| `categories`       | 否                 | 市场分类标签                                                                         |
| `license`          | 否                 | `spdx` 表达式；市场分发必填                                                          |
| `legacy`           | 否                 | 加载器写入，作者不写                                                                 |

### 7.3 市场与发布（安装到运行的最后一公里）

前面所有设计都假定「插件已经在磁盘上」。市场补上从发现到安装这一段：

| 环节 | 设计                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 索引 | `registry.novaway.dev` 返回 `[{ name, version, license, capabilities 摘要, downloads }]`；客户端缓存 24h |
| 安装 | 复用现有 `extension/marketplace.ts` 的 zip/git 通道；安装记录 `.novaway-install.json` 保留               |
| 校验 | 安装后校验 manifest Schema；`apiVersion` 不支持 → 安装成功但 `blocked`，说明写清楚                       |
| 更新 | 启动时检查更新 → 提示，不自动装；`apiVersion` 变化必须用户确认                                           |
| 审计 | 发布时静态扫描：`Bun.*`、`process.exit`、`eval`、通配 network；结果展示在详情页                          |
| 下架 | 版本不可变；下架只挡新安装，已装继续可用（避免「删库」式伤害）                                           |

市场不是本改造的验收对象（D1–D9 都不依赖它），但市场展示的字段全部来自 manifest，**manifest 里没有的字段市场不许编**——这是防止「两套真相」在分发侧复活。

### 7.4 contributes 完整结构

```jsonc
{
  "tools": [{ "id": "weather", "entry": "./tools/weather.js", "description": "…", "parameters": { "type": "object" } }],
  "agents": ["./agents"],
  "skills": ["./skills"],
  "commands": ["./commands"],
  "interceptors": "./interceptors.js",
  "lifecycleHooks": "./hooks/hooks.json",
  "mcpServers": { "my-mcp": { "type": "local", "command": ["node", "server.js"] } },
  "outputStyles": "./output-styles",
  "lspServers": "./lsp.json",
  "httpRoutes": [{ "method": "POST", "path": "/run", "entry": "./routes/run.js" }],
  "providers": ["./providers/acme.js"],
  "officeEngines": [{ "format": "foo", "extensions": ["foo"], "kind": "document", "entry": "./engines/foo.js" }],
  "publishDrivers": ["./drivers/acme.js"],
  "previewers": [{ "id": "foo", "match": { "extension": ".foo" }, "viewId": "foo.preview" }],
  "surfaces": [
    {
      "slot": "sidebar.item",
      "id": "acme",
      "title": "Acme",
      "icon": "globe",
      "order": 50,
      "action": { "type": "view", "viewId": "acme.dashboard" },
    },
  ],
  "storage": { "namespace": "acme", "migrations": "./migrations" },
}
```

### 7.5 最小可用插件（只加文件，不改内核）

```
my-plugin/
├── plugin.json
├── tools/weather.js
├── agents/reviewer.md
├── skills/weather/SKILL.md
├── commands/forecast.md
└── surfaces.json
```

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "apiVersion": 2,
  "main": "./index.js",
  "activationEvents": ["onTool:my_plugin_weather", "onView:my-plugin.dashboard"],
  "capabilities": { "fs": ["plugin-data"], "network": ["api.example.com"] },
  "contributes": {
    "tools": [{ "id": "weather", "entry": "./tools/weather.js", "description": "Get weather", "parameters": {} }],
    "agents": ["./agents"],
    "skills": ["./skills"],
    "commands": ["./commands"],
    "surfaces": [
      {
        "slot": "sidebar.item",
        "id": "weather",
        "title": "Weather",
        "icon": "globe",
        "action": { "type": "view", "viewId": "my-plugin.dashboard" }
      }
    ]
  }
}
```

---

## 8. 内置能力拆分地图

### 8.1 留在内核的最小集

| 类别       | 内容                                           | 理由             |
| ---------- | ---------------------------------------------- | ---------------- |
| 会话与消息 | Session、Message、Part、压缩、摘要             | 数据结构本身     |
| Agent Loop | `session/prompt.ts`、工具调度、流式输出        | 执行语义         |
| 工具运行时 | `tool/tool.ts`、`tool/registry.ts`、权限、截断 | 执行与安全       |
| 核心工具   | 13 个，见 §8.1.1                               | 满足引导依赖判据 |
| 存储与总线 | SQLite、迁移器、Bus                            | 一致性           |
| 配置合并   | `config/config.ts`                             | 全局不变量       |
| LLM 传输   | `packages/llm`、Provider 注册表骨架            | 协议层           |
| 插件运行时 | PluginHost、注册表、拦截器运行时               | 本设计新增       |

#### 8.1.1 内核工具的判据

只有同时满足下面三条，才能留在内核：

1. **引导依赖**：插件加载、注册、诊断本身要用到它（读文件、执行命令、列目录）。
2. **执行语义**：它实现的是 Agent Loop 的一部分（子会话、计划、交互提问），不是某个领域能力。
3. **稳定性契约**：所有插件与提示词都依赖它的返回值格式，必须在内核升级间保持行为不变。

当前白名单 13 个：`read`、`write`、`edit`、`apply_patch`、`glob`、`grep`、`bash`、`task`、`task_status`、`todowrite`、`question`、`skill`、`tool_search`。

`webfetch`、`websearch`、`browser`、`computer`、`memory`、`knowledge`、`database`、`office` 都不满足第 1 条——它们是「用网络/存储/文件格式做事」的领域能力，全部下沉为插件。

新增内核工具需要：RFC + 在 `kernel.manifest.json` 里登记理由 + 更新白名单。评审只问一句：**「去掉它，插件还能不能装进来？」** 不能，才留下。

### 8.2 转成第一方插件的清单

| 插件 id                      | 现有文件                                                                                                                          | 需要的 Kernel API                            | 风险                      | 里程碑 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------- | ------ |
| `builtin.office`             | `tool/office-doc.ts`、`office-pptx.ts`、`office-setup.ts`、`office/*`、`skill/prompt/office-*`、`agent.ts` 里的 9 个 office Agent | tools、agents、skills、files、storage        | 中：提示词与技能耦合      | M2     |
| `builtin.office-engines`     | `core/src/office/engine/{docx,xlsx,pptx}.ts`、`csv/`、`pdf/`、`rich/`、`text/`、`legacy/`                                         | office 注册表                                | 中：app 与 CLI 共用       | M2     |
| `builtin.providers`          | `plugin/{codex,azure,poe,cloudflare,digitalocean,github-copilot}`、`provider.ts` 的厂商分支                                       | providers、secrets、http、llm                | 高：20+ 厂商行为差异      | M2     |
| `builtin.browser`            | `tool/browser.ts`、`tool/webview.ts`、`browser/*`、`platform-webview`                                                             | tools、surfaces、permissions                 | 中：桌面壳能力依赖        | M4     |
| `builtin.computer`           | `tool/computer.ts`、`computer/*`                                                                                                  | tools、permissions                           | 低                        | M4     |
| `builtin.media`              | `tool/generate_image.ts`、`generate_video.ts`、`generate_narration.ts`                                                            | tools、providers（判断能力可用）             | 低                        | M4     |
| `builtin.memory`             | `tool/memory*.ts`、`memory/*`、`evolution/*`                                                                                      | tools、storage、sessions、events             | 中：与 prompt 注入耦合    | M3     |
| `builtin.knowledge`          | `tool/knowledge*.ts`、`knowledge/*`                                                                                               | tools、storage、files                        | 低                        | M3     |
| `builtin.database`           | `tool/database.ts`、`database/*`                                                                                                  | tools、storage、secrets                      | 低                        | M3     |
| `builtin.team`               | `tool/task-tools.ts`、`team-run.ts`、`team/*`、`agent/agency.ts`                                                                  | tools、sessions、agents、storage、background | 高：并发与权限            | M4     |
| `builtin.workflow`           | `tool/workflow*.ts`、`dynamic-workflow/*`、`workflow/*`、`orchestrator/*`                                                         | tools、sessions、storage、background         | 高                        | M4     |
| `builtin.schedule`           | `tool/cron.ts`、`monitor.ts`、`subscribe.ts`、`cron/*`、`background/*`                                                            | tools、scheduler、background、events         | 中                        | M3     |
| `builtin.integrations`       | `tool/repo_clone.ts`、`repo_overview.ts`、`lsp*.ts`、`mcp-setup.ts`、`skill-install.ts`                                           | tools、files、http                           | 低                        | M4     |
| `builtin.publish`            | `desktop/src/main/platform/**`、`app/src/pages/pulse/**`                                                                          | publish、surfaces、storage、secrets          | 高：Electron 与渲染层双端 | M4     |
| `builtin.ui`（或各插件自带） | `layout.tsx` 的 railItems、`settings-runtime.tsx` 的分节、`file-tabs.tsx` 的预览分发                                              | surfaces、previewers                         | 中                        | M4     |

迁移原则：

1. **代码先搬家，不改逻辑。** 先让行为一致地跑在插件容器里，再优化。
2. **一个能力一个里程碑，不要一次性全搬。** 每个插件独立开关，出问题只回退一个。
3. **提示词是契约。** 迁移时工具名、技能名、Agent 名保持不变（`global: true`），否则模型行为会变。
4. **跨插件依赖显式化。** 例如 `builtin.office` 依赖 `builtin.office-engines`，用 manifest `dependencies` 声明。
5. **第一方插件是独立的 workspace 包。** 目录 `packages/plugins/<id>/`，各自 `package.json`，只依赖 `@novaway/plugin-api` 和自己的 npm 依赖；`packages/novaway` 只保留宿主与构建期生成的 manifest。禁止把插件源码放回 `packages/novaway/src`（§0.4 最后一条）。

### 8.3 拆分顺序

```
M2  providers ──► office-engines ──► office        （纯后端，验证 Provider 与引擎注册表）
M3  schedule ──► knowledge ──► database ──► memory （有存储与事件，但无 UI）
M4  browser ──► computer ──► media ──► integrations ──► team ──► workflow ──► publish ──► ui
```

理由：

- Provider 与 Office 引擎的接口最清晰，先证明「第一方也走插件」可行。
- 团队与工作流依赖后端调度能力最多，放后面，避免过早暴露过多 KernelApi。
- UI 最后做，因为需要先有稳定的贡献发现接口。

---

## 9. UI 插件模型

### 9.1 贡献发现必须走 HTTP

现在 App 通过编译期 import 认识能力（`officeFormatOf`、`getSupportedPlatforms`、`railItems`）。目标：

```
GET /plugin/contributions?kind=tool|agent|office-engine|publish-driver|surface|previewer
GET /plugin/contributions?slot=sidebar.item
GET /plugin/views                      # 插件视图清单
POST /plugin/views/:id/render         # 声明式视图取数据
```

App 启动时拉一次，之后用 `/plugin/events` 的 SSE 增量刷新。这样停用插件后 UI 立即变化，不需要重新构建前端。

### 9.2 Slot 目录

| Slot                    | 宿主位置                                  | 渲染方式               | 演练 |
| ----------------------- | ----------------------------------------- | ---------------------- | ---- |
| `sidebar.item`          | `app/src/pages/layout.tsx` 的 `railItems` | 声明式                 | D6   |
| `sidebar.footer`        | 同上 `railFooter`                         | 声明式                 | —    |
| `settings.section`      | `app/src/components/settings-runtime.tsx` | 声明式 / viewId        | D6   |
| `view`（整页）          | `app/src/app.tsx` 的路由                  | viewId + 通用容器      | D6   |
| `session.panel`         | `session-side-panel.tsx` 的标签页         | 声明式 / iframe        | —    |
| `message.part.renderer` | 消息渲染器                                | 内置渲染器 id / iframe | D6   |
| `file.previewer`        | `file-tabs.tsx`                           | viewId                 | D4   |
| `composer.action`       | `prompt-input.tsx`                        | 声明式按钮             | —    |
| `statusbar.item`        | 状态栏                                    | 声明式                 | —    |
| `home.card`             | 首页                                      | 声明式 / viewId        | —    |
| `notification.item`     | 通知中心                                  | 声明式                 | —    |

### 9.3 预览器注册表（D4）

现状：`file-tabs.tsx` 里按扩展名和 `officeFormatOf` 分发到 `DocxFilePreview`、`PptxFilePreview`、`XlsxFilePreview`、`OfficeFilePreview`、`RichFilePreview`。

目标：

```ts
type PreviewContribution = {
  id: string
  match: { extension?: string[]; format?: string[]; mime?: string[] }
  viewId: string
  priority?: number
  readOnly?: boolean
}
```

`file-tabs.tsx` 只保留一个通用预览容器：根据 `previewer` 贡献找到 `viewId`，再渲染对应组件或 iframe。Office 格式的 `viewId` 由 `builtin.office` 提供。

### 9.4 侧栏 rail（D6）

```json
{
  "slot": "sidebar.item",
  "id": "database",
  "title": "数据",
  "icon": "database",
  "accent": "var(--icon-blue)",
  "order": 30,
  "action": { "type": "view", "viewId": "builtin.database.page" }
}
```

`layout.tsx` 的 `railItems` 改为「内置基础项 + 贡献项」合并排序：

- 基础项（新建任务、设置）保留在 App 里。
- 其余全部来自贡献，按 `order` 排序。
- `active` 状态由当前 `viewId` 计算，不再每个页面手写 `state.xxxPage.open`。

### 9.5 设置分组（D6）

```json
{
  "slot": "settings.section",
  "id": "acme",
  "title": "Acme",
  "description": "Acme 平台的连接与偏好",
  "view": {
    "type": "declarative",
    "fields": [
      { "key": "apiKey", "type": "secret", "label": "API Key" },
      { "key": "region", "type": "select", "label": "区域", "options": ["cn", "us"] }
    ]
  }
}
```

声明式字段由内核渲染并写入插件配置命名空间（`plugins.config.<pluginID>`），插件通过 `ctx.config.get("apiKey")` 读取。复杂设置可以给 `viewId`，走第一方视图。

### 9.6 发布平台 UI 由驱动派生（D5）

- 账号页的可添加平台：`GET /plugin/contributions?kind=publish-driver`。
- 能力矩阵：每项发布的可用平台由驱动 `supports` 计算，`publish-capabilities.ts` 删除。
- 图标与配色：驱动 `icon` / `ui.accent`；缺省用通用图标。
- i18n：驱动 `name` 作为默认名，有翻译则覆盖。

### 9.7 TUI 对齐

TUI 已有 `feature-plugins/*`（12 个内置）与 Slot 机制，是 Web 端的先行验证。目标：

- Slot 名称与 Web 一致（`sidebar.item`、`statusbar.item` 等）。
- 同一份 Manifest 的 `surfaces` 贡献，TUI 只渲染它支持的 Slot，其余忽略并记录 info。
- `ui.tui` 代码入口保留，用于复杂自定义渲染。

### 9.8 第三方 UI 的边界

| 级别     | 形式                   | 限制                                                           |
| -------- | ---------------------- | -------------------------------------------------------------- |
| 声明式   | JSON 字段 + 内置渲染器 | 无自定义样式；不能执行脚本                                     |
| iframe   | 沙箱页面 + postMessage | 无 DOM/Node 访问；只能调用白名单 API（读配置、调工具、读存储） |
| 内置视图 | `viewId`               | 第一方白名单，第三方不可注册                                   |

postMessage 协议版本化：`{ v: 1, type: "tool.invoke", payload: {...} }`，宿主侧校验来源与能力。

### 9.9 插件管理界面（插件体系的第一个消费者）

插件管理页自己就该走贡献接口，作为「这套体系是否自洽」的现场验证：

- 列表：`GET /plugin`（状态、版本、来源、scope、最近错误）
- 详情：贡献清单（该插件注册了哪些工具/Agent/Surface）、权限、激活耗时
- 操作：启用 / 停用 / 卸载 / `purge`，全部走 Host API；停用即时生效（D9）
- 诊断：错误码（§5.5）+ 人话解释 + 「缺哪个 capability」的一键修复入口

管理页显示的每一项都来自 Host 数据，**不允许前端内置任何插件知识**——包括内置插件的名字。如果实现时想写 `if (name === "builtin.office")`，那就是 B1 违规。

**为什么不做 ESM 联邦**（这是取舍，不是遗漏）：Solid 的响应式依赖模块单例，宿主与插件各打包一份 `solid-js` 会导致 signal 跨实例失效，`solid-js/web` 的渲染器也无法跨实例复用。绕过它要把 `importmap` 指向宿主产物，而版本偏移、CSP、桌面端 `file://` 协议都会变成长期维护负担。所以第一方视图留在 App 包里，但**注册、启用、路由、可见性全部由贡献驱动**——这就是 D6 的通过标准。第三方要复杂 UI 用 iframe，表达能力足够。

---

## 10. 生命周期与故障隔离

### 10.1 状态机

```
discovered ──parse──► invalid
    │
    └──validate──► blocked（apiVersion / engines / 依赖）
    │
    └──resolve──► installed ──activate──► activating ──► active
                                                │           │
                                                ▼           ▼
                                             failed      degraded
    disabled ◄── 用户停用        uninstalled ◄── 卸载
```

### 10.2 加载阶段

| 阶段       | 做什么                                            | 失败后果                     |
| ---------- | ------------------------------------------------- | ---------------------------- |
| `discover` | 扫描目录、读取 `config.plugin`、读取市场记录      | 记录 `invalid`，继续其他插件 |
| `parse`    | 读取 Manifest、归一化旧字段、索引贡献             | `invalid`                    |
| `validate` | Schema、名字、路径、`apiVersion`、`engines`、依赖 | `blocked`                    |
| `resolve`  | npm/git/本地目标、依赖安装                        | `blocked`                    |
| `activate` | 执行迁移、调用 `activate(ctx)`、注册贡献          | `failed`，逆序回滚已注册贡献 |
| `health`   | `healthCheck()` 可选                              | `degraded`                   |

**依赖顺序**：依赖插件先激活；检测到环时全部 `blocked` 并给出环路径。
**确定性**：同 scope、同 priority 按插件 id 字典序。

### 10.3 拦截器运行时

每个拦截器独立执行：`try/catch` + 超时 + 熔断。任何失败返回原 output，不冒泡。

| Hook                                            | 超时        | 失败策略                     |
| ----------------------------------------------- | ----------- | ---------------------------- |
| `chat.message` / `chat.params` / `chat.headers` | 2s          | 保留原值                     |
| `permission.ask`                                | 2s          | 用内核默认判定               |
| `tool.execute.before`                           | 2s          | 拒绝本次工具调用（安全优先） |
| `tool.execute.after`                            | 5s          | 保留原结果                   |
| `tool.definition` / `command.execute.before`    | 2s          | 使用原定义                   |
| `shell.env`                                     | 1s          | 使用原 env                   |
| `event`                                         | 500ms，异步 | 丢弃，不阻塞                 |
| `hook`（生命周期）                              | 2s          | `deny` 类保持原判定          |

熔断：同一 `(plugin, hook)` 连续失败 3 次 → 跳过 60s；10 分钟内失败 10 次 → 插件 `degraded`，除 `event` 外全部跳过。

### 10.4 内置插件失败时的降级（D7 的反面）

这是「万物皆插件」必须回答的问题：**如果 `builtin.office` 挂了，NovaWay 还能用吗？**

| 故障                                 | 期望行为                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `builtin.office` 激活失败            | office 工具、office Agent、office Skill、office 预览器一起缺席；文件仍可当纯文本/未知格式处理；会话与代码能力不受影响 |
| `builtin.providers` 中某个适配器失败 | 该厂商不出现在列表；其他厂商正常；已保存的配置不丢                                                                    |
| `builtin.publish` 失败               | 运营页显示「发布能力不可用」；其他工作台正常                                                                          |
| `builtin.ui` 失败                    | rail 少了对应图标；基础导航仍在                                                                                       |
| 第三方插件失败                       | 只影响它自己的贡献；诊断页可见；不影响内置                                                                            |

实现要求：

- 每个贡献在注册时绑定 `pluginID`；停用/失败时按 `pluginID` 批量释放。
- UI 渲染空列表而不是抛错；组件缺失时显示占位卡并给出诊断链接。
- 工具名引用（Agent 的 `tools`、提示词里的工具名）在插件缺席时静默过滤，不报错。

### 10.5 激活作用域

插件有 `scope`：`builtin` / `global` / `project` / `session`。语义必须明确，否则 server 多项目场景会出现「A 项目装了插件，B 项目也生效」。

| scope     | 来源                         | 激活范围            | 停用方式 |
| --------- | ---------------------------- | ------------------- | -------- |
| `builtin` | 随包分发                     | 全局，进程级        | 全局     |
| `global`  | `~/.novaway/*`、npm          | 全局                | 全局     |
| `project` | `<project>/.novaway/*`       | 该项目及其 worktree | 项目级   |
| `session` | 运行时注入（测试、临时插件） | 单会话              | 会话结束 |

- 同名插件在多个 scope 出现时，**高优先级 scope 覆盖低优先级**：`session > project > global > builtin`（与 VS Code 一致）。
- 覆盖是整体替换，不做字段合并——合并会让「为什么我的配置没生效」变成常态问题。
- 被覆盖的插件状态为 `overridden`，诊断页展示「被 <路径> 覆盖」，不重复激活。
- server 的插件目录按 workspace 缓存，项目切换不重启进程。

### 10.6 默认状态、安全模式与紧急开关

这一节回答「升级之后用户会看到什么」。改默认值比改代码更容易造成事故。

| 场景                  | 行为                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 从旧版本升级          | 全部内置插件 `enabled: true`；旧 `config.plugin` / Extension 自动转为安装实例并保持原启用状态                             |
| 全新安装              | 同上；`builtin.office`、`builtin.providers` 默认启用，`builtin.browser` / `builtin.computer` 跟随原 `capabilities` 默认值 |
| 首次启动              | 后台建索引缓存；UI 不阻塞等待                                                                                             |
| 插件反复失败          | 3 次激活失败后自动 `disabled`，诊断页与通知各提示一次，不循环重试                                                         |
| `NOVAWAY_SAFE_MODE=1` | 跳过所有非内置插件；内置插件只加载内核必需（`builtin.providers`），其余 `disabled`                                        |
| `NOVAWAY_PLUGINS=off` | 只有内核工具与基础 UI；用于确认「卡顿是不是插件造成的」                                                                   |
| 升级后大面积报错      | 设置页一键「回到安全模式」，写入 `plugins.safeMode = true`                                                                |

安全模式必须能在**不修改任何文件**的情况下启动，否则用户没法自救。

### 10.7 会话内权限（一层不能省的确认）

工具级权限已有 `permission.ask` 拦截器；插件引入了一个新问题：**「允许 Acme 读取工作区」这类确认，用户批准的对象是插件而不是单次调用**。否则每轮对话弹十次窗，用户会全部无脑允许——比不弹更糟。

| 层     | 粒度                                          | 记忆                          |
| ------ | --------------------------------------------- | ----------------------------- |
| 会话级 | 本会话内该插件的某类操作（读工作区 / 调网络） | 会话结束失效                  |
| 全局级 | 该插件的某类操作永久允许                      | 写 `plugin_state.permissions` |
| 单次   | 默认；不记得                                  | —                             |

- 确认框展示的是**声明的 capability 与实际调用的交集**，插件不能借一次确认拿到声明之外的东西（调用点检查仍然生效，§5.4）。
- 全局级批准在设置页可撤销；撤销后代数 +1（§4.11），正在进行的会话按快照继续。
- 拒绝 3 次 → 会话内自动拒绝后续同类请求并提示，避免插件反复弹窗。

---

## 11. 权限与信任

### 11.1 capability

```jsonc
{
  "capabilities": {
    "fs": ["plugin-data", "workspace-read", "workspace-write"],
    "network": ["api.example.com", "*.githubusercontent.com"],
    "shell": false,
    "process": ["spawn"],
    "secrets": ["acme-token"],
    "tools": ["read", "grep"],
    "ui": ["sidebar.item", "settings.section"],
  },
}
```

未声明即拒绝。错误信息写清缺哪个 capability。

### 11.2 信任级别

| 级别 | 适用                             | 执行                       | 权限强制           |
| ---- | -------------------------------- | -------------------------- | ------------------ |
| L0   | 内置插件、纯声明式、用户显式信任 | 进程内                     | 声明 + 调用点检查  |
| L1   | 市场第三方代码插件               | 子进程 / Worker + JSON-RPC | 宿主侧 allowlist   |
| L2   | 第三方 UI                        | iframe                     | postMessage 白名单 |

本期落地 L0。L1 与 L2 只定义接口，不实现——但接口现在就要定，因为它决定了「第三方插件能不能拿到 Node 能力」这个安全边界。

```ts
/** L1：第三方代码插件在子进程/Worker 里跑，宿主通过它通信。 */
interface PluginTransport {
  /** 启动子进程；宿主传入 manifest 路径与权限清单 */
  start(input: { entry: string; capabilities: Capabilities }): Promise<void>
  /** 请求/响应：宿主 → 插件 */
  call(input: { method: string; params: unknown; timeoutMs: number }): Promise<unknown>
  /** 推送：插件 → 宿主（事件、贡献注册） */
  onNotify(handler: (msg: { method: string; params: unknown }) => void): Disposable
  /** 优雅停止，超时后 kill */
  stop(input?: { timeoutMs?: number }): Promise<void>
  /** 存活探测；崩溃后由 Host 决定重启或标记 failed */
  ping(): Promise<boolean>
}
```

L1 的三条硬约束：

| 约束                                            | 原因                             |
| ----------------------------------------------- | -------------------------------- |
| 插件进程**不能**直接访问宿主 DB、文件系统、网络 | 否则 capability 声明形同虚设     |
| 所有调用走 JSON-RPC，宿主侧做 allowlist 校验    | 权限检查必须在宿主，不能在插件   |
| 崩溃必须可检测（心跳 + 退出码）                 | 否则 UI 显示「运行中」但实际已死 |

L2（第三方 UI）的协议见 §9.8。

### 11.3 安装确认

展示来源、版本、`apiVersion`、权限清单、是否含可执行代码、风险提示（`shell: true`、`network: ["*"]`、`secrets`）。`shell: true` 或通配网络需要二次确认。

---

## 12. 存储与配置

### 12.1 表

```sql
CREATE TABLE plugin_state (
  plugin_id      TEXT NOT NULL,
  scope          TEXT NOT NULL,          -- builtin / global / project / session
  source         TEXT NOT NULL,
  root           TEXT,
  version        TEXT,
  fingerprint    TEXT,                   -- 内容哈希；变化 → 重算贡献
  enabled        INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'installed',
                    -- discovered/installed/active/degraded/blocked/failed/disabled/overridden/uninstalled
  install_order  INTEGER,                -- 排序键第 2 位（§4.9）
  overrides      TEXT,                   -- JSON 数组
  permissions    TEXT,                   -- 已批准的会话内/全局权限（§10.7）
  last_error     TEXT,                   -- JSON: { code, message, at }（§5.5）
  activated_at   INTEGER,
  installed_at   INTEGER,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, scope)
);
CREATE INDEX idx_plugin_state_status ON plugin_state(status);

CREATE TABLE plugin_kv (
  plugin_id      TEXT NOT NULL,
  namespace      TEXT NOT NULL DEFAULT 'default',
  key            TEXT NOT NULL,
  value          TEXT NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, namespace, key)
);

CREATE TABLE plugin_migration (
  plugin_id      TEXT NOT NULL,
  namespace      TEXT NOT NULL,
  version        INTEGER NOT NULL,
  applied_at     INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, namespace, version)
);
```

主键从 `plugin_id` 变为 `(plugin_id, scope)`，因为同一插件可以同时以 global 和 project 两个实例存在（§10.5），它们的启停、错误、权限互相独立。所有查询按 `(scope, project?)` 过滤；`session` scope 的行不落库，只在内存。

迁移文件：`packages/novaway/migration/20261105000001_plugin_host/migration.sql`。

### 12.2 插件迁移

- Manifest `contributes.storage.migrations` 指向目录，文件名 `001_init.sql`。
- 激活前按顺序执行，记录到 `plugin_migration`。
- 插件表名强制前缀 `plugin_<id>_`。
- 失败 → 插件 `failed`，不激活。

### 12.3 配置命名空间

```jsonc
{
  "plugins": {
    "disabled": ["noisy-plugin"],
    "config": {
      "acme": { "apiKey": "…", "region": "cn" },
    },
    "overrides": { "acme": { "priority": 10 } },
  },
}
```

- `plugins.config.<id>` 由声明式设置写入，插件通过 `ctx.config` 读取。
- 密钥类字段写入 secrets 存储，不落 `novaway.json`。
- 旧 `config.plugin` 继续作为安装来源。

---

## 13. 兼容与迁移

### 13.1 适配器

| 旧输入                                        | 适配器                 | 行为                                                                |
| --------------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `config.plugin` spec                          | `legacy-config-plugin` | 解析为安装实例；模块返回的 `Hooks` → 拦截器                         |
| 旧 Extension Manifest                         | `legacy-extension`     | 补 `apiVersion=1`、`kind`，字段别名映射                             |
| 旧 `Hooks`（含 `tool` / `auth` / `provider`） | `legacy-hooks`         | `tool` → 工具贡献；`auth`/`provider` → Provider 贡献；其余 → 拦截器 |
| 旧 TUI Plugin                                 | `legacy-tui`           | `ui.tui` 贡献                                                       |
| `hooks.json`                                  | `lifecycle-hooks`      | 继续由 `Hook.Service` 执行                                          |
| `extensions.json` 的 `disabled`               | 启动迁移               | 导入 `plugin_state.enabled`                                         |

### 13.2 三种运行模式

```jsonc
{ "plugins": { "mode": "legacy" | "shadow" | "v2" } }
```

| 模式     | 行为                                 | 用途           |
| -------- | ------------------------------------ | -------------- |
| `legacy` | 旧机制照常，新 Host 只做旁路发现     | 默认值，灰度期 |
| `shadow` | 新旧同时加载，新旧结果对比，以旧为准 | 验证迁移正确性 |
| `v2`     | 只走 Host                            | 迁移完成后     |

`shadow` 模式的价值：迁移 `builtin.providers` 时，可以同时跑旧分支与新适配器，对比模型列表与请求参数，避免静默行为差异。

### 13.3 弃用时间表

| 版本 | 动作                                                   |
| ---- | ------------------------------------------------------ |
| 1.16 | Host 上线，`legacy` 默认；`/extension` 标记 deprecated |
| 1.17 | `shadow` 默认；设置页只展示 Host 数据                  |
| 1.18 | `v2` 默认；删除 `Extension.Service` 写接口             |
| 1.19 | 删除旧 `/extension` 写接口；旧 Manifest 只读兼容       |
| 2.0  | 要求显式 `apiVersion`；移除旧 `Hooks` 直接返回         |

### 13.4 迁移风险

| 风险                   | 对策                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| 工具改名破坏提示词     | 内置插件 `global: true` 保留原名；迁移期生成别名表；诊断 warning |
| Hook 顺序变化          | 默认保持现有加载顺序；`priority` 仅在显式设置时生效              |
| 启停后缓存不一致       | 统一 `Generation.bump()`；所有缓存监听同一代数                   |
| 旧插件 import 内部模块 | 兼容层保留旧导出路径；诊断给出明确错误                           |
| Bun/Node 差异          | 插件 API 不依赖 Bun-only；CI 双运行时 smoke test                 |

### 13.5 升级、回滚与灰度

模式开关只解决「新旧并存」，不解决「怎么把用户从 A 带到 B」。补充发布纪律：

| 阶段   | 版本  | 默认模式 | 回滚动作                                        |
| ------ | ----- | -------- | ----------------------------------------------- |
| 灰度 1 | 1.16  | `legacy` | 关闭 `plugins.enabled`，无数据迁移              |
| 灰度 2 | 1.17  | `shadow` | 同上；对比日志保留最近 7 天                     |
| 切换   | 1.18  | `v2`     | 单插件 `enabled: false` 或全局 `mode: "legacy"` |
| 收口   | 1.19+ | `v2`     | 仅支持单插件停用                                |

**回滚必须是无损的**：

- 迁移只**新增** `plugin_state` / `plugin_kv`，不改旧表。
- 旧 `config.plugin`、`extensions.json`、`hooks.json` 原样保留到 1.19；Host 只读不写。
- 降级安装旧版本时，新表被忽略，旧配置仍然可用。
- 每个里程碑给一次 `mode: "legacy"` 的回归跑（B3 的一部分），保证回滚路径全年可用。

**灰度判据**（每个内置插件独立看）：

| 指标                   | 通过线           |
| ---------------------- | ---------------- |
| 激活失败率             | < 0.1%           |
| 注入前后工具块差异     | 仅预期的名称变化 |
| 会话首 token 延迟变化  | < +10%           |
| 用户主动停用后重新启用 | 无报错           |

---

## 14. 里程碑（以演练通过为准）

假设 2 名全栈工程师 + 1 名兼职评审。每个里程碑结束都必须通过 B3 回归门禁。

### M0｜内核与运行时地基（2 周）

产出：

- `plugin/manifest.ts`：v2 Schema + 旧字段归一化
- `plugin/host.ts`：发现、校验、状态机、激活/停用
- `plugin/contributions/*`：tool / agent / skill / command 四个注册表
- `plugin/runtime/`：拦截器隔离、超时、熔断
- `plugin/state.sql.ts` + 迁移
- `GET /plugin`、`GET /plugin/contributions`、`GET /plugin/diagnostics`
- `kernel.manifest.json` + 边界测试（先纳入已干净的内核文件）

通过条件：

- 旧 npm 插件、旧 Extension、TUI 插件都出现在 `/plugin` 列表
- 抛错/超时的拦截器不影响对话
- 现有测试全绿

**本里程碑不改变任何用户可见行为。**

### M1｜后端贡献点切换（3 周）

产出：

- `tool/registry.ts` 改为从注册表取工具（13 个内核工具仍内联，见 §8.1.1）
- `agent/agent.ts` 改为从注册表取 Agent
- `skill/index.ts`、`command/index.ts` 改为贡献目录
- `config/config.ts` 接入 Host
- `plugin_install` 改为调用 Host

通过演练：**D1、D2**。B1 边界测试扩展到 `tool/registry.ts`、`agent/agent.ts`。

### M2｜Provider 与 Office 引擎（3 周）

产出：

- `ProviderRegistry` + `ProviderAdapter` 契约
- `provider.ts` 收缩；`builtin.providers` 迁移 6 个认证插件与 20+ SDK 适配器
- `OfficeEngineRegistry`；9 个引擎改为贡献
- `shadow` 模式：新旧 Provider 列表与请求参数对比

通过演练：**D3**；**D4 的后端一半**（格式识别、读写 API、CLI）。

### M3｜后端能力插件化（3 周）

产出：

- `builtin.schedule`（cron / monitor / subscribe）
- `builtin.knowledge`、`builtin.database`、`builtin.memory`
- `SchedulerRegistry`、`EventSourceRegistry`
- 这些插件的 storage 迁移与 KV 读写

通过条件：

- 逐个停用上述插件，对应工具消失、会话不报错（D7 部分通过）
- 启动时间不因插件数量线性增长（惰性激活生效）

### M4｜UI 与发布（4 周）

产出：

- `GET /plugin/contributions?slot=...`、`GET /plugin/views`、SSE 刷新
- `SurfaceRegistry`：`sidebar.item`、`settings.section`、`view`、`message.part.renderer`
- 预览器注册表；`file-tabs.tsx` 改为通用容器
- `PublishDriverRegistry`；`publish-capabilities.ts` 删除
- `builtin.publish`、`builtin.office` 的 UI 部分
- `builtin.office` 完成剩余 Agent / Skill

通过演练：**D4、D5、D6**。

### M5｜全量内置插件化（4 周）

产出：

- `builtin.browser`、`builtin.computer`、`builtin.media`、`builtin.integrations`
- `builtin.team`、`builtin.workflow`
- 全部 rail 图标、设置分组由贡献提供
- `v2` 模式成为默认；`legacy` 仅保留一个版本
- **边界判定改为目录约束**：`src/kernel/**`、`src/plugin-api/**`、`src/shared/**` 之外不得被内核 import；`kernel.manifest.json` 降级为目录列表的说明文件（Q16）
- 第一方插件全部迁到 `packages/plugins/<id>/`，`packages/novaway/src` 里不再残留能力实现（Q17）

通过演练：**D7 全量**；**B1 全量**；**B2 性能门禁**。

### 里程碑与演练对应

| 演练                   | M0   | M1   | M2   | M3   | M4   | M5  |
| ---------------------- | ---- | ---- | ---- | ---- | ---- | --- |
| D1 工具                |      | ✅   |      |      |      |     |
| D2 Agent/Skill/Command |      | ✅   |      |      |      |     |
| D3 Provider            |      |      | ✅   |      |      |     |
| D4 Office 格式+预览    |      |      | 后端 |      | ✅   |     |
| D5 发布平台            |      |      |      |      | ✅   |     |
| D6 界面入口            |      |      |      |      | ✅   |     |
| D7 停用内置插件        |      |      |      | 部分 |      | ✅  |
| D8 覆盖内置贡献        |      |      |      | ✅   |      |     |
| D9 热停用（不重启）    |      | 后端 |      |      | UI   |     |
| B1 依赖方向            | 骨架 | 扩展 | 扩展 | 扩展 | 扩展 | ✅  |
| B2 性能                |      |      |      | 观察 | 观察 | ✅  |

### 14.1 每个里程碑的完成定义（DoD）

里程碑「完成」不看代码写完，看下面五条全绿。少一条都算没完成。

1. **演练**：本节表格里该里程碑对应的 D 项在 CI 里通过（§15.1）。
2. **边界**：`bun test test/architecture/kernel-boundary.test.ts` 通过，且该里程碑新增的内核文件已登记。
3. **回归**：`bun lint && bun typecheck && bun test packages/novaway` 全绿；`packages/app` 构建通过。
4. **可回滚**：`plugins.mode = legacy` 下行为与上一个发布版本一致（快照对比）。
5. **文档**：`docs/plugin-authoring.md` 与 manifest schema 同步更新；`/plugin/diagnostics` 能列出本里程碑新增的贡献类型。

### 14.2 验收总命令

```bash
bun run verify:plugins
# = kernel-boundary + drill:D1..D9 + contracts + perf + leak

bun run verify:all
# = verify:plugins + verify:superagent（S1–S8、G1–G3）
```

`verify:plugins` 是唯一的验收入口。任何人问「现在算不算万物皆插件」，跑这一条，不看文档、不看代码结构。

### 14.3 M0 拆解（可直接开工）

M0 是唯一「零用户可见变化但决定后面全部成败」的阶段。按下面的顺序做，每一步都有独立可验证的产物：

| #   | 任务                                                                    | 完成判定                                                                        |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | `packages/plugin-api`：`definePlugin` / `defineTool` / 全部贡献类型     | 一个纯 JS fixture 插件能通过 `tsc --noEmit`；包内无运行时 import                |
| 2   | `kernel.manifest.json` v0 + `script/scan-boundary.ts`                   | 对现有代码跑一遍，输出当前违规清单（基线），写入文档附录                        |
| 3   | `plugin/manifest.ts`：v2 Schema + 旧字段归一化                          | 现存 `plugin.json` / Claude manifest / `config.plugin` 样本全部能解析成同一结构 |
| 4   | `plugin/host.ts`：发现 → 校验 → 状态机（不激活）                        | `/plugin` 能看到三套旧机制的实例，状态正确                                      |
| 5   | `plugin/contributions/*`：四个注册表 + `orderContributions()`           | 同名冲突、覆盖、排序的单测全绿                                                  |
| 6   | `plugin/runtime/hooks.ts`：隔离 / 超时 / 熔断 / 逆序释放                | 故障注入 8 项（§15.5）全部按预期降级                                            |
| 7   | `plugin_state` / `plugin_kv` / `plugin_migration` + 存储 + 配置命名空间 | 迁移可在空库与旧库上重复执行；插件 KV 越权写入被拒                              |
| 8   | `KernelApi` / `PluginContext` 构造器 + 能力检查                         | 同一个 fixture 在两种 ctx 下，受限 API 抛 `capability_denied`                   |
| 9   | `/plugin`、`/plugin/contributions`、`/plugin/diagnostics` + SSE         | 停用插件后 SSE 推 `plugin.changed`，前端无需刷新可重建列表                      |
| 10  | 三个兼容适配器（只读旁路）                                              | 旧插件、旧 Extension、TUI 插件的贡献都能在 `/plugin/contributions` 看到         |
| 11  | 索引缓存 + 启动性能基线                                                 | 20 个插件 `discover` < 30ms（有缓存）、< 120ms（无缓存）                        |
| 12  | `script/verify-plugins.ts` 串起 B1 + 故障注入 + 泄漏检测                | `bun run verify:plugins` 在 M0 结束时全绿（D1–D9 跳过并标记 known-red）         |

M0 明确**不做**：不切换任何调用点、不改 `tool/registry.ts`、不动 UI、不迁移任何内置能力。M0 的唯一产物是「一个能装插件但还没人用它的宿主」——这样 M1 出问题时，回滚只需要一个开关。

---

## 15. 测试策略

### 15.1 演练即测试

每个演练写成一个自动化测试，避免「文档说能做到，代码做不到」。

```ts
// packages/novaway/test/architecture/drill-tool.test.ts
test("D1: a new tool plugin is discoverable without touching the kernel", async () => {
  const dir = await tmpdir()
  await writePlugin(dir, {
    name: "drill-tool",
    apiVersion: 2,
    activationEvents: ["onTool:drill-tool_weather"],
    contributes: {
      tools: [{ id: "weather", entry: "./weather.js", description: "weather", parameters: {} }],
    },
  })
  await writeFile(
    path.join(dir, "weather.js"),
    `
    export default {
      async execute() { return { output: "sunny" } },
    }
  `,
  )

  const kernel = await bootTestKernel({ pluginDirs: [dir] })

  expect(await kernel.tools.list()).toContain("drill-tool_weather")
  expect(await kernel.tools.execute("drill-tool_weather", {}, ctx)).toEqual({ output: "sunny" })

  // 反向断言：内核文件没有引用这个插件
  expect(await kernel.importsOf("src/tool/registry.ts")).not.toContain("drill-tool")
})
```

同样的骨架覆盖 D2–D6。D8 断言「覆盖后提示词里只有一个同名工具、停用覆盖者后内置恢复」；D9 在会话进行中调用 `host.disable()`，断言当前轮不抛错、下一轮工具列表减少、重新启用后恢复。D7 是「停用后断言贡献消失 + 会话仍可用」。

D1 还要断言工具安全默认值：不带 `safety` 的插件工具在注册表里是 `readOnly: false`、`concurrencySafe: false`、`destructive: true`（§4.2），否则「能用」会掩盖「不安全地混进并行调度」。

演练的「禁止改动」不能只靠人看。每个演练在独立 git worktree 里跑，结束后断言：

```ts
const changed = (await $`git diff --name-only HEAD`.text()).trim().split("
").filter(Boolean)
expect(changed.filter((f) => FORBIDDEN[drill].some((p) => f.startsWith(p)))).toEqual([])
```

这样 §0.2 那张表就变成了 CI 里会红的断言，而不是评审时的口头承诺。

### 15.2 内核边界测试

```ts
test("B1: kernel does not import capabilities", async () => {
  const manifest = await loadKernelManifest()
  const violations = []
  for (const file of manifest.kernel) {
    for (const spec of await importsOf(file)) {
      if (matchesAny(spec, manifest.capability)) violations.push({ file, spec })
    }
  }
  expect(violations).toEqual([])
})
```

失败信息示例：

```
src/tool/registry.ts imports src/tool/office-doc.ts
→ office-doc 是能力，应改为 builtin.office 的贡献（见 docs/plugin-system-unification-design.md §8.2）
```

### 15.3 契约 fixture

```
test/fixture/plugin-tools/
test/fixture/plugin-agents/
test/fixture/plugin-skills/
test/fixture/plugin-commands/
test/fixture/plugin-provider/
test/fixture/plugin-office-engine/
test/fixture/plugin-publish-driver/
test/fixture/plugin-surface/
test/fixture/plugin-interceptor/
test/fixture/plugin-storage/
test/fixture/plugin-bad-manifest/
test/fixture/plugin-throwing-hook/
test/fixture/plugin-slow-hook/
```

每个 fixture 覆盖：安装 → 激活 → 贡献可见 → 停用 → 贡献消失 → 重载 → 贡献恢复。

### 15.4 性能与泄漏

| 测试     | 方法                                                         |
| -------- | ------------------------------------------------------------ |
| 启动开销 | 20 个 fixture 插件，测 `discover + activate` 耗时            |
| 每轮开销 | 10 个拦截器，测 `chat.params` 循环 1000 次                   |
| 残留     | 停用所有插件后，用 `why-is-node-running` 断言无定时器/监听器 |
| 内存     | 激活/停用 50 次，堆增长 < 20MB                               |

### 15.5 故障注入

- 插件 `activate` 抛错
- 拦截器永不返回
- 拦截器把 output 改成非法类型
- 插件目录中途被删除
- 安装过程断网
- 同名贡献并发注册
- Provider 适配器返回空模型列表
- UI 贡献指向不存在的 `viewId`

### 15.6 契约一致性套件

每个注册表配一份 conformance suite，任何新贡献类型、任何新插件（包括第一方）都要跑：

| 套件             | 断言                                                        |
| ---------------- | ----------------------------------------------------------- |
| `tool`           | 名称解析、`safety` 缺省值、参数校验、错误码、截断、并发标记 |
| `agent`          | 工具允许列表、权限合并、prompt 文件加载、`mode` 过滤        |
| `provider`       | 模型列表、鉴权方式、`transform` 调用顺序、错误映射          |
| `office-engine`  | 格式匹配、读写往返、错误码、路径解析                        |
| `publish-driver` | `supports` 计算、凭据校验、失败重试                         |
| `surface`        | Slot 合法性、`viewId` 是否存在、`order` 排序                |
| `interceptor`    | 超时、抛错、非法返回、熔断状态迁移                          |

套件的作用是让「第一方也走插件流程」变成可执行的约束：**第一方插件不能被豁免**。如果某个内置插件跑不过套件，说明内核接口还没抽象干净，先改接口再迁移。

### 15.7 双运行时

插件 API 不得依赖 Bun-only（`Bun.file`、`bun:sqlite` 直连）。CI 在 Node 22 下跑同一套 fixture；插件代码里出现 `Bun.` 直接判失败，第一方也不例外。

---

## 16. 文件级改造清单

### 16.1 新增

| 文件                                                    | 作用                                           | 里程碑 |
| ------------------------------------------------------- | ---------------------------------------------- | ------ |
| `packages/novaway/kernel.manifest.json`                 | 内核 / 能力 / 共享文件清单                     | M0     |
| `src/plugin/manifest.ts`                                | v2 Manifest Schema 与归一化                    | M0     |
| `src/plugin/host.ts`                                    | PluginHost 服务                                | M0     |
| `src/plugin/contributions/*.ts`                         | 各注册表实现                                   | M0–M4  |
| `src/plugin/runtime/hooks.ts`                           | 拦截器运行时（隔离/超时/熔断）                 | M0     |
| `src/plugin/runtime/disposable.ts`                      | 逆序释放                                       | M0     |
| `src/plugin/runtime/context.ts`                         | KernelApi / PluginContext 构造与能力检查       | M0     |
| `src/plugin/runtime/activation.ts`                      | activationEvents 惰性激活                      | M1     |
| `src/plugin/runtime/transport.ts`                       | L1 子进程接口（预留）                          | M5     |
| `src/plugin/storage.ts`                                 | KV、迁移执行                                   | M0     |
| `src/plugin/state.sql.ts`                               | Drizzle 表                                     | M0     |
| `src/plugin/diagnostics.ts`                             | 诊断聚合与事件                                 | M0     |
| `src/plugin/compat/*.ts`                                | 旧机制适配器                                   | M1     |
| `packages/plugins/<id>/`                                | 第一方插件（独立 workspace 包，见 Q17）        | M2–M5  |
| `packages/plugins/<id>/plugin.json`                     | 构建期由 `script/gen-plugin-manifest.ts` 生成  | M2–M5  |
| `packages/plugin-api/`                                  | 作者 API 与类型，无运行时依赖                  | M0     |
| `script/verify-plugins.ts`                              | `bun run verify:plugins` 入口                  | M0     |
| `packages/plugin-api/src/index.ts`                      | 作者 API（`definePlugin`、`defineTool`、类型） | M0     |
| `script/gen-plugin-manifest.ts`                         | 构建期抽取工具 schema                          | M1     |
| `src/server/routes/instance/httpapi/groups/plugin.ts`   | `/plugin` API                                  | M0     |
| `src/server/routes/instance/httpapi/handlers/plugin.ts` | handler                                        | M0     |
| `migration/20261105000001_plugin_host/migration.sql`    | 三张表                                         | M0     |
| `app/src/plugin/contributions.tsx`                      | 前端贡献拉取与缓存                             | M4     |
| `app/src/plugin/surface-renderer.tsx`                   | Slot 通用渲染                                  | M4     |
| `app/src/components/settings-plugins.tsx`               | 插件设置页                                     | M4     |
| `test/architecture/kernel-boundary.test.ts`             | B1                                             | M0     |
| `test/architecture/drill-*.test.ts`                     | D1–D9                                          | M1–M5  |

### 16.2 修改（按里程碑）

| 文件                                              | 改动                             | 里程碑 |
| ------------------------------------------------- | -------------------------------- | ------ |
| `src/tool/registry.ts`                            | 能力 import 全部移除，改为注册表 | M1     |
| `src/agent/agent.ts`                              | 19 个 Agent 字面量移出           | M1     |
| `src/skill/index.ts` / `src/command/index.ts`     | 改用贡献目录                     | M1     |
| `src/config/config.ts`                            | 接入 Host，新增 `plugins.*`      | M1     |
| `src/provider/provider.ts`                        | 收缩为注册表 + 通用加载          | M2     |
| `core/src/office/engine/registry.ts`              | `engineFor` 改为注册表           | M2     |
| `desktop/src/main/platform/index.ts`              | 平台类改为驱动贡献               | M4     |
| `app/src/pages/pulse/publish-capabilities.ts`     | 删除，改为读贡献                 | M4     |
| `app/src/pages/layout.tsx`                        | rail 改为内置基础项 + 贡献       | M4     |
| `app/src/app.tsx`                                 | 新增通用插件视图路由             | M4     |
| `app/src/pages/session/file-tabs.tsx`             | 预览分发改为注册表               | M4     |
| `app/src/components/settings-runtime.tsx`         | 设置分节改为 Slot                | M4     |
| `packages/tui/src/app.tsx`                        | 数据源改为 Host                  | M4     |
| `src/office/*`、`src/browser/*`、`src/computer/*` | 搬入插件目录                     | M5     |

### 16.3 退役

| 接口                                            | 时间 |
| ----------------------------------------------- | ---- |
| `Extension.Service` 写接口                      | 1.18 |
| `/extension` 写接口                             | 1.19 |
| `publish-capabilities.ts` 的 `MATRIX`           | M4   |
| `provider.ts` 的厂商分支                        | M2   |
| `office/engine/registry.ts` 的 `engineFor` 分支 | M2   |
| `layout.tsx` 的 `railItems` 硬编码              | M4   |

### 16.4 构建与打包

第一方插件要能被打进发行包，同时保持「像第三方一样安装」的加载路径。否则构建期又会出现隐藏耦合。

```
packages/plugins/office-engines/
├── package.json          # 依赖 @novaway/plugin-api（workspace:*）与自身 npm 依赖
├── src/index.ts          # export default definePlugin({ activate })
├── manifests/…           # 贡献声明源（TS）
└── dist/                 # bun build 产物 + 生成的 plugin.json
```

规则：

1. **产物目录即插件目录**：发行包里放在 `resources/plugins/<id>/`，Host 用与第三方完全相同的 `discover → validate → activate` 路径加载。
2. `@novaway/plugin-api` 标记为 `external`，由宿主提供单实例（`node_modules` 注入或 `importmap`），避免类型与运行时双份。
3. `plugin.json` 由构建脚本从 TS 定义生成，**工具 schema 只有一份来源**；生成后做一次 Schema 校验，失败即构建失败。
4. 内置插件的 `plugin.json` 与第三方同样接受校验与诊断；不允许「内置跳过校验」。
5. 桌面端把 `resources/plugins` 只读挂载，`plugin-data` 写到 userData，升级时不覆盖用户数据。

---

## 17. 风险

| #   | 风险                                  | 概率 | 影响 | 对策                                                               |
| --- | ------------------------------------- | ---- | ---- | ------------------------------------------------------------------ |
| R1  | 迁移内置能力导致行为回归              | 高   | 高   | 代码先原样搬家；`shadow` 模式对比；每个插件独立开关                |
| R2  | 工具/Agent 改名破坏提示词             | 中   | 高   | 内置插件 `global: true`；别名表；回归测试用真实 transcript         |
| R3  | 内核边界反复被打破                    | 高   | 中   | B1 静态测试进 CI；PR 模板提示                                      |
| R4  | UI 贡献发现接口成为新瓶颈             | 中   | 中   | 一次拉取 + SSE 增量；本地缓存；接口 < 200ms                        |
| R5  | 插件数量增长拖慢启动                  | 中   | 中   | 惰性激活；性能门禁；诊断显示每个插件的激活耗时                     |
| R6  | 第一方与第三方 API 分叉               | 中   | 高   | 同一 Manifest/注册表；差异只在 capability；每季度审计              |
| R7  | 团队/工作流插件需要过多内核能力       | 高   | 中   | 最后迁移；KernelApi 只增不改；对外仍是 Restricted                  |
| R8  | 旧插件依赖内部模块                    | 中   | 中   | 兼容层保留导出；诊断给迁移建议                                     |
| R9  | Bun/Node 差异                         | 中   | 中   | 插件 API 不依赖 Bun-only；CI 双运行时                              |
| R10 | 改动面过大导致合并冲突                | 高   | 中   | 按里程碑小步合并；注册表先行，调用点后改                           |
| R11 | 插件工具缺 `safety` 导致并发/权限事故 | 中   | 高   | 保守缺省值 + conformance suite + 内置插件构建期抽取（§4.2、§15.6） |
| R12 | 动态工具列表击穿 prompt 缓存          | 中   | 中   | 固定排序 + 快照 + 工具块文本快照测试（§4.2.1、§4.11）              |
| R13 | 升级后大面积插件失效，用户无法自救    | 中   | 高   | 安全模式 + `NOVAWAY_PLUGINS=off` + 一键回退（§10.6、§13.5）        |
| R14 | 覆盖机制被滥用导致内置能力被静默替换  | 低   | 高   | 覆盖需显式声明 + 安装确认 + 诊断可见 + 内核工具不可覆盖（§4.9）    |

---

## 18. 决策记录

| #   | 问题                         | 决定                                                            |
| --- | ---------------------------- | --------------------------------------------------------------- |
| Q1  | 工具命名分隔符               | `_`（与现有 Extension 前缀一致）                                |
| Q2  | 内置插件是否保留原名         | 是，`global: true`，迁移期最多保留到 2.0                        |
| Q3  | 拦截器与生命周期 Hook 字段名 | 分开：`interceptors` / `lifecycleHooks`                         |
| Q4  | 插件 KV 位置                 | 小状态 SQLite KV；大文件数据目录                                |
| Q5  | 卸载是否删数据               | 默认保留，`purge: true` 才删                                    |
| Q6  | 第三方默认信任级别           | L1；本期只开放 L0 给内置与显式信任的插件                        |
| Q7  | 前端如何发现能力             | HTTP 贡献接口 + SSE，禁止编译期 import                          |
| Q8  | 第一方与第三方是否同一套 API | Manifest/生命周期/注册表相同；API 分 KernelApi 与 PluginContext |
| Q9  | 是否要求 `activationEvents`  | 代码型插件必须声明，缺省按 `onStartup`                          |
| Q10 | `apiVersion` 支持窗口        | 当前 + 上一版；不满足时 `blocked`                               |

### 18.1 已决（原「仍待确认」项 + 本次补充）

| #   | 问题                     | 决定                                                                                                                 | 理由                                                                                                          |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Q11 | `builtin.providers` 粒度 | **一个插件**，内部按 `onProvider:<id>` 惰性 import 厂商模块                                                          | 20+ 厂商大多是配置适配器；拆成 20 个插件带来 20 份版本/状态/manifest 成本，隔离收益接近零（同进程、同一 SDK） |
| Q12 | pulse 拆分               | 拆成 `builtin.publish`（驱动与能力计算）+ `builtin.publish.ui`（页面与入口）                                         | 桌面端只要驱动，Web 端只要 UI；启用条件不同                                                                   |
| Q13 | 第三方继承团队编排       | 第一期不允许                                                                                                         | 并发、成本归属、权限模型未稳定；以 `task` / `task_status` 作为稳定契约                                        |
| Q14 | 前端加载方式             | 第一方 `viewId` + 第三方 iframe，**不做 ESM 联邦**                                                                   | Solid 双实例破坏响应式；见 §9.8                                                                               |
| Q15 | 核心工具范围             | 13 个白名单，其余全部下沉                                                                                            | 判据是「去掉它插件还能不能装进来」；见 §8.1.1                                                                 |
| Q16 | 边界判定形式             | 过渡期用 `kernel.manifest.json` 文件清单，M5 后改为目录约束（`src/kernel/**`、`src/plugin-api/**`、`src/shared/**`） | 清单会腐烂；目录是唯一能长期维护的形式                                                                        |
| Q17 | 第一方插件仓库形态       | `packages/plugins/<id>/` 独立 workspace 包                                                                           | 让「第一方也走插件流程」在构建层成立；见 §8.2 原则 5                                                          |
| Q18 | 插件自有 HTTP 路由       | 允许，强制前缀 `/plugin/<id>/`，需声明 `capabilities.http`                                                           | 避免与宿主 API 命名空间冲突，统一代理与审计入口                                                               |
| Q19 | 覆盖内置贡献             | 允许，需显式 `overrides` 声明；内核工具不可覆盖                                                                      | 区分「增强」与「劫持」；见 §4.9                                                                               |
| Q20 | 工具列表稳定性           | 全局统一排序函数 + 每轮快照 + 文本快照测试                                                                           | 动态贡献不能破坏 prompt 缓存；见 §4.2.1                                                                       |
| Q21 | 旧 `capabilities.*` 开关 | 降级为派生只读值，写入时转成插件启停                                                                                 | 避免两套开关并存产生幽灵贡献；见 §4.10                                                                        |

---

## 附录 A：Provider 迁移前后

**现在**（`provider.ts` 内的典型分支）：

```ts
const BUNDLED_PROVIDERS = {
  "@ai-sdk/openai": () => import("@ai-sdk/openai").then((m) => m.createOpenAI),
  // …
}

if (providerID === "openrouter") {
  return {
    autoload: true,
    options: { baseURL: "https://openrouter.ai/api/v1" },
    getModel: async (sdk, modelID) => sdk(modelID),
    vars: () => ({ ... }),
  }
}
```

**之后**（`plugins/builtin/providers/openrouter.ts`）：

```ts
import type { ProviderAdapter } from "@novaway/plugin/v2"

export default {
  id: "openrouter",
  name: "OpenRouter",
  sdk: { package: "@openrouter/ai-sdk-provider", factory: "createOpenRouter" },
  auth: { type: "env", key: ["OPENROUTER_API_KEY"] },
  options: { baseURL: "https://openrouter.ai/api/v1" },
  transform: {
    headers: ({ apiKey }) => ({ Authorization: `Bearer ${apiKey}` }),
  },
} satisfies ProviderAdapter
```

`provider.ts` 只需要：

```ts
for (const adapter of providers.list()) {
  providersById.set(adapter.id, adapter)
}
```

新增厂商 = 新增一个文件 + manifest 一行，内核 diff 为空。

---

## 附录 B：Office 引擎迁移前后

**现在**：

```ts
export function engineFor(format: OfficeFormat) {
  if (format === "docx") return docxEngine
  if (format === "pptx") return pptxEngine
  if (format === "xlsx") return xlsxEngine
  // …
}
```

**之后**（`plugins/builtin/office-engines/index.ts`）：

```ts
export function activate(ctx: KernelApi) {
  ctx.office.register({
    format: "docx",
    kind: "document",
    extensions: ["docx", "docm", "dotx", "dotm"],
    engine: docxEngine,
  })
  ctx.office.register({
    format: "pptx",
    kind: "presentation",
    extensions: ["pptx", "pptm", "potx", "ppsx"],
    engine: pptxEngine,
  })
  // …
}
```

`registry.ts` 只保留：

```ts
export function engineFor(format: string) {
  return registrations.get(format)?.engine
}
```

新增 `.foo` = 新增一个贡献，`registry.ts` 与 `file-tabs.tsx` 都不动。

---

## 附录 C：贡献发现 API

```
GET /plugin
GET /plugin/:id
GET /plugin/contributions?kind=tool
GET /plugin/contributions?kind=surface&slot=sidebar.item
GET /plugin/contributions?kind=office-engine
GET /plugin/contributions?kind=publish-driver
GET /plugin/views
GET /plugin/diagnostics
GET /plugin/events            # SSE
POST /plugin/install
POST /plugin/:id/enable
POST /plugin/:id/disable
POST /plugin/:id/reload
DELETE /plugin/:id?purge=true
```

`GET /plugin/contributions` 返回：

```json
{
  "kind": "surface",
  "items": [
    {
      "pluginID": "builtin.database",
      "id": "database",
      "slot": "sidebar.item",
      "title": "数据",
      "icon": "database",
      "order": 30,
      "action": { "type": "view", "viewId": "builtin.database.page" },
      "scope": "builtin"
    }
  ]
}
```

前端只依赖这个结构，不依赖具体插件的类型。

---

## 附录 D：第一方插件 manifest 示例

`packages/plugins/office/plugin.json`（构建期生成，源码在 `packages/plugins/office/src`）：

```json
{
  "name": "builtin.office",
  "version": "1.16.0",
  "apiVersion": 2,
  "kind": "code",
  "main": "./index.js",
  "activationEvents": ["onTool:office_document_read", "onPreview:.docx", "onView:office.home"],
  "dependencies": { "builtin.office-engines": "^1.16.0" },
  "capabilities": {
    "fs": ["workspace-read", "workspace-write", "plugin-data"],
    "secrets": [],
    "network": []
  },
  "contributes": {
    "tools": [
      { "id": "document_read", "entry": "./tools/document-read.js", "description": "读取文档正文", "parameters": {} }
    ],
    "agents": ["./agents"],
    "skills": ["./skills"],
    "previewers": [{ "id": "docx", "match": { "extension": [".docx", ".docm"] }, "viewId": "office.docx.preview" }],
    "surfaces": [
      { "slot": "home.card", "id": "office", "title": "办公", "action": { "type": "view", "viewId": "office.home" } }
    ]
  }
}
```

注意：第一方也用 `plugin.json`，不是硬编码在 `agent.ts` 里。`tools` 这里只列一条示意，真实清单由构建期从 `packages/plugins/office/src` 的 TS 定义生成完整声明（§6.3）；不存在 `"tools": ["./tools"]` 这种目录写法——§6.5 的索引器不 import 任何代码就要拿到 `description` 和 `parameters`。

---

## 附录 E：术语

| 术语                 | 含义                                         |
| -------------------- | -------------------------------------------- |
| **Kernel**           | 不包含任何具体能力的内核；只认识贡献点       |
| **Contribution**     | 插件注册到内核的一个点                       |
| **Registry**         | 某类贡献的注册表，负责命名、冲突、覆盖、释放 |
| **KernelApi**        | 第一方插件可用的完整内核接口                 |
| **PluginContext**    | 第三方插件可用的受限接口                     |
| **Activation Event** | 触发插件代码加载的事件                       |
| **Surface**          | 界面贡献（侧栏项、视图、设置分组、渲染器）   |
| **Shadow Mode**      | 新旧机制并行加载、对比结果、以旧为准         |
| **Drill**            | 本文档定义的验收演练（D1–D9）                |

---

## 附录 F：插件作者视角（从旧 API 到 v2）

设计的最终裁判是插件作者。同一个 `weather` 工具，三种写法：

**今天（Server Plugin）：**

```ts
// config.plugin spec 指向的模块
export const Hooks = {
  tool: {
    weather: {
      execute: async (args) => ({ output: "sunny" }),
    },
  },
}
```

问题：没有 schema（模型看不到参数说明）、没有名字隔离（和别的插件的 weather 冲突）、没有启停（装了就在）。

**v2（声明 + 激活）：**

```jsonc
// plugin.json
{
  "name": "acme-weather",
  "apiVersion": 2,
  "activationEvents": ["onTool:acme-weather_weather"],
  "capabilities": { "network": ["wttr.in"] },
  "contributes": {
    "tools": [
      {
        "id": "weather",
        "entry": "./tools/weather.js",
        "description": "Get current weather for a city",
        "parameters": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] },
        "safety": { "readOnly": true, "concurrencySafe": true, "idempotent": true },
      },
    ],
  },
}
```

**`contributes.tools` 是声明对象数组（§7.4），不是文件路径数组。** §6.5 要求索引器不 import 任何代码就能建索引、把 `description` + `parameters` 拼进工具块；只给路径就退回上面那段「没有 schema，模型看不到参数说明」的老问题。

入口模块导出**以 `PluginContext` 为参数的工厂**，宿主在激活时调用它，把产出的 `execute` 与 manifest 声明合并成一条工具贡献：

```js
// tools/weather.js —— 零 import 的纯 JS，M0 验收要求它在 checkJs + strict 下过 tsgo --noEmit
export default (api) => ({
  async execute({ city }) {
    const res = await api.http.fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`)
    return { output: await res.text() }
  },
})
```

三处与旧示例的差别都是故意的：

- `api.http.fetch` 而不是 `ctx.http.get`：`execute` 的第二个参数是 §4.2 的 `ToolExecutionContext`，里面没有 `http`；插件自己的 API 只能由激活点闭包注入。`HttpClient` 只暴露一个 `fetch`，因为 §5.4 的主机白名单校验需要唯一入口，语法糖（`get`/`post`/`json`）不进 API。
- `id` 在运行时是 `acme-weather_weather`（§4.8 命名空间），manifest 里只写本名 `weather`。
- 没有 `main`：这个例子只声明、不写激活代码，`activationEvents` 命中时宿主直接加载 `entry`。要写激活代码就用 `definePlugin` + `ctx.tools.register(defineTool({...}))`（§5.2），两条路径产出的贡献结构一致。

**迁移对照**（写进 `docs/plugin-authoring.md` 的核心表）：

| 旧                              | v2                                                  | 说明                          |
| ------------------------------- | --------------------------------------------------- | ----------------------------- |
| `Hooks.tool[id].execute`        | `defineTool` 贡献                                   | 获得 schema、命名空间、safety |
| `Hooks.auth` / `Hooks.provider` | `providers` 贡献                                    | ProviderAdapter               |
| `Hooks.event`                   | `interceptors` + `activationEvents: onEvent:<name>` | 获得超时与熔断                |
| 顶层 `tool: true` 等            | `capabilities.tools`                                | 未声明即拒绝                  |
| `config.plugin` 安装            | 不变（来源），运行走 Host                           | 老用户无感                    |

作者要的新增概念只有四个：`activationEvents`、`capabilities`、`safety`、命名空间。其余（生命周期、注册、启停）都是宿主的事。如果作者指南超过两页纸，说明 API 设计有问题，回头改 API 而不是加文档。

---

## 附录 G：M0-2 边界基线（2026-11-06 实测）

§14.3 第 2 步要求「对现有代码跑一遍，输出当前违规清单（基线）」。清单落在
`packages/novaway/kernel.manifest.json` 与 `packages/novaway/test/architecture/kernel-boundary.baseline.json`，
由 `packages/novaway/script/scan-boundary.ts` 生成，本文只留结论——基线以文件为准，不复读以免出现第二份真相。

| 指标                                       | 数值 |
| ------------------------------------------ | ---- |
| `kernel` 匹配到的文件                      | 32   |
| `capability` 匹配到的文件                  | 150  |
| 被 `exempt` 挡住的运行时依赖边             | 28   |
| 进入棘轮基线的依赖边（无豁免）             | 15   |
| 死 glob / 到期豁免 / 空转豁免 / API 包污染 | 0    |

豁免分布：`src/tool/registry.ts` 22 条（M1 到期）、`src/plugin/index.ts` 6 条（M2 到期）。

基线 15 条集中在三处，正好是三笔要还的债：

- `src/session/prompt.ts` → `@/team/*`（11 条）与 `@/memory/*`（2 条）：Team 与 Memory 的编排逻辑仍写死在提示主循环里，这是 super-agent 线要接手的最大一块。
- `src/session/session.ts` → `@/memory/service`（1 条）。
- `src/storage/schema.ts` → `../memory/memory.sql`（1 条）：Drizzle schema 按目录归属能力，迁移时需要决定「表留在内核、读写走贡献点」的边界。

落地清单相对 §2.3 示例的两处出入（跨包 `capability` glob、删掉 `src/config/config.ts` 豁免）已在 §2.3 就地说明，这里不复读。

复现与收紧：

```
bun run --cwd packages/novaway scan:boundary    # 门禁 B1，新增依赖边即失败
bun run --cwd packages/novaway scan:boundary --update    # 还掉债之后重写基线
```

`test/architecture/kernel-boundary.test.ts` 除门禁本身外还自检扫描器的五个失效模式（抓得到真实越界、空基线全算新增、基线漏记/多记、豁免到期、死 glob），防止清单腐烂把绿灯变成假绿灯。

---

## 结语

这份文档的验收标准只有一句话：**新增能力不改内核，停用能力不留残骸。**

如果某个能力做不到，要么它属于内核（如 read/write/shell），要么设计里还缺一个扩展点——两种情况都应在评审时明确写出来，而不是用「加一个 if 分支」糊过去。

建议推进顺序：先过 M0 的边界测试，再按 M2 的 Provider 与 Office 引擎验证「第一方也走插件」，最后做 UI 与团队/工作流。前两个里程碑就能证伪整套设计，成本最低。

最后的检验不是文档，而是三个问题：

1. **用户**：装一个第三方插件、停用一个内置能力、升一次级，全程不需要看文档——做到就算成。
2. **作者**：写一个工具插件，只需要懂 `plugin.json` + `defineTool` + 四个新概念——超过这个范围就是 API 还没收敛。
3. **维护者**：三年后加第 19 个贡献点，改的是 `plugin-api` 与一个注册表，而不是内核 if 链——做到，这套设计就活过了它最大的风险（腐烂）。

---

## 修订记录

### v3.0 → v3.1（2026-11-07）

只改实现层表述，验收 D1–D9、门禁 B1–B3、决策 Q1–Q21、里程碑与 M0 拆解均未动。全部改动来自 M0 第 1–3 步落地时对文档的实测复核。

| #   | 位置                        | 改了什么                                                                                                              | 为什么                                                                                                   |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | §2.3                        | `kernel.manifest.json` 示例补 `milestone` 字段与两条跨包 `capability` glob；删掉 `src/config/config.ts` 豁免          | 门禁按字段校验清单形状；实测该文件 0 条运行时越界边，空转豁免会被门禁判失败                              |
| 2   | §2.3                        | 补齐扫描器语义：三形态匹配、AST 判定 `import type`、逐边基线棘轮、四种静默腐烂（死 glob / 到期 / 空转 / API 包污染）  | 原文只写「命中 capability 就失败」，实现里真正决定门禁可信度的是这些细则                                 |
| 3   | §4.2                        | 定义 `ToolExecutionContext` 与 `ToolResult`；写明 Effect→Promise 边界与「两个 ctx 不许混」                            | 上一版 `ToolExecutionContext` 只出现在签名里从未定义，是附录 F 写错的根因                                |
| 4   | §5.2                        | 说明只有 11 个注册表字段（#15–18 走 manifest），以及 `office`/`publish` 短名 vs `officeEngines`/`publishDrivers` 长名 | §3 的表列了 18 个扩展点，读者会拿它去数 API 字段                                                         |
| 5   | §5.3 + §5.5 + §14.3 第 8 步 | `permission_denied` → `capability_denied`                                                                             | §5.5 的错误码集合里根本没有 `permission_denied`，三处指向一个不存在的码                                  |
| 6   | 附录 F                      | `contributes.tools` 改为声明对象数组；入口模块导出 `(api) => ({ execute })` 工厂；`ctx.http.get` → `api.http.fetch`   | 路径数组拿不到 schema（§6.5 索引要求）；`execute` 的 ctx 里没有 http；`HttpClient` 只有 `fetch` 一个入口 |
| 7   | 附录 G                      | 新增 M0-2 实测边界基线（32 kernel / 150 capability / 28 豁免边 / 15 基线边）                                          | §14.3 第 2 步要求的产出物，此前文档里没有                                                                |
| 8   | 附录 D                      | 第一方 office manifest 的 `"tools": ["./tools"]` 改成 §7.4 的声明对象数组                                             | 同一份文档里 `tools` 出现两种形状（§7.4/§7.5 对象、附录 D 目录），D1 的作者照哪个写都会错                |
