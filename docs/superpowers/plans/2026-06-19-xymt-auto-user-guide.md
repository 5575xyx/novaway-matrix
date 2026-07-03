# XYMT-AUTO 发布功能集成 - 用户指南

## 概述

本指南介绍如何使用 opencode 中集成的 XYMT-AUTO 发布功能，支持小红书和微信公众号的内容发布。

## 前置条件

### 1. 环境要求
- opencode 已安装并运行
- Node.js 18+ 已安装
- Docker 已安装（用于小红书 MCP 服务器）

### 2. 配置 MCP 服务器

#### 2.1 小红书 MCP 服务器
小红书 MCP 服务器使用 Docker 运行，需要先构建 Docker 镜像：

```bash
# 进入 XYMT-AUTO 目录
cd E:\AImoney\NovaWay-Matrix\novaway-coder\XYMT-AUTO\xiaohongshu-mcp

# 构建 Docker 镜像
docker build -t xiaohongshu-mcp:latest .

# 测试运行
docker run -i --rm -p 18060:18060 xiaohongshu-mcp:latest
```

#### 2.2 微信公众号 MCP 服务器
微信公众号 MCP 服务器使用 npm 包：

```bash
# 安装 npm 包
npm install -g wechat-official-account-mcp

# 设置环境变量
export WECHAT_APP_ID=your_app_id
export WECHAT_APP_SECRET=your_app_secret
```

### 3. 配置 opencode

编辑 `novaway.json` 文件，添加 MCP 服务器配置：

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

## 使用指南

### 1. 启动 opencode

```bash
# 启动 opencode
bun dev
```

### 2. 进入 Pulse 模式

1. 在 opencode 中选择 Pulse 模式
2. 点击右侧的"AI 运营助手"面板
3. 点击右上角的"发布"按钮

### 3. 发布内容到小红书

#### 3.1 登录小红书
1. 在 Pulse 助手面板中输入："检查小红书登录状态"
2. 如果未登录，输入："获取小红书登录二维码"
3. 使用手机扫描二维码登录

#### 3.2 发布图文笔记
1. 点击"发布"按钮
2. 选择"小红书"平台
3. 输入标题和内容
4. 添加标签（可选）
5. 点击"发布"按钮

#### 3.3 发布文字笔记
在 Pulse 助手面板中输入：
```
发布小红书文字笔记：标题 "我的笔记"，内容 "这是笔记内容"
```

### 4. 发布内容到微信公众号

#### 4.1 认证管理
在 Pulse 助手面板中输入：
```
检查微信公众号认证状态
```

#### 4.2 上传素材
在 Pulse 助手面板中输入：
```
上传图片到微信公众号：/path/to/image.jpg
```

#### 4.3 创建草稿
在 Pulse 助手面板中输入：
```
创建微信公众号草稿：标题 "文章标题"，内容 "文章内容"
```

#### 4.4 发布草稿
在 Pulse 助手面板中输入：
```
发布微信公众号草稿：草稿ID
```

### 5. 多平台分发

在 Pulse 助手面板中输入：
```
将以下内容分发到多个平台：
标题：我的文章
内容：这是文章内容
平台：小红书、微信公众号
```

## 常见问题

### Q1: 小红书 MCP 服务器无法启动
**解决方案：**
1. 检查 Docker 是否正在运行
2. 检查端口 18060 是否被占用
3. 查看 Docker 日志：`docker logs <容器ID>`

### Q2: 微信公众号认证失败
**解决方案：**
1. 检查 AppID 和 AppSecret 是否正确
2. 检查 IP 白名单是否包含服务器 IP
3. 检查网络连接是否正常

### Q3: 发布内容失败
**解决方案：**
1. 检查账号是否已登录
2. 检查网络连接是否正常
3. 查看错误日志获取详细信息

### Q4: 如何查看发布历史？
**解决方案：**
在 Pulse 助手面板中输入：
```
查看发布历史
```

## 高级功能

### 1. 定时发布
在 Pulse 助手面板中输入：
```
定时发布小红书笔记：标题 "定时笔记"，内容 "定时发布内容"，发布时间 "2026-06-20T10:00:00+08:00"
```

### 2. 批量发布
在 Pulse 助手面板中输入：
```
批量发布内容到多个平台：
1. 小红书：标题 "笔记1"，内容 "内容1"
2. 微信公众号：标题 "文章1"，内容 "内容1"
```

### 3. 内容生成
在 Pulse 助手面板中输入：
```
生成小红书种草文案：关键词 "美食、旅行"
```

## 技术支持

如果遇到问题，请：
1. 查看本文档的常见问题部分
2. 检查 opencode 日志
3. 提交 Issue 到项目仓库

## 更新日志

### 版本 1.0.0 (2026-06-19)
- 初始版本
- 支持小红书图文笔记发布
- 支持微信公众号草稿创建和发布
- 支持多平台内容分发