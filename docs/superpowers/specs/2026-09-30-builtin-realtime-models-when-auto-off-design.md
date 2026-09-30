# 关闭 Auto 后展示内置实时模型设计文档

**日期**: 2026-09-30  
**状态**: 已确认  
**版本**: 1.0

## 1. 概述

当前内置提供商 `builtin` 同时承载两类模型：

- 静态注入的 `auto` 模型（Auto Mode 使用，由网关按任务选择）
- 通过网关 `/models` 实时发现并周期刷新的具体模型

问题：当用户关闭 Auto Mode 后，TUI 与 Web App 都会把**整个 `builtin` 提供商**从模型列表中隐藏，导致实时发现的内置模型也无法被用户看到和手动指定。

本设计将过滤粒度从"整个提供商"收敛为"仅 `builtin/auto` 这一条模型"，使关闭 Auto 后用户仍可看到并选择内置实时模型。

## 2. 背景与动机

### 当前问题

- 关闭 Auto 后，`builtin` 提供商被整体隐藏，实时发现的内置模型一并消失。
- 内置模型实时发现逻辑（`provider.ts` 的 `builtin` loader：`/models` 拉取 + 15 分钟周期刷新）本身工作正常，数据侧已存在，仅是 UI 层被过滤掉。
- 用户无法手动指定内置实时模型，只能依赖 Auto。

### 设计目标

- 关闭 Auto 后，在"内置"分组中展示网关实时发现的模型（不含 `auto` 条目）。
- 内置实时模型与普通模型行为一致：可选择、可收藏、进入最近使用、可作为当前/回退模型。
- 开启 Auto 时的行为保持不变（列表隐藏，仅显示提示文案）。
- 不改动服务端模型发现/刷新逻辑，不做数据迁移。

### 非目标

- 不拆分 `builtin` 提供商为多个 provider id。
- 不改变 Auto Mode 的开关语义与持久化格式。
- 不调整 `builtin` 模型的免费标识、分组名等展示细节。

## 3. 术语

- **Auto 模型**：`providerID === "builtin" && modelID === "auto"` 的模型条目。
- **内置实时模型**：`builtin` 提供商下由网关发现、`modelID !== "auto"` 的模型。
- **Auto Mode**：客户端开关状态，持久化于 TUI 的 `model.json` 与 App 的 localStorage（`model.v1`）。

统一判定谓词（两端各自实现，语义一致）：

```
isAutoModel(item) = item.providerID === "builtin" && item.modelID === "auto"
```

## 4. 方案选型

### 方案 A（采用）—— 改过滤粒度

将所有"跳过整个 `builtin` 提供商"的判断，改为"只跳过 `builtin/auto`"。内置实时模型自然出现在"内置"分组。

- 优点：改动小、无服务端改动、无数据迁移、行为可预期。
- 缺点：过滤点分散在若干文件，需要逐个收敛。

### 方案 B —— 数据层剥离（未采用）

在 UI 获取模型列表时统一剔除 `builtin/auto`，再删除所有 provider 级过滤。结果等价，但过滤逻辑分散在多个 `list()`，可维护性更差。

### 方案 C —— 服务端拆分 provider（未采用）

把内置实时模型放到独立 provider id。最"干净"，但需要改服务端并处理历史持久化选择，成本远大于收益。

## 5. 详细设计（方案 A）

### 5.1 TUI

**`packages/tui/src/component/dialog-model.tsx`**

- 移除 `options()` 中对整个 `builtin` 提供商的过滤（原 `:72`）。
- 在遍历 `provider.models` 时，按模型粒度排除 auto：
  `filter(([model]) => !(provider.id === "builtin" && model === "auto"))`。
- 收藏 / 最近使用中的 `builtin/auto` 排除逻辑（现有 `isAutoModel`）保持不变。
- Auto Mode 开启时 `options()` 返回空列表的行为保持不变（`dialog-model.tsx:28`）。

**`packages/tui/src/context/local.tsx`**

- `fallbackModel` 的最后兜底 provider 选择（原 `:253-254`）：允许选择 `builtin`，但需排除"只有 auto"的候选（即候选模型需存在 `modelID !== "auto"`），保证手动模式不会回退到 auto。
- `:238-240`（recent 跳过 auto）、`:276-282`（current 跳过 auto）已只跳过 auto，无需改动。
- `setAutoMode` 的 `lastManual` 记忆（`:379-380`）已只跳过 auto，无需改动。

### 5.2 Web App

**`packages/app/src/components/dialog-select-model.tsx`**

- 将 `.filter((m) => m.provider.id !== "builtin")`（原 `:43`）改为仅排除 `builtin/auto`：
  `.filter((m) => !(m.provider.id === "builtin" && m.id === "auto"))`。
- Auto Mode 开启时返回空列表的行为保持不变（`dialog-select-model.tsx:37`）。

**`packages/app/src/context/local.tsx`**

- `recentModel()`（`:158`）：`item.providerID === "builtin"` 改为仅跳过 auto。
- `defaultModel()`（`:167`）：`provider.id === "builtin"` 不再整体跳过；对 `builtin` 内候选排除 auto。
- `current()`（`:238`、`:243`）：`m.providerID === "builtin"` 改为仅跳过 auto。

**`packages/app/src/context/models.tsx`**

- `setAutoMode`（`:156`、`:161`）：`item.providerID !== "builtin"` / `manual.providerID !== "builtin"` 改为仅跳过 auto。

### 5.3 服务端

无改动。`builtin` 提供商的实时发现、周期刷新、`provider.list` 输出均已包含实时模型。

## 6. 数据流

1. 服务端 `builtin` loader 拉取网关 `/models` → 合并进 `builtin.models`（排除 `auto`，`auto` 由静态注入）。
2. TUI `sync.data.provider` / App `provider.list` 已包含 `builtin` 全部模型。
3. UI 层仅过滤掉 `builtin/auto` 这一条，其余内置实时模型展示、可选择。

## 7. 行为矩阵

| 状态 | 模型列表 | 内置分组 |
| --- | --- | --- |
| Auto 开 | 空（提示文案） | 不展示 |
| Auto 关 | 全部可用模型 | 展示实时模型，不含 auto |

## 8. 边界情况

- 网关未配置（`BUILTIN_GATEWAY_BASE_URL` 为空）：`builtin` 不注册，行为与现状一致。
- 禁用模型发现（`NOVAWAY_DISABLE_MODEL_DISCOVERY`）：`builtin` 仅剩 `auto`，关闭 Auto 后"内置"分组为空，不产生可见项。
- 历史 `recent` / `lastManual` 中残留 `builtin/auto`：现有跳过 auto 逻辑继续生效，不被选中。
- 用户手动选择内置实时模型后再开启 Auto：`lastManual` 记录该手动模型；再次关闭 Auto 时恢复。

## 9. 测试与验证

- `packages/tui`、`packages/app` 分别运行 `bun typecheck` 与 `bun lint`。
- 手动验证：
  - Auto 开 → 无模型列表，显示提示。
  - Auto 关 → "内置"分组出现网关实时模型，选中后成为当前模型并进入最近使用。
  - 收藏内置实时模型后重启，收藏仍在。
- 若存在相关现有测试（模型选择 / 回退链），同步补充或更新断言。

## 10. 影响文件清单

- `packages/tui/src/component/dialog-model.tsx`
- `packages/tui/src/context/local.tsx`
- `packages/app/src/components/dialog-select-model.tsx`
- `packages/app/src/context/local.tsx`
- `packages/app/src/context/models.tsx`
