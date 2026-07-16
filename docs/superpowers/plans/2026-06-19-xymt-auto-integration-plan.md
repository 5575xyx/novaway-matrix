# XYMT-AUTO 发布功能集成到 Pulse 助手面板

## 1. 概述

本计划旨在将 XYMT-AUTO 项目的自动发布功能（小红书、公众号）集成到 opencode 的 Pulse 助手面板中，通过 MCP 服务器实现工具调用，使 orchestrator 代理能够直接执行发布操作。

### 1.1 目标

- 集成小红书 MCP 服务器（Go 实现）
- 集成微信公众号 MCP 服务器（Node.js 实现）
- 在 Pulse 面板中创建发布工作流 UI 组件
- 更新 pulse-orchestrator 代理以支持发布工具

### 1.2 范围

- MCP 服务器配置和集成
- 代理工具集成
- UI 组件开发
- 测试和文档

## 2. 技术架构

### 2.1 MCP 服务器集成

#### 2.1.1 小红书 MCP 服务器

- **来源**: XYMT-AUTO/xiaohongshu-mcp
- **协议**: MCP (Model Context Protocol)
- **运行模式**: 本地 stdio 或 HTTP 服务器
- **端口**: 18060 (HTTP 模式)
- **功能**:
  - 登录状态检查
  - QR 码登录
  - 发布图文内容
  - 发布视频内容
  - 搜索内容
  - 获取用户信息
  - 点赞/收藏操作
  - 评论管理

#### 2.1.2 微信公众号 MCP 服务器

- **来源**: wechat-official-account-mcp (npm 包)
- **协议**: MCP (Model Context Protocol)
- **运行模式**: stdio 或 SSE
- **功能**:
  - 认证管理
  - 素材上传
  - 草稿管理
  - 发布管理
  - 本地存储
  - 安全增强

### 2.2 opencode 配置

#### 2.2.1 MCP 配置结构

```json
{
  "mcp": {
    "xiaohongshu": {
      "type": "local",
      "command": ["path/to/xiaohongshu-mcp", "-headless", "true"],
      "enabled": true,
      "timeout": 10000
    },
    "wechat-official": {
      "type": "local",
      "command": ["npx", "-y", "wechat-official-account-mcp", "mcp", "-a", "<APP_ID>", "-s", "<APP_SECRET>"],
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

### 2.3 代理集成

#### 2.3.1 pulse-orchestrator 代理更新

- 添加发布工具到代理能力
- 创建发布工作流提示
- 配置工具权限

#### 2.3.2 工具映射

| MCP 服务器      | 工具名称             | 功能描述       |
| --------------- | -------------------- | -------------- |
| xiaohongshu     | check_login_status   | 检查登录状态   |
| xiaohongshu     | get_login_qrcode     | 获取登录二维码 |
| xiaohongshu     | create_image_note    | 发布图文笔记   |
| xiaohongshu     | create_text_note     | 发布文字笔记   |
| xiaohongshu     | search_notes         | 搜索笔记       |
| xiaohongshu     | get_user_info        | 获取用户信息   |
| wechat-official | wechat_auth          | 认证管理       |
| wechat-official | wechat_media_upload  | 素材上传       |
| wechat-official | wechat_draft_create  | 创建草稿       |
| wechat-official | wechat_draft_publish | 发布草稿       |

## 3. 实现计划

### 3.1 阶段 1: MCP 服务器设置 (1-2 天)

#### 3.1.1 小红书 MCP 服务器

- [ ] 从 XYMT-AUTO 构建 xiaohongshu-mcp 二进制文件
- [ ] 测试服务器功能
- [ ] 配置到 opencode MCP 配置

#### 3.1.2 微信公众号 MCP 服务器

- [ ] 安装 wechat-official-account-mcp
- [ ] 配置 AppID 和 AppSecret
- [ ] 测试服务器功能
- [ ] 配置到 opencode MCP 配置

### 3.2 阶段 2: 代理集成 (1 天)

#### 3.2.1 更新 pulse-orchestrator 代理

- [ ] 添加发布工具到代理能力
- [ ] 创建发布工作流提示
- [ ] 配置工具权限

#### 3.2.2 测试代理功能

- [ ] 验证工具调用
- [ ] 测试发布流程
- [ ] 调试错误处理

### 3.3 阶段 3: UI 组件开发 (2-3 天)

#### 3.3.1 创建 PulsePublishPanel 组件

- [ ] 设计 UI 布局
- [ ] 实现平台选择器
- [ ] 创建内容编辑器
- [ ] 添加图片上传功能
- [ ] 实现标签管理

#### 3.3.2 集成到 Pulse 面板

- [ ] 添加发布按钮到 PulseChatInput
- [ ] 实现发布工作流触发
- [ ] 添加发布状态显示
- [ ] 实现发布历史记录

### 3.4 阶段 4: 测试和文档 (1 天)

#### 3.4.1 测试

- [ ] MCP 服务器连接测试
- [ ] 代理工具调用测试
- [ ] UI 组件功能测试
- [ ] 端到端发布流程测试

#### 3.4.2 文档

- [ ] 创建用户指南
- [ ] 编写开发者文档
- [ ] 更新项目 README

## 4. 技术细节

### 4.1 MCP 服务器配置

#### 4.1.1 小红书 MCP 服务器配置

```typescript
// packages/opencode/src/config/mcp.ts
export const xiaohongshuConfig = {
  type: "local" as const,
  command: ["path/to/xiaohongshu-mcp", "-headless", "true"],
  enabled: true,
  timeout: 10000,
}
```

#### 4.1.2 微信公众号 MCP 服务器配置

```typescript
// packages/opencode/src/config/mcp.ts
export const wechatOfficialConfig = {
  type: "local" as const,
  command: [
    "npx",
    "-y",
    "wechat-official-account-mcp",
    "mcp",
    "-a",
    process.env.WECHAT_APP_ID || "",
    "-s",
    process.env.WECHAT_APP_SECRET || "",
  ],
  enabled: true,
  timeout: 10000,
}
```

### 4.2 代理工具集成

#### 4.2.1 pulse-orchestrator 代理更新

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

### 4.3 UI 组件设计

#### 4.3.1 PulsePublishPanel 组件结构

```typescript
// packages/app/src/pages/pulse/PulsePublishPanel.tsx
interface PulsePublishPanelProps {
  onPublish: (platform: string, content: PublishContent) => void
  onCancel: () => void
}

interface PublishContent {
  title: string
  content: string
  images: string[]
  tags: string[]
  scheduleAt?: string
  visibility?: string
}
```

#### 4.3.2 平台选择器

```typescript
// 支持的平台
const PLATFORMS = [
  { id: "xiaohongshu", name: "小红书", icon: "📱" },
  { id: "wechat", name: "微信公众号", icon: "💬" },
]
```

## 5. 风险评估

### 5.1 技术风险

- **MCP 服务器兼容性**: 确保 MCP 服务器与 opencode 兼容
- **依赖管理**: 管理 Go 和 Node.js 依赖
- **性能影响**: MCP 服务器对系统性能的影响

### 5.2 缓解措施

- **兼容性测试**: 在集成前测试 MCP 服务器
- **依赖隔离**: 使用容器或虚拟环境隔离依赖
- **性能监控**: 监控 MCP 服务器资源使用

### 5.3 回滚计划

- **配置回滚**: 保留原始 MCP 配置备份
- **代码回滚**: 使用 Git 分支管理，便于回滚
- **文档记录**: 记录所有配置更改

## 6. 成功标准

### 6.1 功能标准

- [ ] 小红书 MCP 服务器正常运行
- [ ] 微信公众号 MCP 服务器正常运行
- [ ] pulse-orchestrator 代理能够调用发布工具
- [ ] Pulse 面板发布功能正常工作

### 6.2 性能标准

- [ ] MCP 服务器启动时间 < 5 秒
- [ ] 工具调用响应时间 < 3 秒
- [ ] UI 组件响应时间 < 1 秒

### 6.3 质量标准

- [ ] 所有测试通过
- [ ] 代码审查通过
- [ ] 文档完整

## 7. 时间估算

| 阶段     | 任务           | 时间估算   |
| -------- | -------------- | ---------- |
| 阶段 1   | MCP 服务器设置 | 1-2 天     |
| 阶段 2   | 代理集成       | 1 天       |
| 阶段 3   | UI 组件开发    | 2-3 天     |
| 阶段 4   | 测试和文档     | 1 天       |
| **总计** |                | **5-7 天** |

## 8. 附录

### 8.1 参考资源

- XYMT-AUTO 项目: `E:\AImoney\NovaWay-Matrix\novaway-coder\XYMT-AUTO`
- 小红书 MCP 服务器文档: `XYMT-AUTO/xiaohongshu-mcp/README.md`
- wechat-official-account-mcp: https://github.com/xwang152-jack/wechat-official-account-mcp
- opencode MCP 配置文档: `packages/opencode/src/config/mcp.ts`

### 8.2 相关文件

- `packages/opencode/src/config/mcp.ts`: MCP 配置定义
- `packages/opencode/src/agent/agent.ts`: 代理定义
- `packages/app/src/pages/pulse/`: Pulse 面板组件
- `packages/opencode/src/skill/`: 技能系统
