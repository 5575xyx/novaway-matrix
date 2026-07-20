# 数据库可视化页面与测试修复 - 验证报告

## 任务概述

按方案 A 在 NovaWay 应用顶栏添加数据库入口按钮，点击后进入 SolidJS 数据库可视化页面；同时修复相关测试失败。

## 实现内容

### 前端界面

- **顶栏按钮**: `packages/app/src/components/titlebar.tsx`
  - 新增 `databaseOpen` props
  - 添加数据库图标按钮，点击触发 `database.open` 命令
  - 页面打开时按钮高亮

- **数据库页面**: `packages/app/src/pages/database.tsx`
  - 左侧连接列表，支持刷新
  - 连接选择下拉框
  - SQL 查询编辑器（多行文本框）
  - 执行按钮与结果展示区域
  - 返回按钮调用 `onBack`

- **布局集成**: `packages/app/src/pages/layout.tsx`
  - 新增 `databasePage.open` 状态
  - 注册 `database.open` / `database.close` 命令
  - 数据库页面以绝对定位覆盖层显示
  - 使用 `batch` 进行原子状态更新

- **工具调用封装**: `packages/app/src/utils/tool-call.ts`
  - 封装 `callTool` 函数
  - 通过 `POST /experimental/tool/call` 调用 MCP 工具
  - 支持 directory 查询参数和 Basic 认证

- **图标组件**: `packages/ui/src/components/icon.tsx`
  - 新增 `database`、`refresh`、`play` 图标

- **国际化文案**: `packages/app/src/i18n/en.ts`、`packages/app/src/i18n/zh.ts`
  - 添加数据库页面相关翻译键

### 后端 API

- **MCP 工具调用端点**: `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts`
  - 新增 `POST /experimental/tool/call`
  - 调用 `MCP.callTool` 执行指定工具
  - 复用现有的 WorkspaceRouting 与 Authorization 中间件

### 测试修复

- `packages/opencode/test/session/prompt.test.ts`
  - 修复 `writeConfig` 写入的配置文件名：从 `opencode.json` 改为 `novaway.json`
  - 该修复使 LLM provider 配置能被正确加载，解决断言失败

- `packages/opencode/test/session/snapshot-tool-race.test.ts`
  - 配合上述配置修复后测试通过

## 验证结果

### ✅ 类型检查

```bash
cd packages/opencode && bun typecheck  # 通过
cd packages/app && bun typecheck       # 通过
```

### ✅ 单元测试

```bash
cd packages/opencode
bun test --timeout 60000 session/prompt.test.ts            # 42 pass, 13 skip, 0 fail
bun test --timeout 60000 session/snapshot-tool-race.test.ts # 1 pass, 0 fail
```

> 注：`prompt.test.ts` 中 `loop calls LLM and returns assistant message` 用例耗时约 28.5 秒，需设置 60 秒超时才能稳定通过。

### ⚠️ 静态分析

对修改文件运行 oxlint 发现 30 个 warning，均为原有代码问题或低风险提示，未引入 error：

- `titlebar.tsx`、`layout.tsx` 中已存在的 `consistent-return`、`unbound-method`、`no-floating-promises` 等 warning
- `icon.tsx` 中已有的 `no-unsafe-type-assertion`
- `prompt.test.ts` 中已存在的测试辅助函数相关 warning

整个仓库运行 `bun lint` 因 oxlint 内存分配失败（VirtualAlloc failed），判定为本地环境资源限制，非代码问题。

### ⚠️ 其他测试

`packages/app` 的 `file-tree.test.ts` 存在一个预先存在的失败（Client-only API called on the server side），与本次改动无关。

## 自检报告

### 完整性

- ✅ 顶栏数据库入口按钮已实现
- ✅ 数据库页面包含连接列表、查询编辑器、结果展示
- ✅ 返回按钮可关闭数据库页面
- ✅ 后端 MCP 工具调用 API 已暴露
- ✅ 中英双语翻译已补充

### 质量

- ✅ 使用项目现有 UI 组件（Button、Icon、Spinner、TextField、Select）
- ✅ 遵循 SolidJS 与项目状态管理约定
- ✅ 复用 workspace routing 与认证中间件

### 纪律

- ✅ 未引入不必要的抽象
- ✅ 改动范围聚焦在数据库页面与必要支撑代码

## 结论

**状态**: ✅ DONE

数据库可视化页面已实现并通过核心验证；相关测试失败已修复。建议下一步在 Electron 打包环境中进行端到端验证。
