# PowersNexus 集成说明（当前）

> 更新时间：2026-11-20

## 当前模式：市场插件（不再内置种子）

- 来源：第一方插件仓库 `NovaWay-AI/novaway-plugins` 的 `plugins/com.novaway.powersnexus`（v2 declarative，23 个 Skill，`powersnexus_` 命名空间；当前稳定版 v1.1.4）。
- 安装：应用 **扩展 → 市场** 安装 `com.novaway.powersnexus`；宿主默认安装配置指向 v1.1.4。
- 宿主已移除 `DEFAULT_GLOBAL_PLUGINS` / `FALLBACK_GLOBAL_PLUGINS` / `PLUGIN_FALLBACK_URLS` 中的 PowersNexus Gitee git 种子与强制补种逻辑。
- 桌面端仅设置 `POWERSNEXUS_NODE_PATH`（插件 CLI 使用 Node）。

## 宿主工作流状态机

工作区会话的每个用户回合都会创建或恢复一条持久化工作流状态，存储在 `session_workflow_policy`，并将状态变化写入 `session_workflow_event`：

- `route`：`l0`、`l1`、`l2`、`l3`、`l4` 或 `non-coding`；首轮由确定性分类器计算，锁定后只能升级；
- `phase`：`intake`、`grill-me`、`design`、`plan`、`implementation`、`review`、`verification`、`delivery` 等；
- `question_budget` / `question_calls`：由宿主控制，而不是仅依赖提示词；
- `verification_status` / `delivery_status`：记录验收与交付状态，避免把未验证工作报告为完成；
- 加载重型 Skill 时，L0/L1 会自动升级到 L2 并记录升级原因；
- `question` 工具超出预算后不会再次阻塞用户，而是要求模型记录假设并继续；
- verification phase 禁止工作区写入工具，只允许只读检查和 verification 子代理；
- 宿主会检测未调用 `question` 的裸问句，必要时将本轮退回模型而不是直接结束。

该状态会以宿主标记注入当前回合，并在 Hook/Tool 执行边界更新。提示词和 Skill 仍负责提供工作方法，但 route、phase 和 question budget 的事实由宿主持久化。

## 已下线

- NovaWay 内嵌第一方工作流引擎、HttpApi、会话注入、设置页、工作流面板
- 独立 bundled 版本通道 / stable 发布脚手架 / KPI 夜间流水线
- OpenAPI 与 SDK 中的 `/powersnexus/*` 端点（已从 `packages/sdk/openapi.json` 与 `packages/sdk/js/src/v2/gen` 移除）
- 内置默认 git 种子（迁移为市场插件，见上）

## 仍保留

- DB migration：`packages/novaway/migration/20260717120744_powersnexus_workflow`（历史库兼容，勿删）
- Browser 工具能力：`packages/novaway/src/browser`（与插件工作流无关的通用浏览器工具）

## 重新生成 SDK

若再次执行完整 `./script/generate.ts`，需保证 NovaWay 服务端已不再注册 powersnexus HttpApi（当前已移除），生成结果将自然不含这些端点。
也可在已清理的 `packages/sdk/openapi.json` 上直接用 `@hey-api/openapi-ts` 再生 `packages/sdk/js/src/v2/gen`。

## 跨端状态、指标与安全边界（2026-11-20）

工作流状态由 server session 持久化，Desktop、CLI、IDE 和 Web 可以读取同一份状态，不依赖前端本地缓存：

- `GET /session/:sessionId/workflow-state`：读取当前 route、phase、question budget、verification、delivery；
- `GET /session/:sessionId/workflow-events`：读取有序事件流，用于恢复和审计；
- `GET /session/:sessionId/workflow-metrics`：读取 route、phase、升级、提问误用、阻断工具、验证和交付指标。

指标只从持久化 event/state 推导；未知事件不会被计为成功，`unverified` 不会折叠为 `passed`。路由回归语料覆盖 L0-L4、non-coding、中英文混合和指令注入伪装文本。

市场来源带 `sourceId` 时，zip/git 安装会经过统一 trust policy：第一方来源且具备 SHA-256 可识别为 `official`；具备可验证摘要的第三方为 `verified`；缺少摘要或签名的市场工件为 `untrusted` 并拒绝激活。高风险权限（workspace、process、network、secret、MCP 等）会被标记为需要确认。直接由用户指定的本地/URL 安装仍需在上层显式授权。

GitHub webhook 的 `X-GitHub-Event` 与请求体事件会交叉校验；`X-GitHub-Delivery` 与请求体 `deliveryID` 不一致时拒绝，已处理的 delivery ID 会按 session 事件流幂等跳过，避免重试重复写入 Auto Memory 和 Workflow Integration。

模型上下文中的仓库、网页、MCP、工具和 Skill 内容属于低于宿主规则的外部数据。运行时提示词明确禁止这些内容覆盖系统规则、权限规则或 workflow policy，并拒绝把外部文本中的“忽略之前指令”当作授权。
