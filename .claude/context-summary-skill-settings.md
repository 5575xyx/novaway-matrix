## 项目上下文摘要（设置页内置技能显示与 .opencode 引用清理）

生成时间：2026-07-07

### 1. 相似实现分析

- **实现1**: `packages/opencode/src/skill/index.ts:135-141`
  - 模式：Skill.Info schema 已包含 `builtIn?: boolean` 字段
  - 可复用：内置技能注册时显式设置 `builtIn: true`
  - 需注意：含辅助文件的内置技能 location 为实际源/缓存路径，不是 `"<built-in>"`

- **实现2**: `packages/opencode/src/server/routes/instance/httpapi/handlers/settings.ts:234-264`
  - 模式：settings skillList 返回 `SettingsMarkdownAsset` 数组
  - 可复用：在返回体中透传 `builtIn` 标志
  - 需注意：此前仅返回 `editable: false`，前端靠 location 字符串判断

- **实现3**: `packages/app/src/components/settings-runtime.tsx:1894-1900`
  - 模式：前端使用 `skill.location === "<built-in>"` 判断内置技能
  - 可复用：已有 `builtIn` 字段在部分 agent skill 数据结构中
  - 需注意：必须替换为 API 返回的显式 `builtIn` 字段

### 2. 项目约定

- **命名约定**: schema 字段使用 camelCase；文件/目录使用 kebab-case
- **文件组织**: HttpApi schema 在 `groups/*.ts`，handler 在 `handlers/*.ts`，前端组件在 `packages/app/src/components`
- **代码风格**: Prettier semi:false, printWidth:120；Effect 使用 `Effect.fn`/`Effect.fnUntraced`
- **SDK 生成**: API schema 变更后必须执行 `./script/generate.ts`

### 3. 可复用组件清单

- `SettingsMarkdownAsset`: settings API 通用 markdown 资源 schema
- `Skill.Service`: 提供 `skill.all()` 获取所有技能（含 builtIn 标志）
- `matchesSourceFilter`: 前端内置/自定义过滤器辅助函数

### 4. 测试策略

- **测试框架**: bun:test
- **测试模式**: Effect 测试使用 `testEffect`/`it.live`
- **参考文件**: `packages/opencode/test/skill/skill.test.ts`
- **覆盖要求**: 正常流程 + 边界条件 + 错误处理

### 5. 依赖和集成点

- **外部依赖**: effect/unstable/httpapi、@hey-api/openapi-ts
- **内部依赖**: `packages/core` Global/Path、`packages/app` SDK
- **集成方式**: HTTP API → 生成 SDK → 前端 SolidJS 组件
- **配置来源**: `Global.Path.config` 指向 `~/.config/novaway`

### 6. 技术选型理由

- **为什么用显式 builtIn 字段**: 避免 location 字符串在不同内置技能间不一致（辅助文件技能有真实路径）
- **优势**: 前后端语义一致、可维护、不易误判
- **劣势和风险**: 需要重新生成 SDK，diff 较大

### 7. 关键风险点

- **边界条件**: 自定义 skill 与内置 skill 同名时的覆盖行为
- **性能瓶颈**: 无显著瓶颈
- **安全考虑**: builtIn 标志仅用于展示，不影响权限判定
