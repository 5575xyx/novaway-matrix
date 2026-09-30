# 关闭 Auto 后展示内置实时模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关闭 Auto Mode 后，TUI 与 Web App 在"内置"分组中展示网关实时发现的内置模型（排除 `auto` 条目），并允许用户像普通模型一样选择、收藏、作为当前/回退模型。

**Architecture:** 将所有"跳过整个 `builtin` 提供商"的判断收敛为"仅跳过 `builtin/auto` 这一条"。每端各自抽出一个纯函数谓词（`isAutoModel`）和一个兜底模型选择纯函数，先写单测再接入 UI/上下文。

**Tech Stack:** Bun + TypeScript；TUI 用 SolidJS + bun:test；App 用 SolidJS + bun:test（happydom preload）。

---

## 文件结构

**TUI (`packages/tui`)**
- Modify `src/component/dialog-model.tsx` — 导出 `isAutoModel`；模型选择器改为按模型粒度排除 auto（不再整体隐藏 builtin 提供商）。
- Modify `src/context/local.tsx` — 导出 `defaultSelectableModel`；回退默认 provider 允许 builtin 实时模型（排除 auto）。
- Test `test/cli/cmd/tui/model-options.test.ts` — `isAutoModel` 单测。
- Test `test/context/local.test.ts` — `defaultSelectableModel` 单测。

**App (`packages/app`)**
- Modify `src/utils/model-name.ts` — 导出 `isAutoModel` 与 `firstSelectableModel`。
- Modify `src/components/dialog-select-model.tsx` — 选择器过滤只排除 `builtin/auto`。
- Modify `src/context/models.tsx` — `setAutoMode` 只跳过 auto。
- Modify `src/context/local.tsx` — `recentModel` / `defaultModel` / `current` 只跳过 auto（default 允许 builtin 实时模型）。
- Test `src/utils/model-name.test.ts` — 新增两个纯函数单测。

---

## Task 1: TUI — 选择器按模型粒度排除 auto

**Files:**
- Modify: `packages/tui/src/component/dialog-model.tsx`
- Test: `packages/tui/test/cli/cmd/tui/model-options.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/tui/test/cli/cmd/tui/model-options.test.ts` 顶部 import 中加入 `isAutoModel`：

```ts
import {
  displayModelGroup,
  displayModelName,
  isAutoModel,
  joinDescription,
  sortModelOptions,
} from "../../../../src/component/dialog-model"
```

在文件末尾追加：

```ts
describe("isAutoModel", () => {
  test("only flags the built-in auto entry", () => {
    expect(isAutoModel("builtin", "auto")).toBe(true)
    expect(isAutoModel("builtin", "gpt-5")).toBe(false)
    expect(isAutoModel("anthropic", "auto")).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test test/cli/cmd/tui/model-options.test.ts --timeout 30000`（workdir: `packages/tui`）
Expected: FAIL — `isAutoModel` 未导出（`SyntaxError`/`undefined is not a function` 或编译报错）。

- [ ] **Step 3: 实现**

在 `packages/tui/src/component/dialog-model.tsx` 的 import 之后、`export function DialogModel` 之前加入模块级函数：

```ts
export function isAutoModel(providerID: string, modelID: string) {
  return providerID === "builtin" && modelID === "auto"
}
```

将 `options()` 内对收藏/最近使用的局部判定（原文件 `:32-35`）改为使用新函数：

```ts
    const favorites = connected() ? local.model.favorite() : []
    // Auto 关闭后,builtin/auto 不再是可选项,别让它出现在收藏/最近使用里。
    const recents = local.model.recent().filter((item) => !isAutoModel(item.providerID, item.modelID))
```

将 `:61` 的收藏过滤改为：

```ts
    const favoriteOptions = toOptions(
      favorites.filter((item) => !isAutoModel(item.providerID, item.modelID)),
      "收藏",
    )
```

移除提供商级过滤（原 `:69-72` 的注释与 `filter((provider) => !(autoMode() === false && provider.id === "builtin"))`），并在模型遍历里按模型粒度过滤 auto。改后：

```ts
    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "NovaWay",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([model]) => !isAutoModel(provider.id, model)),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: displayModelName(info.name ?? model, provider.id, info.cost?.input === 0),
            releaseDate: info.release_date,
            description: joinDescription(
              favorites.some((item) => item.providerID === provider.id && item.modelID === model)
                ? "(收藏)"
                : undefined,
              info.cost?.input === 0,
            ),
            category: connected() ? displayModelGroup(provider.id, provider.name) : undefined,
            disabled: provider.id === "NovaWay" && model.includes("-nano"),
            free: info.cost?.input === 0,
            onSelect() {
              onSelect(provider.id, model)
            },
          })),
          filter((option) => {
            if (!showSections) return true
            if (
              favorites.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            if (
              recents.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            return true
          }),
          (options) => sortModelOptions(options, props.providerID !== undefined),
        ),
      ),
    )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test test/cli/cmd/tui/model-options.test.ts --timeout 30000`（workdir: `packages/tui`）
Expected: PASS（含原有 `displayModelName`/`joinDescription`/`displayModelGroup`/`sortModelOptions` 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/tui/src/component/dialog-model.tsx packages/tui/test/cli/cmd/tui/model-options.test.ts
git commit -m "feat(tui): 关闭 Auto 后按模型粒度展示内置实时模型"
```

---

## Task 2: TUI — 回退默认 provider 允许内置实时模型

**Files:**
- Modify: `packages/tui/src/context/local.tsx`
- Test: `packages/tui/test/context/local.test.ts`

- [ ] **Step 1: 写失败测试**

将 `packages/tui/test/context/local.test.ts` 第 2 行 import 改为：

```ts
import { defaultSelectableModel, parseModel, recentModels } from "../../src/context/local"
```

在文件末尾追加：

```ts
test("内置提供商在手动模式下排除 auto，但保留实时模型作为兜底", () => {
  const builtin = {
    id: "builtin",
    models: { auto: { id: "auto" }, "gpt-5": { id: "gpt-5" } },
  }
  expect(defaultSelectableModel(builtin, { builtin: "auto" })).toBe("gpt-5")
  expect(defaultSelectableModel(builtin, {})).toBe("gpt-5")
})

test("仅含 auto 的内置提供商没有可兜底模型", () => {
  const builtin = { id: "builtin", models: { auto: { id: "auto" } } }
  expect(defaultSelectableModel(builtin, { builtin: "auto" })).toBeUndefined()
})

test("非内置提供商沿用默认模型或首个模型", () => {
  const anthropic = {
    id: "anthropic",
    models: { "claude-4": { id: "claude-4" }, "claude-3": { id: "claude-3" } },
  }
  expect(defaultSelectableModel(anthropic, { anthropic: "claude-3" })).toBe("claude-3")
  expect(defaultSelectableModel(anthropic, {})).toBe("claude-4")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test test/context/local.test.ts --timeout 30000`（workdir: `packages/tui`）
Expected: FAIL — `defaultSelectableModel` 未导出。

- [ ] **Step 3: 实现**

在 `packages/tui/src/context/local.tsx` 的 `recentModels` 函数之后、`export const { use: useLocal...` 之前加入：

```ts
export function defaultSelectableModel(
  provider: { id: string; models: Record<string, { id: string }> },
  defaults: Record<string, string | undefined>,
) {
  const preferred = defaults[provider.id]
  if (preferred && !(provider.id === "builtin" && preferred === "auto")) return preferred
  return Object.keys(provider.models).find((id) => !(provider.id === "builtin" && id === "auto"))
}
```

将 `fallbackModel` 末尾的默认 provider 段（原 `:253-263`）：

```ts
        // 内置提供商只承载 Auto 模型,手动模式不要回退到它
        const provider = sync.data.provider.find((item) => item.id !== "builtin")
        if (!provider) return undefined
        const defaultModel = sync.data.provider_default[provider.id]
        const firstModel = Object.values(provider.models)[0]
        const model = defaultModel ?? firstModel?.id
        if (!model) return undefined
        return {
          providerID: provider.id,
          modelID: model,
        }
```

替换为：

```ts
        // 优先非内置提供商;仅当没有其它提供商时,内置实时模型也可作为最后兜底(排除 auto)
        const provider =
          sync.data.provider.find((item) => item.id !== "builtin") ??
          sync.data.provider.find(
            (item) => defaultSelectableModel(item, sync.data.provider_default) !== undefined,
          )
        if (!provider) return undefined
        const model = defaultSelectableModel(provider, sync.data.provider_default)
        if (!model) return undefined
        return {
          providerID: provider.id,
          modelID: model,
        }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test test/context/local.test.ts --timeout 30000`（workdir: `packages/tui`）
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/tui/src/context/local.tsx packages/tui/test/context/local.test.ts
git commit -m "feat(tui): 回退链允许内置实时模型兜底"
```

---

## Task 3: App — 新增 `isAutoModel` 并接入选择器与上下文

**Files:**
- Modify: `packages/app/src/utils/model-name.ts`
- Modify: `packages/app/src/components/dialog-select-model.tsx`
- Modify: `packages/app/src/context/models.tsx`
- Modify: `packages/app/src/context/local.tsx`
- Test: `packages/app/src/utils/model-name.test.ts`

- [ ] **Step 1: 写失败测试**

将 `packages/app/src/utils/model-name.test.ts` 第 2 行 import 改为：

```ts
import { displayModelGroup, displayModelName, isAutoModel } from "./model-name"
```

在文件末尾追加：

```ts
describe("isAutoModel", () => {
  test("only flags the built-in auto entry", () => {
    expect(isAutoModel("builtin", "auto")).toBe(true)
    expect(isAutoModel("builtin", "gpt-5")).toBe(false)
    expect(isAutoModel("anthropic", "auto")).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test --preload ./happydom.ts src/utils/model-name.test.ts`（workdir: `packages/app`）
Expected: FAIL — `isAutoModel` 未导出。

- [ ] **Step 3: 实现 util**

在 `packages/app/src/utils/model-name.ts` 末尾追加：

```ts
export function isAutoModel(providerID: string, modelID: string) {
  return providerID === "builtin" && modelID === "auto"
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test --preload ./happydom.ts src/utils/model-name.test.ts`（workdir: `packages/app`）
Expected: PASS。

- [ ] **Step 5: 接入选择器**

在 `packages/app/src/components/dialog-select-model.tsx` 第 17 行 import 改为：

```ts
import { displayModelGroup, displayModelName, isAutoModel } from "@/utils/model-name"
```

将 `models` memo（`:35-45`）改为：

```ts
  const models = createMemo(() => {
    // Auto Mode ON 时，返回空列表（隐藏模型列表）
    if (modelsCtx.autoMode()) return []

    // Auto 关闭后，仅排除内置的 auto 条目，内置实时模型仍可选择。
    return model
      .list()
      .filter((m) => model.visible({ modelID: m.id, providerID: m.provider.id }))
      .filter((m) => !isAutoModel(m.provider.id, m.id))
      .filter((m) => (props.provider ? m.provider.id === props.provider : true))
  })
```

- [ ] **Step 6: 接入 models 上下文**

在 `packages/app/src/context/models.tsx` 顶部 import 区加入：

```ts
import { isAutoModel } from "@/utils/model-name"
```

将 `setAutoMode`（`:153-168`）改为：

```ts
    const setAutoMode = (value: boolean) => {
      if (value) {
        // 开启 Auto:记住当前手动模型(recent 按时间排序,取第一个非 auto 项)
        const manual = store.recent.find((item) => !isAutoModel(item.providerID, item.modelID))
        if (manual) setStore("lastManual", { ...manual })
      } else {
        // 关闭 Auto:恢复上次手动模型到最近使用首位,让 fallback 链第一个命中它
        const manual = store.lastManual
        if (manual && !isAutoModel(manual.providerID, manual.modelID)) {
          const uniq = uniqueBy([manual, ...store.recent], (x) => `${x.providerID}:${x.modelID}`)
          if (uniq.length > RECENT_LIMIT) uniq.pop()
          setStore("recent", uniq)
        }
      }
      setStore("autoMode", value)
    }
```

- [ ] **Step 7: 接入 local 上下文（recent / current）**

在 `packages/app/src/context/local.tsx` 顶部 import 区加入：

```ts
import { isAutoModel } from "@/utils/model-name"
```

删除局部定义（原 `:153`）：

```ts
    const isAutoModel = (item: ModelKey) => item.providerID === "builtin" && item.modelID === "auto"
```

将 `recentModel`（`:155-161`）改为：

```ts
    const recentModel = () => {
      for (const item of models.recent.list()) {
        // Auto 关闭后,仅跳过内置 auto 条目,内置实时模型仍可回退
        if (isAutoModel(item.providerID, item.modelID)) continue
        if (validModel(item)) return item
      }
    }
```

将 `current()`（`:233-250`）内的两处守卫改为：

```ts
        () => {
          const m = scope()?.model
          // 手动模式下忽略残留的内置 auto(Auto 开启时写入的)
          if (m && isAutoModel(m.providerID, m.modelID)) return undefined
          return m
        },
        () => {
          const m = agent.current()?.model
          if (m && isAutoModel(m.providerID, m.modelID)) return undefined
          return m
        },
```

- [ ] **Step 8: 运行相关测试与类型检查**

Run: `bun test --preload ./happydom.ts src/utils/model-name.test.ts`（workdir: `packages/app`）
Expected: PASS。

Run: `bun run typecheck`（workdir: `packages/app`）
Expected: 无错误。

- [ ] **Step 9: 提交**

```bash
git add packages/app/src/utils/model-name.ts packages/app/src/utils/model-name.test.ts packages/app/src/components/dialog-select-model.tsx packages/app/src/context/models.tsx packages/app/src/context/local.tsx
git commit -m "feat(app): 关闭 Auto 后展示内置实时模型"
```

---

## Task 4: App — 默认回退模型允许内置实时模型

**Files:**
- Modify: `packages/app/src/utils/model-name.ts`
- Modify: `packages/app/src/context/local.tsx`
- Test: `packages/app/src/utils/model-name.test.ts`

- [ ] **Step 1: 写失败测试**

将 `packages/app/src/utils/model-name.test.ts` 的 import 改为：

```ts
import { displayModelGroup, displayModelName, firstSelectableModel, isAutoModel } from "./model-name"
```

在文件末尾追加：

```ts
describe("firstSelectableModel", () => {
  const alwaysValid = () => true

  test("内置提供商排除 auto，返回首个实时模型", () => {
    const builtin = {
      id: "builtin",
      models: { auto: { id: "auto" }, "gpt-5": { id: "gpt-5" } },
    }
    expect(firstSelectableModel(builtin, { builtin: "auto" }, alwaysValid)).toBe("gpt-5")
    expect(firstSelectableModel(builtin, {}, alwaysValid)).toBe("gpt-5")
  })

  test("仅含 auto 的内置提供商没有可选模型", () => {
    const builtin = { id: "builtin", models: { auto: { id: "auto" } } }
    expect(firstSelectableModel(builtin, { builtin: "auto" }, alwaysValid)).toBeUndefined()
  })

  test("非内置提供商优先使用默认模型", () => {
    const anthropic = {
      id: "anthropic",
      models: { "claude-4": { id: "claude-4" }, "claude-3": { id: "claude-3" } },
    }
    expect(firstSelectableModel(anthropic, { anthropic: "claude-3" }, alwaysValid)).toBe("claude-3")
    expect(firstSelectableModel(anthropic, {}, alwaysValid)).toBe("claude-4")
  })

  test("默认模型无效时回退到首个有效模型", () => {
    const anthropic = {
      id: "anthropic",
      models: { "claude-4": { id: "claude-4" } },
    }
    const isValid = (id: string) => id === "claude-4"
    expect(firstSelectableModel(anthropic, { anthropic: "gone" }, isValid)).toBe("claude-4")
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test --preload ./happydom.ts src/utils/model-name.test.ts`（workdir: `packages/app`）
Expected: FAIL — `firstSelectableModel` 未导出。

- [ ] **Step 3: 实现 util**

在 `packages/app/src/utils/model-name.ts` 的 `isAutoModel` 之后追加：

```ts
export function firstSelectableModel(
  provider: { id: string; models: Record<string, { id: string }> },
  defaults: Record<string, string | undefined>,
  isValid: (modelID: string) => boolean,
) {
  const preferred = defaults[provider.id]
  if (preferred && !isAutoModel(provider.id, preferred) && isValid(preferred)) return preferred
  return Object.keys(provider.models).find((id) => !isAutoModel(provider.id, id) && isValid(id))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test --preload ./happydom.ts src/utils/model-name.test.ts`（workdir: `packages/app`）
Expected: PASS。

- [ ] **Step 5: 接入 defaultModel**

将 `packages/app/src/context/local.tsx` 的 import 改为：

```ts
import { firstSelectableModel, isAutoModel } from "@/utils/model-name"
```

将 `defaultModel`（原 `:163-179`）替换为：

```ts
    const defaultModel = () => {
      // 内置提供商承载 Auto + 网关发现的模型,手动模式只排除 auto;优先非内置提供商
      const defaults = providers.default()
      const ordered = [...providers.connected()].sort(
        (a, b) => Number(a.id === "builtin") - Number(b.id === "builtin"),
      )
      for (const provider of ordered) {
        const modelID = firstSelectableModel(provider, defaults, (id) =>
          validModel({ providerID: provider.id, modelID: id }),
        )
        if (!modelID) continue
        return { providerID: provider.id, modelID }
      }
    }
```

- [ ] **Step 6: 运行测试与类型检查**

Run: `bun test --preload ./happydom.ts src/utils/model-name.test.ts`（workdir: `packages/app`）
Expected: PASS。

Run: `bun run typecheck`（workdir: `packages/app`）
Expected: 无错误。

- [ ] **Step 7: 提交**

```bash
git add packages/app/src/utils/model-name.ts packages/app/src/utils/model-name.test.ts packages/app/src/context/local.tsx
git commit -m "feat(app): 默认回退模型允许内置实时模型"
```

---

## Task 5: 全量校验与手动验证

**Files:** 无（仅验证）

- [ ] **Step 1: TUI 全量类型检查与 lint**

Run: `bun run typecheck`（workdir: `packages/tui`）
Expected: 无错误。

Run: `bun lint`（workdir: `E:\AImoney\NovaWay-Matrix\novaway-coder`）
Expected: 无错误。

- [ ] **Step 2: App 全量类型检查**

Run: `bun run typecheck`（workdir: `packages/app`）
Expected: 无错误。

- [ ] **Step 3: 两端相关单测**

Run: `bun test test/cli/cmd/tui/model-options.test.ts test/context/local.test.ts --timeout 30000`（workdir: `packages/tui`）
Expected: PASS。

Run: `bun test --preload ./happydom.ts src/utils/model-name.test.ts`（workdir: `packages/app`）
Expected: PASS。

- [ ] **Step 4: 手动验证（按 `packages/app/AGENTS.md`）**

后端（workdir: `packages/novaway`）：

```bash
bun run --conditions=browser ./src/index.ts serve --port 4096
```

前端（workdir: `packages/app`）：

```bash
bun dev -- --port 4444
```

打开 `http://localhost:4444`，验证：
1. Auto 开启时，模型选择器为空并显示提示文案。
2. 关闭 Auto 后，"内置"分组出现网关实时模型（不含 `auto`）。
3. 选中某个内置实时模型后，它成为当前模型，并出现在"最近使用"。
4. 收藏该模型后重新加载页面，收藏仍在。
5. Auto 开→关切换后，仍恢复之前手动选择的内置实时模型。

- [ ] **Step 5: （可选）提交手动验证说明**

如手动验证发现需微调，按发现的文件重跑对应 Task 的单测与 typecheck 后再提交。

---

## 自检

- **Spec 覆盖**：TUI 选择器（Task 1）、TUI 回退链（Task 2）、App 选择器/最近使用/当前（Task 3）、App 默认回退（Task 4）、服务端无改动（符合）、验证（Task 5）。
- **占位符**：无 TBD/TODO，所有步骤含完整代码。
- **类型一致性**：`isAutoModel(providerID, modelID)` 在两端签名一致；`defaultSelectableModel`（TUI）与 `firstSelectableModel`（App）语义一致（内置排除 auto）。
