## 项目上下文摘要（进化自动写盘优化与 scope 整理）

生成时间：2026-07-27

### 1. 相似实现分析

- **实现1**: `packages/opencode/src/evolution/service.ts:606-638`
  - 模式：`applyToDisk` 出错时更新 `validation_status=failed` 并抛出错误。
  - 可复用：候选状态保持 `pending`，天然支持转人工确认。
  - 需注意：调用方 `session/prompt.ts` 使用 `Effect.ignore` 吞掉了错误。

- **实现2**: `packages/opencode/src/memory/scope.ts`
  - 模式：记忆有明确的 `global/project/session` scope 判定与 `scopeLabel` 显示。
  - 可复用：scope 分类逻辑和 UI 标签展示方式。
  - 需注意：进化目前只有 heuristic 全局检测，缺少显式 scope 字段。

- **实现3**: `packages/app/src/pages/layout.tsx:344-448`
  - 模式：`useSDKNotificationToasts` 监听 SDK 事件并弹出 toast。
  - 可复用：通过 Bus/SDK 事件把后端错误通知到前端。
  - 需注意：进化已有 `evolution.updated` 事件用于刷新列表。

### 2. 项目约定

- **命名约定**: 配置字段 snake_case，Effect 服务方法 camelCase，Solid 组件大驼峰。
- **文件组织**: 业务逻辑在 `packages/opencode/src/evolution`，UI 在 `packages/app/src/components`。
- **代码风格**: 优先使用 Effect.fn、早期返回、函数式数组方法；注释说明意图。

### 3. 可复用组件清单

- `packages/opencode/src/evolution/service.ts`: `applyToDisk`, `buildDryRun`, `writeDryRun`, `targetFile`。
- `packages/opencode/src/evolution/schema.ts`: `Candidate`, `CandidateProposal`, `CandidateUpdate`。
- `packages/opencode/src/config/evolution.ts`: `Info` schema 与 `resolve`。
- `packages/app/src/context/global-sync/memory-evolution-events.ts`: 事件刷新逻辑。
- `packages/app/src/components/memory-evolution-panel.tsx`: 候选列表与状态展示 UI。
- `@opencode-ai/ui/toast`: `showToast`, `toaster`。

### 4. 测试策略

- **测试框架**: bun test + Effect test patterns。
- **参考文件**: `packages/opencode/test/evolution/service.test.ts`。
- **覆盖要求**: 自动写盘失败保留 pending、scope 判定、global 写盘路径。

### 5. 依赖和集成点

- **外部依赖**: Effect v4, SolidJS, `@opencode-ai/ui/toast`。
- **内部依赖**: Evolution service ↔ Session prompt ↔ Config ↔ App UI。
- **集成方式**: Bus 事件 `evolution.updated` 串联前后端状态同步。
- **配置来源**: `cfg.evolution`（含 `auto_apply_file`）。

### 6. 关键风险点

- **提示机制**: 后端失败必须经 Bus/SDK 通知到前端，不能阻塞对话。
- **全局路径**: `Global.Path.config` 下需要自动创建 `.novaway` 子目录。
- **scope 兼容**: 现有候选通过 `tags.includes("global")` 判断，新增显式 scope 字段需兼容旧数据。
