# 功能升级 - 实现计划

## [x] Task 1: 会话快照服务实现

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 创建基于 Git 的快照服务，支持 capture、diff、restore、checkout 操作
  - 使用内容寻址存储文件状态（Git tree 对象）
  - 支持按路径范围捕获快照
  - 集成到现有的 Effect 服务体系中
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `programmatic` TR-1.1: 测试 snapshot.capture() 返回有效的快照 ID
  - `programmatic` TR-1.2: 测试 snapshot.diff() 正确生成文件差异
  - `programmatic` TR-1.3: 测试 snapshot.restore() 正确恢复文件状态
- **Notes**: 参考 `opencode-dev/packages/core/src/snapshot.ts` 的实现模式

## [x] Task 2: 会话回滚逻辑完善

- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 修改 `packages/opencode/src/session/revert.ts`，集成新的快照服务
  - 实现回滚计划生成：计算需要恢复的文件及其目标快照
  - 实现回滚 staging：先恢复文件，计算 diff，发布回滚事件
  - 实现回滚 commit：确认回滚，删除被回滚的消息
  - 实现回滚 clear：撤销回滚，恢复到回滚前状态
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `programmatic` TR-2.1: 测试 revert.stage() 正确计算文件恢复列表
  - `programmatic` TR-2.2: 测试 revert.commit() 正确删除被回滚消息
  - `programmatic` TR-2.3: 测试 revert.clear() 正确撤销回滚
- **Notes**: 参考 `opencode-dev/packages/core/src/session/revert.ts` 的实现

## [x] Task 3: 回滚 HTTP API 路由

- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - 在 HTTP API 中添加 `/session/:sessionID/revert` 端点
  - 添加 `/session/:sessionID/unrevert` 端点
  - 实现对应的请求处理逻辑
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `programmatic` TR-3.1: 测试 POST /session/:sessionID/revert 返回 200 OK
  - `programmatic` TR-3.2: 测试 POST /session/:sessionID/unrevert 返回 200 OK
- **Notes**: 参考 `opencode-dev/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`

## [ ] Task 4: 回滚 UI 入口与面板

- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - 在 session timeline 的每条消息旁添加回滚按钮
  - 创建回滚面板组件，显示可回滚的文件变更列表
  - 实现回滚确认和撤销回滚功能
  - 添加平滑的展开/收起动画效果
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `human-judgment` TR-4.1: 验证回滚按钮在 timeline 中可见且可点击
  - `human-judgment` TR-4.2: 验证回滚面板正确显示文件变更
  - `human-judgment` TR-4.3: 验证撤销回滚按钮功能正常
- **Notes**: 参考 `opencode-dev/packages/app/src/pages/session/composer/session-revert-dock.tsx`

## [x] Task 5: YOLO 模式 CLI 支持

- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 在 `packages/opencode/src/cli/cmd/run.ts` 中添加 `--yolo` 参数
  - 添加 `--auto` 参数作为 `--dangerously-skip-permissions` 的友好别名
  - 实现 auto-approve 逻辑：自动批准所有权限请求
- **Acceptance Criteria Addressed**: AC-4
- **Test Requirements**:
  - `programmatic` TR-5.1: 测试 `--yolo` 参数被正确解析
  - `programmatic` TR-5.2: 测试 `--auto` 参数被正确解析
  - `programmatic` TR-5.3: 测试权限请求在 YOLO 模式下自动批准
- **Notes**: 参考 `opencode-dev/packages/opencode/src/cli/cmd/run.ts` 中的 auto 逻辑

## [x] Task 6: YOLO 模式 Web UI 支持

- **Priority**: medium
- **Depends On**: Task 5
- **Description**:
  - 创建权限自动批准的 SolidJS context
  - 实现会话级别和目录级别的自动批准开关
  - 监听 `permission.asked` 事件，自动响应
  - 添加状态持久化（localStorage）
- **Acceptance Criteria Addressed**: AC-4
- **Test Requirements**:
  - `human-judgment` TR-6.1: 验证自动批准开关在 UI 中可见
  - `programmatic` TR-6.2: 测试权限事件自动响应逻辑
- **Notes**: 参考 `opencode-dev/packages/app/src/context/permission.tsx`

## [x] Task 7: MCP OAuth 配置 Schema 更新

- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 更新 `packages/core/src/v1/config/mcp.ts` 中的 OAuth Schema
  - 添加 scope 字段支持（用于请求 refresh-token）
  - 添加 callback_port 和 redirect_uri 字段
  - 更新 Remote 配置以支持 OAuth 开关
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `programmatic` TR-7.1: 测试 OAuth Schema 正确解析包含 scope 的配置
  - `programmatic` TR-7.2: 测试 OAuth Schema 正确解析 redirect_uri
- **Notes**: 参考 `opencode-dev/packages/core/src/config/mcp.ts` 和 `opencode-dev/packages/core/src/v1/config/mcp.ts`

## [x] Task 8: MCP OAuth 重连机制

- **Priority**: medium
- **Depends On**: Task 7
- **Description**:
  - 修改 MCP 连接逻辑，支持即使禁用时也能触发 OAuth 重连
  - 在 OAuth 请求中自动包含 refresh-token scope
  - 改进 OAuth 错误处理，显示详细错误信息
- **Acceptance Criteria Addressed**: AC-5, AC-6
- **Test Requirements**:
  - `human-judgment` TR-8.1: 验证禁用的 MCP server 可以触发 OAuth 重连
  - `human-judgment` TR-8.2: 验证 OAuth 错误显示具体原因
- **Notes**: 需要检查 MCP 连接和认证的核心逻辑

## [x] Task 9: MCP 认证状态隔离

- **Priority**: medium
- **Depends On**: Task 7
- **Description**:
  - 修改 MCP 认证状态存储，按 server URL 隔离
  - 防止一个 server 的认证状态泄漏到另一个 server
  - 更新 MCP 状态管理逻辑
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `programmatic` TR-9.1: 测试不同 URL 的 MCP server 认证状态互不影响
- **Notes**: 需要检查 MCP 状态管理的现有实现

## [x] Task 10: 集成测试与验证

- **Priority**: medium
- **Depends On**: Task 1-9
- **Description**:
  - 运行现有测试套件，确保新功能不破坏现有功能
  - 编写集成测试覆盖核心场景
  - 验证所有 acceptance criteria
- **Acceptance Criteria Addressed**: All
- **Test Requirements**:
  - `programmatic` TR-10.1: 所有现有测试通过
  - `programmatic` TR-10.2: 新功能集成测试通过
- **Notes**: 运行 `bun test` 在相关包目录下
