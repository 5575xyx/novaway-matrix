# 功能升级 - 产品需求文档

## Overview
- **Summary**: 学习并集成 OpenCode v1.17.11+ 的三个核心功能：会话快照与回滚、YOLO 自动权限批准模式、MCP OAuth 重连与修复。
- **Purpose**: 提升用户体验，解决会话不可逆、权限审批繁琐、MCP 认证不稳定等痛点。
- **Target Users**: OpenCode 用户，特别是进行长时间会话、需要频繁权限操作、使用 MCP 插件的开发者。

## Goals
- [ ] 实现会话快照机制：每次 agent 执行完成后自动捕获文件状态快照
- [ ] 实现会话回滚功能：支持回滚到任意历史消息节点，附带文件变更回退
- [ ] 在 session timeline 中添加回滚按钮入口
- [ ] 实现 YOLO 模式：支持自动批准权限请求
- [ ] 修复 MCP OAuth 重连问题：支持即使禁用时也能重连
- [ ] 优化 MCP OAuth 流程：请求 refresh-token scope、显示 OAuth 错误详情、按 server URL 隔离认证状态

## Non-Goals (Out of Scope)
- [ ] 不修改数据库迁移历史
- [ ] 不重构现有会话消息存储结构
- [ ] 不涉及云端部署相关改动
- [ ] 不修改 SDK 生成流程

## Background & Context
参考代码位于 `e:\AImoney\NovaWay-Matrix\novaway-coder\opencode-dev`，这是 OpenCode 的最新开发版本。当前项目位于 `e:\AImoney\NovaWay-Matrix\novaway-coder\packages`。

**现有实现分析：**

1. **会话回滚**：
   - `opencode-dev/packages/core/src/session/revert.ts` - 核心回滚逻辑
   - `opencode-dev/packages/core/src/snapshot.ts` - Git-based 快照服务
   - `opencode-dev/packages/app/src/pages/session/composer/session-revert-dock.tsx` - 回滚面板 UI
   - 当前项目已有基础回滚实现 (`packages/opencode/src/session/revert.ts`)，但缺少快照机制和完善的 UI 入口

2. **YOLO 模式**：
   - `opencode-dev/packages/opencode/src/cli/cmd/run.ts` - CLI 支持 `--auto`、`--yolo`、`--dangerously-skip-permissions` 参数
   - `opencode-dev/packages/app/src/context/permission.tsx` - Web UI 权限自动响应
   - 当前项目仅支持 `--dangerously-skip-permissions`，缺少 `--yolo` 别名和 Web UI 支持

3. **MCP OAuth**：
   - `opencode-dev/packages/core/src/config/mcp.ts` - MCP 配置 Schema
   - `opencode-dev/packages/app/src/context/mcp.ts` - MCP 切换逻辑
   - 当前项目的 MCP 实现较旧，缺少 OAuth 重连和隔离机制

## Functional Requirements

### FR-1: 会话快照机制
- **FR-1.1**: 在每次 agent 消息完成（包含文件修改）后自动捕获快照
- **FR-1.2**: 快照存储基于 Git tree 对象，内容寻址
- **FR-1.3**: 快照包含文件路径列表和对应的 tree ID
- **FR-1.4**: 支持配置禁用快照功能

### FR-2: 会话回滚功能
- **FR-2.1**: 支持回滚到指定消息 ID，撤销该消息之后的所有文件变更
- **FR-2.2**: 回滚前自动保存当前状态快照，支持撤销回滚
- **FR-2.3**: 计算回滚产生的文件 diff，显示给用户确认
- **FR-2.4**: 回滚后删除被回滚消息的内容

### FR-3: 回滚 UI 入口
- **FR-3.1**: 在 session timeline 的每条消息旁添加回滚按钮
- **FR-3.2**: 显示回滚面板，列出可回滚的文件变更
- **FR-3.3**: 支持一键撤销回滚操作

### FR-4: YOLO 模式
- **FR-4.1**: CLI 支持 `--yolo` 参数作为 `--dangerously-skip-permissions` 的别名
- **FR-4.2**: 支持 `--auto` 参数，自动批准未明确拒绝的权限请求
- **FR-4.3**: Web UI 支持会话级别和目录级别的自动权限批准开关

### FR-5: MCP OAuth 重连
- **FR-5.1**: 即使 MCP server 被禁用也能触发 OAuth 重连
- **FR-5.2**: OAuth 请求时自动包含 refresh-token scope
- **FR-5.3**: 显示 OAuth 完成时的详细错误信息，而非通用失败提示
- **FR-5.4**: MCP 认证状态按每个 server URL 隔离，防止跨 server 泄漏

## Non-Functional Requirements
- **NFR-1**: 快照操作不应阻塞用户操作，异步执行
- **NFR-2**: 回滚操作应在 5 秒内完成（普通项目规模）
- **NFR-3**: OAuth 重连失败不应影响其他 MCP server 的正常工作
- **NFR-4**: 所有新功能应保持向后兼容

## Constraints
- **Technical**: 
  - 项目使用 SolidJS 作为前端框架
  - 后端使用 Effect v4 + Drizzle SQLite
  - Git 作为版本控制和快照存储
- **Dependencies**: 
  - 需要同步更新 `@opencode-ai/core` 和 `@opencode-ai/sdk` 包
  - MCP OAuth 依赖 OAuth2.0 协议支持

## Assumptions
- [ ] 用户项目是 Git 仓库（快照依赖 Git）
- [ ] 用户已配置正确的 MCP server 地址和 OAuth 凭据
- [ ] 现有会话数据结构兼容新的快照字段

## Acceptance Criteria

### AC-1: 会话快照自动捕获
- **Given**: 项目是 Git 仓库，agent 完成一次消息回复并修改了文件
- **When**: 消息状态变为 completed
- **Then**: 系统自动捕获当前文件状态快照并关联到该消息
- **Verification**: `programmatic` - 检查数据库中消息记录包含 snapshot 字段

### AC-2: 会话回滚到历史消息
- **Given**: 会话有多个消息，其中包含文件修改
- **When**: 用户点击某条消息旁的回滚按钮并确认
- **Then**: 该消息之后的文件变更被回退，会话状态恢复到该时间点
- **Verification**: `programmatic` - 验证文件内容恢复到回滚前状态，消息列表正确截断

### AC-3: 回滚撤销功能
- **Given**: 用户已执行回滚操作
- **When**: 用户点击"撤销回滚"按钮
- **Then**: 文件和会话状态恢复到回滚前的状态
- **Verification**: `programmatic` - 验证文件和消息状态恢复

### AC-4: YOLO 模式自动批准权限
- **Given**: 用户使用 `--yolo` 参数启动会话
- **When**: agent 请求文件读写等权限
- **Then**: 系统自动批准权限请求，无需用户确认
- **Verification**: `programmatic` - 验证权限事件自动回复为 "once"

### AC-5: MCP OAuth 重连
- **Given**: MCP server 的 OAuth token 过期
- **When**: 用户尝试使用该 MCP 的工具
- **Then**: 系统自动触发 OAuth 重连流程
- **Verification**: `human-judgment` - 验证 OAuth 流程正常启动并获取新 token

### AC-6: OAuth 错误详情显示
- **Given**: OAuth 认证过程中发生错误（如用户拒绝授权）
- **When**: OAuth 流程失败
- **Then**: 显示具体的错误原因，而非通用失败提示
- **Verification**: `human-judgment` - 验证错误提示清晰明确

## Open Questions
- [ ] 快照存储的清理策略是什么？何时删除旧快照？
- [ ] 回滚操作是否需要限制在非活跃会话上执行？
- [ ] MCP OAuth 的 refresh-token 过期后如何处理？