# PowersNexus 集成说明（当前）

> 更新时间：2026-07-23

## 当前模式：默认全局插件

- 配置种子：`PowersNexus@git+https://gitee.com/nova-way/powersnexus.git`
- 来源：Gitee 仓库（`packages/opencode/src/config/config.ts` 中 `DEFAULT_GLOBAL_PLUGINS`）
- 管理入口：应用 **设置 → 插件**
- 桌面端仅设置 `POWERSNEXUS_NODE_PATH`（插件 CLI 使用 Node）

## 已下线

- NovaWay 内嵌第一方工作流引擎、HttpApi、会话注入、设置页、工作流面板
- 独立 bundled 版本通道 / stable 发布脚手架 / KPI 夜间流水线
- OpenAPI 与 SDK 中的 `/powersnexus/*` 端点（已从 `packages/sdk/openapi.json` 与 `packages/sdk/js/src/v2/gen` 移除）

## 仍保留

- DB migration：`packages/opencode/migration/20260717120744_powersnexus_workflow`（历史库兼容，勿删）
- Browser 工具能力：`packages/opencode/src/browser`（与插件工作流无关的通用浏览器工具）

## 重新生成 SDK

若再次执行完整 `./script/generate.ts`，需保证 opencode 服务端已不再注册 powersnexus HttpApi（当前已移除），生成结果将自然不含这些端点。
也可在已清理的 `packages/sdk/openapi.json` 上直接用 `@hey-api/openapi-ts` 再生 `packages/sdk/js/src/v2/gen`。
