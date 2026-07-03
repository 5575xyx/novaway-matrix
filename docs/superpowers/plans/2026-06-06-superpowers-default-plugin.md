# superpowers 默认全局插件首启动注入 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户首次启动 opencode 时，将 `superpowers@git+https://github.com/obra/superpowers.git` 写进新生成的全局配置文件 `novaway.jsonc` 的 `plugin` 数组中。受 `OPENCODE_DISABLE_DEFAULT_PLUGINS` 门控。

**Architecture:** 在 `loadGlobal` 的首启动写入处，依据环境变量门控注入默认 plugin 数组。默认 plugin 列表作为模块级常量导出，方便测试和未来调整。

**Tech Stack:** TypeScript, Effect, Bun, Bun:test

**Spec:** `docs/superpowers/specs/2026-06-06-superpowers-default-plugin-design.md`

---

## File Structure

| 文件 | 责任 |
|------|------|
| `packages/core/src/flag/flag.ts` | 新增 `OPENCODE_DISABLE_DEFAULT_PLUGINS` 字段 |
| `packages/opencode/src/config/config.ts` | 新增 `DEFAULT_GLOBAL_PLUGINS` 常量；修改 `loadGlobal` 首次写入处 |
| `packages/opencode/test/config/config.test.ts` | 追加 1 个核心测试 |

---

## Task 1: 在 Flag 模块添加禁用门控

**Files:**
- Modify: `packages/core/src/flag/flag.ts:25` (在 `OPENCODE_DISABLE_AUTOCOMPACT` 附近)

- [ ] **Step 1: 添加 Flag 字段**

在 `packages/core/src/flag/flag.ts` 第 25 行（`OPENCODE_DISABLE_AUTOCOMPACT`）后插入新字段，使最终块在 `OPENCODE_DISABLE_AUTOCOMPACT` 与 `OPENCODE_DISABLE_MODELS_FETCH` 之间：

```ts
  OPENCODE_DISABLE_AUTOCOMPACT: truthy("OPENCODE_DISABLE_AUTOCOMPACT"),
  OPENCODE_DISABLE_DEFAULT_PLUGINS: truthy("OPENCODE_DISABLE_DEFAULT_PLUGINS"),
  OPENCODE_DISABLE_MODELS_FETCH: truthy("OPENCODE_DISABLE_MODELS_FETCH"),
```

- [ ] **Step 2: 验证类型检查**

运行：
```bash
cd E:\AImoney\NovaWay-Matrix\novaway-coder\packages\core && bun run typecheck
```

期望：无错误。

- [ ] **Step 3: 提交**

```bash
cd E:\AImoney\NovaWay-Matrix\novaway-coder
git add packages/core/src/flag/flag.ts
git commit -m "feat(flag): expose OPENCODE_DISABLE_DEFAULT_PLUGINS gate"
```

---

## Task 2: 添加失败测试（红灯）

**Files:**
- Modify: `packages/opencode/test/config/config.test.ts:165-185` (在现有 "creates global jsonc config with schema..." 测试之后)

- [ ] **Step 1: 插入新测试**

在 `packages/opencode/test/config/config.test.ts` 第 185 行（`creates global jsonc config with schema when no global configs exist` 测试结束的 `})` 后、第 187 行测试之前）插入：

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

**重要**：测试体内 `ConfigParse` 与 `clear`、`load` 都已在文件顶部导入。无需新增 import。

- [ ] **Step 2: 运行新测试，验证它失败**

运行：
```bash
cd E:\AImoney\NovaWay-Matrix\novaway-coder\packages\opencode && bun test test/config/config.test.ts -t "seeds default global plugins into new config file"
```

期望：FAIL — 因为 `loadGlobal` 当前只写 `$schema`，不写 `plugin`。`json.plugin` 是 `undefined`，与 `toEqual([...])` 不匹配。

错误信息大致为：`expected undefined to deeply equal [...]` 或类似。

- [ ] **Step 3: 提交红灯**

```bash
cd E:\AImoney\NovaWay-Matrix\novaway-coder
git add packages/opencode/test/config/config.test.ts
git commit -m "test(config): cover default global plugin seeding"
```

---

## Task 3: 实现默认 plugin 注入（绿灯）

**Files:**
- Modify: `packages/opencode/src/config/config.ts:413-424` (loadGlobal 首启动块)

- [ ] **Step 1: 在文件顶部添加 DEFAULT_GLOBAL_PLUGINS 常量**

在 `packages/opencode/src/config/config.ts` 第 9 行（`import { Flag } from "@opencode-ai/core/flag/flag"`）之后、第 10 行（`import { Auth }`）之前插入：

```ts

// Default plugins seeded into the global config the first time it's created.
// Users can remove or override these entries in their own config file.
export const DEFAULT_GLOBAL_PLUGINS: string[] = [
  "superpowers@git+https://github.com/obra/superpowers.git",
]
```

（行首保留一个空行以与上方 import 块分隔。）

- [ ] **Step 2: 修改 loadGlobal 首次写入块**

将 `packages/opencode/src/config/config.ts:417-424` 替换为：

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

**关键点**：
- 沿用原 `if (!existsSync(file))` 边界；已存在的配置文件**不**被回写。
- 仅当 `OPENCODE_DISABLE_DEFAULT_PLUGINS` 未设置时才写 `plugin`。
- `seed` 用 `Record<string, unknown>`，不引入新类型导入。

- [ ] **Step 3: 运行 Task 2 的测试，验证它通过**

运行：
```bash
cd E:\AImoney\NovaWay-Matrix\novaway-coder\packages\opencode && bun test test/config/config.test.ts -t "seeds default global plugins into new config file"
```

期望：PASS。

- [ ] **Step 4: 确认原 schema 测试仍然通过**

运行：
```bash
cd E:\AImoney\NovaWay-Matrix\novaway-coder\packages\opencode && bun test test/config/config.test.ts -t "creates global jsonc config with schema when no global configs exist"
```

期望：PASS（验证未破坏原行为）。

- [ ] **Step 5: 提交绿灯**

```bash
cd E:\AImoney\NovaWay-Matrix\novaway-coder
git add packages/opencode/src/config/config.ts
git commit -m "feat(config): seed default global plugins on first launch"
```

---

## Task 4: 全量验证

- [ ] **Step 1: 运行 lint**

```bash
cd E:\AImoney\NovaWay-Matrix\novaway-coder
bun lint
```

期望：本次修改的文件无新警告。

- [ ] **Step 2: 运行 typecheck**

```bash
cd E:\AImoney\NovaWay-Matrix\novaway-coder
bun typecheck
```

期望：无错误。

- [ ] **Step 3: 运行 config 测试套件**

```bash
cd E:\AImoney\NovaWay-Matrix\novaway-coder\packages\opencode && bun test test/config/config.test.ts
```

期望：所有测试通过（含本次新增）。

---

## Self-Review

1. **Spec 覆盖**：
   - Spec 目标（首次启动写入 plugin） → Task 3 Step 2 ✓
   - Spec 受门控控制 → Task 1 + Task 3 Step 2 ✓
   - Spec 测试要求（1 个核心测试） → Task 2 ✓
   - Spec 不变量（已存在配置不触碰） → 复用 `!existsSync(file)` 边界 ✓

2. **占位符扫描**：无 TBD/TODO/待补全内容。

3. **类型一致性**：
   - `DEFAULT_GLOBAL_PLUGINS: string[]` 在 Task 3 Step 1 定义、在 Step 2 使用 → 一致
   - `Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS` 在 Task 1 定义、在 Task 3 Step 2 使用 → 一致
   - 测试中 `ConfigParse.jsonc`、`clear`、`load` 均为文件顶部已导入符号 → 一致

4. **依赖关系**：Task 1 → Task 2 → Task 3 → Task 4 顺序，Task 2 依赖 Task 1（编译通过），Task 3 依赖 Task 2（已存在的测试在编译期需要 `ConfigParse`/`clear`/`load`）。
