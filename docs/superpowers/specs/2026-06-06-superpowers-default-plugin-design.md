# 默认全局插件：superpowers 首启动注入

**日期**：2026-06-06
**状态**：待评审
**范围**：3 个文件、约 15 行代码、1 个单元测试

## 目标

在用户首次启动 opencode 时，将 `superpowers@git+https://github.com/obra/superpowers.git` 写进新生成的全局配置文件 `novaway.jsonc` 的 `plugin` 数组中。

## 非目标

- 不修改运行时合并层（`mergePluginOrigins` 等）。
- 不写回已存在的配置文件。
- 不修改 `INTERNAL_PLUGINS`（monorepo 内置鉴权插件，机制不同）。
- 不为该插件写 `plugin_origins` 元数据；与用户手写 `plugin` 数组的现有行为一致。

## 探索结论

- **首次启动逻辑**：`packages/opencode/src/config/config.ts:413-424`，在 `!Flag.OPENCODE_CONFIG && !Flag.OPENCODE_CONFIG_DIR && !Flag.OPENCODE_CONFIG_CONTENT` 且 `novaway.jsonc` 不存在时写入最小化 `{ "$schema": "..." }`。
- **git spec 解析**：`npa('superpowers@git+https://github.com/obra/superpowers.git')` 返回 `type: "git"`。`Npm.add`（`packages/core/src/npm.ts:113-135`）通过 `@npmcli/arborist` 处理 spec，**支持 git URL**。`parsePluginSpecifier`（`packages/opencode/src/plugin/shared.ts:22-34`）保留 rawSpec。opencode 现有解析器可直接吃下该 spec。
- **门控机制**：`runtime-flags.ts:17` 已用 `OPENCODE_DISABLE_DEFAULT_PLUGINS` 控制 `INTERNAL_PLUGINS` 鉴权插件。`Flag` 模块（`packages/core/src/flag/flag.ts`）**未**暴露该字段，需新增。
- **默认 plugin 列表**：代码中**无任何**"全局默认 plugin 列表"机制；`Info.plugin` 是 `Schema.optional` 数组。

## 设计

### 文件改动

| 文件 | 改动 |
|------|------|
| `packages/core/src/flag/flag.ts` | 新增 `OPENCODE_DISABLE_DEFAULT_PLUGINS: truthy(...)` 字段 |
| `packages/opencode/src/config/config.ts` | ① 顶部新增 `export const DEFAULT_GLOBAL_PLUGINS: string[]`；② `loadGlobal` 首次写入处按 flag 决定是否注入 `plugin` |
| `packages/opencode/test/config/config.test.ts` | 追加 1 个核心测试 |

### 代码骨架

**`packages/core/src/flag/flag.ts`**（在 `OPENCODE_DISABLE_AUTOCOMPACT` 附近）：

```ts
OPENCODE_DISABLE_DEFAULT_PLUGINS: truthy("OPENCODE_DISABLE_DEFAULT_PLUGINS"),
```

**`packages/opencode/src/config/config.ts`**（在 `globalConfigFile` 函数之前）：

```ts
// Default plugins seeded into the global config the first time it's created.
// Users can remove or override these entries in their own config file.
export const DEFAULT_GLOBAL_PLUGINS: string[] = [
  "superpowers@git+https://github.com/obra/superpowers.git",
]
```

**`packages/opencode/src/config/config.ts:417-424`**（替换现有 if 块）：

```ts
if (!Flag.OPENCODE_CONFIG && !Flag.OPENCODE_CONFIG_DIR && !Flag.OPENCODE_CONFIG_CONTENT) {
  const file = globalConfigFile()
  if (!existsSync(file)) {
    const seed: Record<string, unknown> = {
      $schema: "https://opencode.ai/config.json",
    }
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      seed.plugin = DEFAULT_GLOBAL_PLUGINS
    }
    yield* fs
      .writeWithDirs(file, JSON.stringify(seed, null, 2))
      .pipe(Effect.catch(() => Effect.void))
  }
}
```

### 数据流

```
[首次启动]
  ↓
loadGlobal()
  ↓
!OPENCODE_CONFIG && !OPENCODE_CONFIG_DIR && !OPENCODE_CONFIG_CONTENT
  ↓
!existsSync(novaway.jsonc)
  ↓
检查 Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS
  ├─ false → 写入 { $schema, plugin: [superpowers spec] }
  └─ true  → 写入 { $schema }（仅 schema，与当前行为一致）
  ↓
后续 mergeConfig 读入 plugin 字段
  ↓
Plugin.Service.init() 解析并安装（走 Npm.add → arborist 处理 git URL）
```

### 边界与不变量

- **已存在配置**：`existsSync(file)` 为 true → 完全不触碰。
- **3 个 env flag 任一设置** → 跳过首次写入，沿用当前行为。
- **`OPENCODE_DISABLE_DEFAULT_PLUGINS=true`** → 即使首启动也不写 plugin。
- **跨平台路径**：`globalConfigFile()` 已处理 win/mac/linux。
- **git URL 安装失败**：`Npm.add` → `InstallFailedError`，`Plugin.init()` 在 `bootstrap.ts:38-52` 已用 `Effect.forkDetach` 隔离，启动不会因此崩溃。
- **`plugin_origins` 元数据**：首启动写入的 `plugin` 是裸 spec 字符串，没有 origin 记录——与用户手写 `plugin` 数组的现有行为一致。
- **并发首次启动**：`writeWithDirs` 在 fs 层竞态，但 `existsSync` 检查在写入前，重复写也只会写一次；不会损坏文件。

### 测试

`packages/opencode/test/config/config.test.ts` 在现有 "creates global jsonc config with schema when no global configs exist" 测试后追加：

```ts
test("seeds default global plugins into new config file", async () => {
  await using tmp = await tmpdir()
  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = tmp.path
  await clear(true)

  try {
    await withTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        await load(ctx)
      },
    })

    const content = await Filesystem.readText(path.join(tmp.path, "novaway.jsonc"))
    const json = ConfigParse.jsonc(content, path.join(tmp.path, "novaway.jsonc"))
    expect(json.plugin).toEqual([
      "superpowers@git+https://github.com/obra/superpowers.git",
    ])
  } finally {
    ;(Global.Path as { config: string }).config = prev
    await clear(true)
  }
})
```

复用现有 `ConfigParse` 工具（`packages/opencode/src/config/parse.ts`）解析 jsonc。

## 范围与风险

- **范围**：3 个文件、约 15 行代码、1 个单元测试。
- **风险**：
  1. **git spec 安装失败** → 该插件不可用，但启动正常。属于现有 plugin 系统的失败语义。
  2. **未来增删默认 plugin 需改源码** → 用户接受"代码中硬编码常量"。
  3. **无其他环境副作用** —— 不影响已存在配置，不影响非首启动。

## 关键决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 注入方式 | 写盘 / 运行时注入 / 两者 | 写盘 | 与用户期望一致，用户可在文件中看到并管理 |
| git spec 支持 | 已支持 / 需确认 | 已支持（npa + arborist） | 通过本地验证确认 |
| 受门控控制 | 是 / 否 / 新开关 | 是 | 与 `INTERNAL_PLUGINS` 保持一致 |
| 默认 plugin 列表位置 | 硬编码常量 / 单独文件 / env | 硬编码常量 | 简单直接，符合 YAGNI |
| 同时内置其他鉴权插件 | 是 / 否 | 否 | 最小变更面，单独决策 |
| 测试覆盖 | 核心测试 / 完整场景 / 不写 | 核心测试 | 1 个测试覆盖主路径 |
