# XYMT-AUTO 发布功能集成 - 开发者指南

## 概述

本指南介绍如何在 opencode 项目中集成和扩展 XYMT-AUTO 发布功能。

## 架构概述

### 1. MCP 服务器架构

```
┌─────────────────────────────────────────────────────────┐
│                    opencode 应用                        │
├─────────────────────────────────────────────────────────┤
│  Pulse 助手面板  │  发布面板  │  代理管理  │  配置管理  │
├─────────────────────────────────────────────────────────┤
│                    MCP 客户端                           │
├─────────────────────────────────────────────────────────┤
│  小红书 MCP 服务器  │  微信公众号 MCP 服务器            │
└─────────────────────────────────────────────────────────┘
```

### 2. 组件结构

```
packages/app/src/pages/pulse/
├── PulseAssistant.tsx      # 主助手面板
├── PulseChatInput.tsx      # 聊天输入组件
├── PublishModal.tsx         # 发布模态框
├── AccountManagerModal.tsx  # 账号管理模态框
├── AddAccountModal.tsx      # 添加账号模态框
└── CheckLoginResultModal.tsx # 登录检查结果模态框
```

## 开发环境设置

### 1. 克隆项目

```bash
git clone <repository-url>
cd novaway-coder
```

### 2. 安装依赖

```bash
# 安装根依赖
bun install

# 安装应用依赖
cd packages/app
bun install
```

### 3. 启动开发服务器

```bash
# 启动后端服务
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096

# 启动前端服务
cd packages/app
bun dev -- --port 4444
```

## 代码结构

### 1. MCP 配置

**文件**: `novaway.json`

```json
{
  "mcp": {
    "xiaohongshu": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-p", "18060:18060", "xiaohongshu-mcp:latest"],
      "enabled": true,
      "timeout": 10000
    },
    "wechat-official": {
      "command": "npx",
      "args": ["-y", "wechat-official-account-mcp@latest", "mcp"],
      "environment": {
        "WECHAT_APP_ID": "${WECHAT_APP_ID}",
        "WECHAT_APP_SECRET": "${WECHAT_APP_SECRET}"
      },
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

### 2. 代理配置

**文件**: `packages/opencode/src/agent/agent.ts`

```typescript
"pulse-orchestrator": {
  name: "pulse-orchestrator",
  description: "运营主 Agent，分析用户意图并协调子 Agent 完成任务",
  mode: "primary",
  native: true,
  color: "#FF6B6B",
  prompt: PROMPT_PULSE_ORCHESTRATOR,
  permission: Permission.merge(
    defaults,
    user,
    Permission.fromConfig({
      mcp: {
        xiaohongshu: "allow",
        "wechat-official": "allow",
      },
    }),
  ),
  options: {
    category: "运营",
    displayName: "运营主智能体",
  },
},
```

### 3. 发布面板组件

**文件**: `packages/app/src/pages/pulse/PublishModal.tsx`

```typescript
export function PublishModal() {
  const dialog = useDialog()
  const platform = usePlatformAccounts()

  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set())
  const [title, setTitle] = createSignal("")
  const [content, setContent] = createSignal("")
  const [publishing, setPublishing] = createSignal(false)

  const handlePublish = async () => {
    if (selectedAccounts().length === 0 || !content().trim()) return
    setPublishing(true)
    // 发布逻辑
    setPublishing(false)
  }

  return (
    <Dialog title="发布内容">
      {/* 发布表单 */}
    </Dialog>
  )
}
```

## 扩展指南

### 1. 添加新的 MCP 服务器

#### 1.1 创建 MCP 服务器

参考 XYMT-AUTO 项目的 `xiaohongshu-mcp` 实现：

```go
// main.go
package main

import (
    "github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
    server := mcp.NewServer(
        &mcp.Implementation{
            Name:    "my-mcp-server",
            Version: "1.0.0",
        },
        nil,
    )

    // 注册工具
    registerTools(server)

    // 启动服务器
    server.ListenAndServe()
}
```

#### 1.2 注册到 opencode

在 `novaway.json` 中添加配置：

```json
{
  "mcp": {
    "my-server": {
      "command": "path/to/my-server",
      "args": ["--flag", "value"],
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

### 2. 添加新的发布平台

#### 2.1 创建平台账号上下文

**文件**: `packages/app/src/context/platform-accounts.tsx`

```typescript
export const PLATFORM_LIST: PlatformInfo[] = [
  // 现有平台...
  { id: "new-platform", name: "新平台", icon: newPlatformIcon, color: "#000000", loginUrl: "...", viewUrl: "..." },
]
```

#### 2.2 实现发布逻辑

```typescript
const publish = async (accountId: string, input: any) => {
  if (!(window as any).api?.platform?.publish) return null
  return (window as any).api.platform.publish({ accountId, publishInput: input })
}
```

### 3. 添加新的代理工具

#### 3.1 更新代理提示

**文件**: `packages/opencode/src/agent/prompt/pulse-orchestrator.txt`

```
## 发布工具
当用户需要发布内容时，你可以使用以下 MCP 工具：

### 新平台发布
1. `new_platform_check_login` - 检查登录状态
2. `new_platform_publish` - 发布内容
```

#### 3.2 更新代理权限

**文件**: `packages/opencode/src/agent/agent.ts`

```typescript
permission: Permission.merge(
  defaults,
  user,
  Permission.fromConfig({
    mcp: {
      xiaohongshu: "allow",
      "wechat-official": "allow",
      "new-platform": "allow",
    },
  }),
),
```

## 测试指南

### 1. 单元测试

```bash
# 运行单元测试
cd packages/opencode
bun test

# 运行特定测试
bun test --testNamePattern="pulse-orchestrator"
```

### 2. 集成测试

```bash
# 运行集成测试
cd packages/app
bun test:e2e:local
```

### 3. 手动测试

1. 启动开发服务器
2. 进入 Pulse 模式
3. 测试发布功能
4. 验证 MCP 服务器连接

## 调试指南

### 1. 查看 MCP 服务器日志

```bash
# 小红书 MCP 服务器日志
docker logs <容器ID>

# 微信公众号 MCP 服务器日志
pm2 logs wechat-mcp
```

### 2. 查看 opencode 日志

```bash
# 查看应用日志
tail -f ~/.opencode/logs/opencode.log
```

### 3. 调试 MCP 工具调用

在 Pulse 助手面板中输入：

```
调试 MCP 工具调用：检查小红书登录状态
```

## 性能优化

### 1. MCP 服务器优化

- 使用连接池管理 MCP 连接
- 实现请求缓存
- 优化超时设置

### 2. UI 组件优化

- 使用 `createStore` 代替多个 `createSignal`
- 实现虚拟滚动
- 优化重渲染

## 安全考虑

### 1. 凭证管理

- 使用环境变量存储敏感信息
- 不要将凭证提交到版本控制
- 实现凭证轮换机制

### 2. 权限控制

- 实现最小权限原则
- 定期审查权限设置
- 监控异常访问

## 部署指南

### 1. 开发环境部署

```bash
# 启动开发服务器
bun dev
```

### 2. 生产环境部署

```bash
# 构建应用
bun run build

# 启动生产服务器
bun run start
```

### 3. Docker 部署

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

## 贡献指南

### 1. 代码风格

- 使用 TypeScript 严格模式
- 遵循 ESLint 规则
- 编写单元测试

### 2. 提交规范

- 使用语义化提交信息
- 每个提交只做一件事
- 编写清晰的提交描述

### 3. 代码审查

- 提交前自我审查
- 请求他人审查
- 处理审查反馈
