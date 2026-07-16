# XYMT-AUTO 发布功能集成 - 详细实现计划

## 1. 执行摘要

本计划详细说明如何将 XYMT-AUTO 项目的小红书和微信公众号自动发布功能集成到 opencode 的 Pulse 助手面板中。通过 MCP 服务器集成，使 orchestrator 代理能够直接调用发布工具。

## 2. 前置条件

### 2.1 环境要求

- Go 1.24+ (用于构建 xiaohongshu-mcp)
- Node.js 18+ (用于 wechat-official-account-mcp)
- bun (包管理器)
- Windows/Linux/macOS 支持

### 2.2 依赖检查

```bash
# 检查 Go 版本
go version

# 检查 Node.js 版本
node --version

# 检查 bun 版本
bun --version
```

## 3. 阶段 1: 小红书 MCP 服务器集成

### 3.1 构建 xiaohongshu-mcp

#### 3.1.1 克隆和构建

```bash
# 进入 XYMT-AUTO 目录
cd E:\AImoney\NovaWay-Matrix\novaway-coder\XYMT-AUTO\xiaohongshu-mcp

# 下载依赖
go mod download

# 构建二进制文件
go build -o xiaohongshu-mcp.exe .

# 测试构建
./xiaohongshu-mcp.exe -help
```

#### 3.1.2 配置说明

- **端口**: 默认 18060 (HTTP 模式)
- **无头模式**: 默认启用 (适合服务器环境)
- **浏览器路径**: 可通过 `-bin` 参数或 `ROD_BROWSER_BIN` 环境变量指定

### 3.2 测试 MCP 服务器

#### 3.2.1 启动服务器

```bash
# 启动 MCP 服务器
./xiaohongshu-mcp.exe -headless true -port :18060
```

#### 3.2.2 测试工具列表

服务器提供以下 MCP 工具：

1. `check_login_status` - 检查登录状态
2. `get_login_qrcode` - 获取登录二维码
3. `create_image_note` - 发布图文笔记
4. `create_text_note` - 发布文字笔记
5. `search_notes` - 搜索笔记
6. `get_user_info` - 获取用户信息
7. `like_feed` - 点赞笔记
8. `favorite_feed` - 收藏笔记
9. `post_comment` - 发表评论
10. `reply_comment` - 回复评论

### 3.3 配置到 opencode

#### 3.3.1 更新 novaway.json

```json
{
  "mcp": {
    "xiaohongshu": {
      "command": "path/to/xiaohongshu-mcp.exe",
      "args": ["-headless", "true", "-port", ":18060"],
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

#### 3.3.2 环境变量配置

```bash
# Windows
set ROD_BROWSER_BIN=path/to/chrome.exe

# Linux/macOS
export ROD_BROWSER_BIN=/usr/bin/google-chrome
```

## 4. 阶段 2: 微信公众号 MCP 服务器集成

### 4.1 安装 wechat-official-account-mcp

#### 4.1.1 全局安装

```bash
# 安装 MCP 服务器
npm install -g wechat-official-account-mcp

# 验证安装
wechat-mcp --version
```

#### 4.1.2 配置凭证

```bash
# 设置环境变量
export WECHAT_APP_ID=your_app_id
export WECHAT_APP_SECRET=your_app_secret
```

### 4.2 测试 MCP 服务器

#### 4.2.1 启动服务器

```bash
# 启动 MCP 服务器 (stdio 模式)
wechat-mcp mcp -a $WECHAT_APP_ID -s $WECHAT_APP_SECRET

# 或者 SSE 模式
wechat-mcp mcp -a $WECHAT_APP_ID -s $WECHAT_APP_SECRET -m sse -p 3000
```

#### 4.2.2 测试工具列表

服务器提供以下 MCP 工具：

1. `wechat_auth` - 认证管理
2. `wechat_media_upload` - 素材上传
3. `wechat_draft_create` - 创建草稿
4. `wechat_draft_publish` - 发布草稿
5. `wechat_draft_delete` - 删除草稿
6. `wechat_material_delete` - 删除素材

### 4.3 配置到 opencode

#### 4.3.1 更新 novaway.json

```json
{
  "mcp": {
    "wechat-official": {
      "command": "npx",
      "args": ["-y", "wechat-official-account-mcp", "mcp", "-a", "${WECHAT_APP_ID}", "-s", "${WECHAT_APP_SECRET}"],
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

## 5. 阶段 3: 代理集成

### 5.1 更新 pulse-orchestrator 代理

#### 5.1.1 修改 agent.ts

```typescript
// packages/opencode/src/agent/agent.ts

const pulseOrchestratorAgent = {
  name: "pulse-orchestrator",
  displayName: "AI运营助手",
  description: "智能运营助手，支持小红书、公众号内容创作和发布",
  mode: "primary",
  tools: [
    // 现有工具...
    "xiaohongshu_check_login_status",
    "xiaohongshu_create_image_note",
    "xiaohongshu_search_notes",
    "wechat_official_auth",
    "wechat_official_media_upload",
    "wechat_official_draft_create",
    "wechat_official_draft_publish",
  ],
  permission: {
    mcp: {
      xiaohongshu: "allow",
      "wechat-official": "allow",
    },
  },
}
```

#### 5.1.2 创建发布工作流提示

```typescript
// packages/opencode/src/agent/prompt/pulse-orchestrator.txt

你是一个智能运营助手，可以帮助用户创建和发布内容到小红书和微信公众号。

## 工作流程

### 小红书发布流程
1. 检查登录状态
2. 如果未登录，获取登录二维码
3. 创建图文笔记
4. 监控发布状态

### 微信公众号发布流程
1. 认证管理
2. 上传素材
3. 创建草稿
4. 发布草稿

## 工具使用指南

### 小红书工具
- `check_login_status`: 检查是否已登录小红书
- `get_login_qrcode`: 获取登录二维码
- `create_image_note`: 发布图文笔记
- `search_notes`: 搜索笔记内容

### 微信公众号工具
- `wechat_auth`: 管理认证信息
- `wechat_media_upload`: 上传图片/视频素材
- `wechat_draft_create`: 创建图文草稿
- `wechat_draft_publish`: 发布草稿到公众号
```

### 5.2 测试代理功能

#### 5.2.1 测试工具调用

```bash
# 启动 opencode
bun dev

# 在 Pulse 面板中测试
1. 输入 "检查小红书登录状态"
2. 验证代理调用 xiaohongshu_check_login_status 工具
3. 输入 "发布一篇测试笔记"
4. 验证代理调用 xiaohongshu_create_image_note 工具
```

## 6. 阶段 4: UI 组件开发

### 6.1 创建 PulsePublishPanel 组件

#### 6.1.1 组件结构

```typescript
// packages/app/src/pages/pulse/PulsePublishPanel.tsx

import { Component, createSignal, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Input } from "@opencode-ai/ui/input"
import { Textarea } from "@opencode-ai/ui/textarea"

interface PublishContent {
  title: string
  content: string
  images: string[]
  tags: string[]
  platform: "xiaohongshu" | "wechat"
  scheduleAt?: string
  visibility?: "public" | "private" | "friends"
}

interface PulsePublishPanelProps {
  onPublish: (content: PublishContent) => void
  onCancel: () => void
  isPublishing: boolean
}

export const PulsePublishPanel: Component<PulsePublishPanelProps> = (props) => {
  const [content, setContent] = createSignal<PublishContent>({
    title: "",
    content: "",
    images: [],
    tags: [],
    platform: "xiaohongshu"
  })

  const handlePublish = () => {
    props.onPublish(content())
  }

  return (
    <div class="pulse-publish-panel">
      <div class="publish-header">
        <h3>发布内容</h3>
        <Button onClick={props.onCancel}>取消</Button>
      </div>

      <div class="publish-form">
        <div class="platform-selector">
          <Button
            onClick={() => setContent({...content(), platform: "xiaohongshu"})}
            variant={content().platform === "xiaohongshu" ? "default" : "outline"}
          >
            小红书
          </Button>
          <Button
            onClick={() => setContent({...content(), platform: "wechat"})}
            variant={content().platform === "wechat" ? "default" : "outline"}
          >
            微信公众号
          </Button>
        </div>

        <Input
          placeholder="标题"
          value={content().title}
          onInput={(e) => setContent({...content(), title: e.target.value})}
        />

        <Textarea
          placeholder="内容"
          value={content().content}
          onInput={(e) => setContent({...content(), content: e.target.value})}
        />

        <div class="tags-input">
          <Input
            placeholder="添加标签 (回车确认)"
            onkeydown={(e) => {
              if (e.key === "Enter") {
                const tag = e.target.value.trim()
                if (tag) {
                  setContent({...content(), tags: [...content().tags, tag]})
                  e.target.value = ""
                }
              }
            }}
          />
          <div class="tags-list">
            <For each={content().tags}>
              {(tag) => (
                <span class="tag">
                  #{tag}
                  <button onClick={() => setContent({...content(), tags: content().tags.filter(t => t !== tag)})}>×</button>
                </span>
              )}
            </For>
          </div>
        </div>

        <Show when={content().platform === "xiaohongshu"}>
          <div class="visibility-selector">
            <select
              onChange={(e) => setContent({...content(), visibility: e.target.value as any})}
            >
              <option value="public">公开可见</option>
              <option value="private">仅自己可见</option>
              <option value="friends">仅互关好友可见</option>
            </select>
          </div>
        </Show>

        <div class="publish-actions">
          <Button onClick={handlePublish} disabled={props.isPublishing}>
            {props.isPublishing ? "发布中..." : "发布"}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

### 6.2 集成到 Pulse 面板

#### 6.2.1 更新 PulseChatInput

```typescript
// packages/app/src/pages/pulse/PulseChatInput.tsx

import { PulsePublishPanel } from "./PulsePublishPanel"

// 在组件中添加发布面板状态
const [showPublishPanel, setShowPublishPanel] = createSignal(false)

// 添加发布按钮
<Button onClick={() => setShowPublishPanel(true)}>
  发布内容
</Button>

// 渲染发布面板
<Show when={showPublishPanel()}>
  <PulsePublishPanel
    onPublish={handlePublish}
    onCancel={() => setShowPublishPanel(false)}
    isPublishing={isPublishing()}
  />
</Show>
```

#### 6.2.2 实现发布处理函数

```typescript
const handlePublish = async (content: PublishContent) => {
  setIsPublishing(true)

  try {
    if (content.platform === "xiaohongshu") {
      // 调用小红书发布工具
      await sdk.client.session.prompt({
        sessionID: currentSessionID,
        parts: [
          {
            type: "text",
            text: `发布小红书笔记：标题 "${content.title}"，内容 "${content.content}"，标签 [${content.tags.join(", ")}]`,
          },
        ],
      })
    } else {
      // 调用微信公众号发布工具
      await sdk.client.session.prompt({
        sessionID: currentSessionID,
        parts: [
          {
            type: "text",
            text: `发布微信公众号文章：标题 "${content.title}"，内容 "${content.content}"`,
          },
        ],
      })
    }

    setShowPublishPanel(false)
  } catch (error) {
    console.error("发布失败:", error)
  } finally {
    setIsPublishing(false)
  }
}
```

## 7. 测试计划

### 7.1 单元测试

#### 7.1.1 MCP 服务器测试

```typescript
// 测试小红书 MCP 服务器连接
test("xiaohongshu MCP server connection", async () => {
  const response = await fetch("http://localhost:18060/health")
  expect(response.ok).toBe(true)
})

// 测试微信公众号 MCP 服务器连接
test("wechat-official MCP server connection", async () => {
  // 测试 stdio 连接
  const process = spawn("wechat-mcp", ["mcp", "-a", "test", "-s", "test"])
  expect(process.pid).toBeDefined()
})
```

#### 7.1.2 代理工具测试

```typescript
// 测试代理工具调用
test("pulse-orchestrator tool calling", async () => {
  const agent = getAgent("pulse-orchestrator")
  expect(agent.tools).toContain("xiaohongshu_check_login_status")
  expect(agent.tools).toContain("wechat_official_auth")
})
```

### 7.2 集成测试

#### 7.2.1 端到端发布流程测试

```typescript
// 测试完整发布流程
test("end-to-end publish flow", async () => {
  // 1. 启动 MCP 服务器
  // 2. 创建会话
  // 3. 调用发布工具
  // 4. 验证发布结果
})
```

### 7.3 性能测试

#### 7.3.1 响应时间测试

```typescript
// 测试工具调用响应时间
test("tool response time", async () => {
  const start = Date.now()
  await callMCPTool("xiaohongshu_check_login_status")
  const duration = Date.now() - start
  expect(duration).toBeLessThan(3000) // 3 秒内响应
})
```

## 8. 部署指南

### 8.1 开发环境部署

#### 8.1.1 启动 MCP 服务器

```bash
# 终端 1: 启动小红书 MCP 服务器
cd XYMT-AUTO/xiaohongshu-mcp
./xiaohongshu-mcp.exe -headless true -port :18060

# 终端 2: 启动微信公众号 MCP 服务器
wechat-mcp mcp -a $WECHAT_APP_ID -s $WECHAT_APP_SECRET

# 终端 3: 启动 opencode
bun dev
```

### 8.2 生产环境部署

#### 8.2.1 使用 PM2 管理进程

```bash
# 安装 PM2
npm install -g pm2

# 启动小红书 MCP 服务器
pm2 start xiaohongshu-mcp --name xiaohongshu-mcp -- -headless true -port :18060

# 启动微信公众号 MCP 服务器
pm2 start wechat-mcp --name wechat-mcp -- mcp -a $WECHAT_APP_ID -s $WECHAT_APP_SECRET

# 保存进程列表
pm2 save

# 设置开机自启
pm2 startup
```

### 8.3 Docker 部署

#### 8.3.1 创建 Dockerfile

```dockerfile
# 小红书 MCP 服务器
FROM golang:1.24 AS builder
WORKDIR /app
COPY . .
RUN go mod download
RUN go build -o xiaohongshu-mcp .

FROM ubuntu:22.04
RUN apt-get update && apt-get install -y chromium-browser
WORKDIR /app
COPY --from=builder /app/xiaohongshu-mcp .
EXPOSE 18060
CMD ["./xiaohongshu-mcp", "-headless", "true", "-port", ":18060"]
```

## 9. 故障排除

### 9.1 常见问题

#### 9.1.1 MCP 服务器连接失败

```bash
# 检查端口是否被占用
netstat -ano | findstr :18060

# 检查防火墙设置
# Windows: 允许应用通过防火墙
# Linux: sudo ufw allow 18060
```

#### 9.1.2 浏览器启动失败

```bash
# 检查 Chrome 安装
google-chrome --version

# 设置浏览器路径
export ROD_BROWSER_BIN=/usr/bin/google-chrome
```

#### 9.1.3 微信公众号认证失败

```bash
# 检查 AppID 和 AppSecret
echo $WECHAT_APP_ID
echo $WECHAT_APP_SECRET

# 检查 IP 白名单
# 在微信公众平台添加服务器 IP 到白名单
```

### 9.2 日志查看

#### 9.2.1 查看 MCP 服务器日志

```bash
# 小红书 MCP 服务器日志
tail -f /var/log/xiaohongshu-mcp.log

# 微信公众号 MCP 服务器日志
pm2 logs wechat-mcp
```

#### 9.2.2 查看 opencode 日志

```bash
# 查看 opencode 日志
tail -f ~/.opencode/logs/opencode.log
```

## 10. 更新日志

### 10.1 版本 1.0.0 (2026-06-19)

- 初始版本
- 集成小红书 MCP 服务器
- 集成微信公众号 MCP 服务器
- 创建 PulsePublishPanel 组件
- 更新 pulse-orchestrator 代理

## 11. 贡献指南

### 11.1 开发流程

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

### 11.2 代码规范

- 使用 TypeScript 严格模式
- 遵循 ESLint 规则
- 编写单元测试
- 更新文档

## 12. 许可证

本项目使用 MIT 许可证。详见 LICENSE 文件。
