# 万物皆插件阶段 0 基线（2026-11-08）

> 本记录是当前工作区的证据快照，不代表目标已完成。工作区包含大量既有未提交改动；开始实现时必须继续保留，不能把这些文件的当前状态归因于本轮。

## 1. 证据化状态矩阵

| 范围                     | 当前状态               | 证据                                                                                                          | 缺口 / 后续阶段                                                                                                   |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Plugin API / Manifest    | 部分实现               | `packages/plugin-api/src/{manifest,registry,context}.ts`；当前类型检查尚需全仓确认                            | contribution 定义覆盖范围与各运行时消费者尚未逐项完成；本轮不把未实现的 Super-Agent 消费者算作通过                |
| 发现、校验、目录归一化   | 部分接线               | `src/plugin/host.ts`、`manifest.ts`、`catalog.ts`；`test/plugin/host.test.ts`、`catalog.test.ts`              | `PluginHost.inspect()` 是发现/索引模型，不等于 Runtime Host 已激活插件                                            |
| Runtime Host 核心        | 单元级原型，非生产闭环 | `src/plugin/runtime/{host,activation,context,service}.ts`；`test/plugin/runtime-host.test.ts`                 | 已有激活/资源释放单测，但 API 没有用 discovery 结果完成 activate/deactivate；还需定义并验证失败恢复与在途调用语义 |
| instance scope           | 有初步实现/测试        | `PluginRuntimeService.layer` 使用 `InstanceState.make`；Host 测试验证不同 directory 得到不同 registry         | 生产 server、handler、ToolRegistry 是否共享同一 Host，需进一步测试当前实际 Layer 组装；不能只凭 Layer 名称判定    |
| HTTP plugin API          | 部分生产接线           | `handlers/plugin.ts` list 读取 `runtime.get` 状态；toggle 写 `PluginStorage`、切换旧 Extension 状态并发布事件 | toggle 不调用 Runtime Host 的 activate/deactivate；存储状态可改变而运行态不变                                     |
| ToolRegistry             | 兼容/Runtime 混合路径  | `src/tool/registry.ts` 静态导入大量内置工具；同时从 Runtime Host 读取 tools 并订阅注册变化                    | 当前 Host 未由 API 激活器填充；D1 无生产端到端执行证据；需要防止同一能力从 legacy 与 Runtime 双重注册             |
| 领域贡献                 | 尚未接入生产消费者     | `PluginRuntimeHost` 类型含可选 Provider/Office/Publish/Surface 等 registry；Manifest 与 Catalog 可列部分声明  | 没有逐类消费者/激活路径和 D3–D6 演练通过证据                                                                      |
| 默认发行组合             | 未验证                 | 尚无本基线可引用的安装/启用/无凭证引导黄金路径测试                                                            | 阶段 4                                                                                                            |
| Super-Agent contribution | 仅类型/设计层          | Plugin API 中存在 Super-Agent 声明种类；设计文档保留后续路线路径                                              | 不实现其运行时，不列入本轮插件 DoD                                                                                |

## 2. 已执行门禁

### B1 依赖方向

命令：`bun run --cwd packages/novaway script/scan-boundary.ts`

结果：通过。扫描到 50 个 kernel 文件、150 个 capability 文件、15 条已登记违规（28 条豁免内）、0 条基线外新增违规。此结果是按当前 `kernel.manifest.json` 棘轮基线通过，不代表现存 15 条依赖已迁除。

### 插件专项 M0 验证

命令：`bun run --cwd packages/novaway verify:plugins`

结果：通过现有专项序列：发现/索引/兼容 50 项、注册表 21 项、Runtime context 46 项（1 skip）、fault handling 26 项、Host 生命周期 7 项、TUI Host 3 项、storage 18 项、HTTP schema 1 项、HTTP API/SSE 8 项、timer/listener leak 检查通过。插件索引基准报告 20 插件 `discover` 中位数：cold 16.90ms、warm 14.12ms。

重要限制：该脚本输出明确将 D1–D9 列为 M0 known-red（未在本 milestone 实现）；现有性能脚本测索引，不足以单独证明设计中的发现+激活冷启动预算。专项通过不表示 D1–D9 或整体验收通过。

### B3 初始回归尝试

- `bun lint`：未能完成，oxlint/Go runtime 因 Windows 虚拟内存分配失败（`VirtualAlloc ... errno=1455`）退出。应减少并发/内存压力后单独重试；当前不能标为通过。
- `bun typecheck`：失败于 `@novaway/tui` 既有测试 fixture，3 个错误均为 `Session.scope` 缺失；根命令其余多数 package 成功，但全仓门禁未通过。需修复或确认所属既有改动，再重跑。
- `packages/app` build 与 `packages/novaway` 全量测试：阶段 0 尚未取得完整结果，需补跑。

## 3. 阶段 0 初始结论（已由后续进展部分更新）

> 以下保留初次核查历史；M0 HTTP → Runtime Host → ToolRegistry 闭环现已有专项集成证明，但阶段 1 其他门槛、D7/D9全量契约和全计划仍未完成。

最初生产闭环缺口为：HTTP toggle → Runtime Host 激活/停用 → 同一实例 ToolRegistry 读到变化 → 下一次执行实际看到工具贡献。此缺口已部分补齐；尚有 ToolRegistry legacy/static 路径、自动发现和其他 contribution consumers 等后续工作。

## 4. 后续进展（截至 2026-11-09；不覆盖初始快照）

- 已补 M0 的 HTTP toggle → RuntimeService → same InstanceState Runtime Host/ToolRegistry 的可执行 `.mjs` 集成测试。`bun run --cwd packages/novaway verify:plugins` 复跑通过：B1 51 kernel / 150 capability / 15 存量违规、28 豁免命中、0 新增；插件发现51、registry21、context46+1 skip、fault26、Host11、tool adapter3、secret5、TUI3、storage22、HTTP schema1、HTTP API/SSE15；leak check通过；20-plugin discover median cold16.92ms/warm14.19ms。该脚本仍打印 D1–D9 known-red，绝非整体验收。
- 新增红绿生命周期回归：旧 snapshot 停用后不得新执行/重新激活不可复活；在途 tool 收到组合 abort；cleanup throw 必须被诊断为 `cleanup_failed`，其余资源仍清理，状态不冒充 disabled。
- `bun run --cwd packages/novaway typecheck` 通过；全仓 `bun run typecheck -- --concurrency=2` 通过（17/17 packages）。
- `bun run --cwd packages/app build` 通过，Vite 3100 modules transformed，build 47.72s；现有 chunk size warnings 不阻断。
- 根 `bun run lint -- --threads=2` 仍因 Go/TypeScript checker `VirtualAlloc ... errno=1455` OOM失败；不能算通过。
- `bun test --cwd packages/novaway` 及低并发试验未得到成功全量结果。运行显示 ACP `Invalid handle`、TUI env config、control-plane SQLite FK/5s timeout、dynamic-workflow配置 NaN、file watcher/MCP 5s timeout 等失败或挂起；需要切分/调查并重跑；不是插件专项通过的证据，也尚不能判定全是预存问题。
- App 构建最近复跑已越过先前 file-tabs duplicate import 错误并成功；未改该用户大改文件。
- 插件 API schema 已增加 toggle scope 和 PluginTransitionError，但未运行 SDK/OpenAPI code generation；若会覆盖用户已有输出，先核实输出范围再执行。

> 以上是增量记录。实施计划、D1–D9 与全仓门禁仍未结项。

阶段 0 和阶段 1 均未验收，完整计划与“万物皆插件”目标未完成。生产 toggle/ToolRegistry闭环现在有可执行插件的专项覆盖；仍有运行态自动化启动、D1–D9行为覆盖、贡献类型迁移、lint/完整测试门禁等未结项。

### 2026-11-09 后续追加：旧 hooks 路径与回归重试

- 阅读 `packages/novaway/src/plugin/index.ts` 确认：旧 `Plugin.Service` 在实例初始化中仍直接加载 `INTERNAL_PLUGINS` 和配置的 `plugin_origins`，按 V1/legacy API 注入 hooks，并独立派发 `config`、`event` 与通用 `trigger`；Git 插件更新仍记录“restart to activate”。因此新 Runtime Host toggle 专项并未消除旧生产执行路径，当前缺少逐 hook 消费者映射、能力迁移和桥删除证明。未经替代行为验收不能关闭旧 loader。
- 根 lint 再用 `GOMAXPROCS=1 bun run lint -- --threads=1` 复试，仍在 Windows `VirtualAlloc errno=1455` 及 checker 内存分配处失败，未通过。
- novaway 全量测试串行后台重试以 exit 1 结束。已有日志仍含 ACP `Invalid handle`、TUI config 环境值缺失、dynamic-workflow `maxConcurrency` 为 NaN 等失败；不能断言均为预存，也没有全量成功证据。需分文件/目录单独复现诊断。
