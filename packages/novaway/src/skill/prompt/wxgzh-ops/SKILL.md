---
name: wxgzh-ops
description: "Use when the user wants to create and publish content to WeChat Official Account (微信公众号). Covers AI article generation, image generation, and automated publishing via Electron WebView. Make sure to use this skill whenever the user mentions '公众号', '微信公众号', 'wechat official account', or wants to create/publish articles to WeChat, even if they don't explicitly ask."
---

# 微信公众号运营自动化

## 使用场景

当用户需要：

- 创建微信公众号文章（AI 生成内容）
- 生成配图并插入文章
- 自动发布文章到微信公众号草稿箱

## 前置条件

1. 用户已登录微信公众平台（`mp.weixin.qq.com`）
2. Electron WebView 可用且已加载公众号后台页面
3. AI 模型配置完成（支持 OpenAI 兼容 API）

## 工作流程

### 阶段 1：内容生成

1. 收集用户输入（主题、要点、目标人群、语气、篇幅）
2. 调用 `references/content-generation.md` 了解详细流程
3. 使用 `prompts/article-system.txt` 作为系统提示词
4. 调用 AI API 生成文章 JSON
5. 解析文章结果（标题、摘要、HTML、配图计划）

### 阶段 2：配图生成

1. 调用 `references/image-generation.md` 了解详细流程
2. 使用 `prompts/image-prompt.txt` 构建图片提示词
3. 批量生成配图（最多 5 张）
4. 将图片插入文章 HTML 对应位置

### 阶段 3：自动发布

1. 调用 `references/publishing-workflow.md` 了解详细流程
2. 使用 `references/selectors-reference.md` 查看 DOM 选择器
3. 提取 WebView URL 中的 token
4. 导航到文章编辑页面
5. 填充标题、摘要、正文
6. 点击保存草稿按钮

## 输出格式

### 内容生成阶段输出

```json
{
  "status": "generated",
  "title": "文章标题",
  "summary": "80-140字导语",
  "imageCount": 3,
  "nextStep": "preview"
}
```

### 发布阶段输出

```json
{
  "status": "published",
  "message": "已保存为草稿",
  "nextStep": "review_in_wechat"
}
```

## 错误处理

### 常见错误及解决方案

| 错误             | 原因                      | 解决方案                 |
| ---------------- | ------------------------- | ------------------------ |
| `token 提取失败` | WebView 未加载公众号页面  | 提示用户先登录公众号后台 |
| `编辑器未就绪`   | 页面加载中或选择器变化    | 重试 + 回退到直连 URL    |
| `AI 生成失败`    | 模型配置错误或 API 不可用 | 检查 AI 模型配置         |
| `图片生成失败`   | 图片模型不可用            | 支持单独重绘配图         |

## 配置要求

### AI 模型配置

需要配置以下 AI 模型：

- **文本模型**：用于生成文章内容（支持 OpenAI 兼容 API）
- **图片模型**：用于生成配图（支持 DALL-E、Flux 等）

### WebView 配置

需要确保：

- Electron WebView 组件可用
- 已加载微信公众平台页面（`mp.weixin.qq.com`）
- JavaScript 执行权限已启用

## 示例对话

### 示例 1：创建文章

**用户**：帮我写一篇关于 AI 股票分析的公众号文章

**助手**：

1. 加载 wxgzh-ops skill
2. 收集详细信息（语气、篇幅、目标人群等）
3. 生成文章内容
4. 生成配图
5. 询问用户是否发布

### 示例 2：直接发布

**用户**：把这篇文章发布到公众号

**助手**：

1. 加载 wxgzh-ops skill
2. 检查 WebView 状态
3. 执行自动发布流程
4. 报告发布结果
