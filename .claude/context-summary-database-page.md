## 项目上下文摘要（数据库页面集成）

生成时间：2026-07-05

### 1. 相似实现分析

- **实现1**: packages/app/src/pages/layout.tsx:165-178
  - 模式：使用 `createStore` + persisted 管理设置页面状态（open/directory/initialTab）
  - 可复用：设置页面作为全屏覆盖层的切换模式
  - 需注意：状态更新使用 `batch` 包装为原子操作

- **实现2**: packages/app/src/components/dialog-settings.tsx:32-120
  - 模式：独立页面组件，接收 `onBack` 回调，内部有返回按钮
  - 可复用：返回按钮和页面布局结构
  - 需注意：使用 `useLanguage` 做国际化

- **实现3**: packages/app/src/components/titlebar.tsx:265-278
  - 模式：顶栏使用 `Button` + `Icon` + `TooltipKeybind` 组合
  - 可复用：图标按钮的样式和行为模式
  - 需注意：通过 `command.trigger("settings.open")` 触发命令

- **实现4**: packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts
  - 模式：通过 `registry.tools()` 获取可用工具并暴露为 HTTP API
  - 可复用：工具列表接口的构建方式
  - 需注意：调用工具需要 ToolContext，直接调用较复杂；建议直接通过 MCP client.callTool

### 2. 项目约定

- **命名约定**: 组件名大写驼峰；页面组件默认导出；状态函数以 `open`/`close`/`toggle` 命名
- **文件组织**: 页面放在 `packages/app/src/pages/`；顶栏组件在 `packages/app/src/components/titlebar.tsx`
- **导入顺序**: 外部库 → opencode ui → 内部 context/utils → 相对组件
- **代码风格**: SolidJS + TypeScript；Tailwind CSS；不使用分号；printWidth 120
- **状态管理**: SolidJS `createStore` + `persisted` 用于持久化；`batch` 用于原子更新

### 3. 可复用组件清单

- `packages/app/src/components/titlebar.tsx`: 顶栏图标按钮参考实现
- `packages/app/src/components/dialog-settings.tsx`: 返回按钮和页面布局参考
- `packages/app/src/pages/layout.tsx`: 全屏覆盖层状态管理和命令注册
- `@opencode-ai/ui/button`: 按钮组件
- `@opencode-ai/ui/icon`: 图标组件
- `@opencode-ai/ui/tooltip`: 工具提示组件
- `packages/app/src/utils/server.ts`: SDK 创建工具
- `packages/opencode/src/mcp/index.ts`: MCP 服务，可扩展 callTool 方法

### 4. 测试策略

- **测试框架**: 项目使用 bun test，但前端测试较少
- **验证方式**: `bun typecheck`（包目录内） + `bun lint`
- **覆盖要求**: 类型检查通过，无新增 lint 错误；数据库页面 UI 至少能渲染

### 5. 依赖和集成点

- **外部依赖**: SolidJS, @solidjs/router, @tanstack/solid-query, effect, @modelcontextprotocol/sdk
- **内部依赖**: packages/opencode 的 MCP 服务；packages/app 的 GlobalSDK/Server 上下文
- **集成方式**:
  - 前端通过顶栏按钮触发命令打开数据库页面
  - 数据库页面作为全屏覆盖层渲染在 layout 中
  - 后端新增 `POST /experimental/tool/call` 调用 MCP 工具
  - 前端通过 fetch/SDK 调用后端 API 与 DBX MCP 交互
- **配置来源**: `packages/opencode/src/config/config.ts` 中的 `DEFAULT_MCP_SERVERS.dbx`

### 6. 技术选型理由

- **为什么用覆盖层而不是新路由**: 设置页面已采用此模式，用户明确要求"像设置页面这样"，保持一致性
- **为什么新增后端 API 而不是直接前端调 MCP**: MCP client 运行在后端，前端无直接访问能力；通过后端 API 是标准做法
- **为什么直接 client.callTool 而不是 registry.execute**: ToolRegistry 的工具 execute 需要 AI session 上下文；直接 callTool 更轻量

### 7. 关键风险点

- **并发问题**: 多个数据库查询同时执行时的取消和状态管理
- **边界条件**: DBX MCP 未连接时页面需要友好提示
- **性能瓶颈**: 大量查询结果展示需考虑分页或虚拟滚动
- **安全考虑**: tool call API 需要鉴权中间件，避免未授权调用危险工具； dangerously SQL operations 已由 DBX 默认拦截
