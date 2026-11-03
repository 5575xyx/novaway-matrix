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
2. **用户在「运营工作台」选中了该公众号账号**，中间那栏显示着后台页面
3. AI 模型配置完成（支持 OpenAI 兼容 API）

## 用什么工具

发布一律用 `webview_*` 工具组操作**用户眼前那块已经登录好的页面**：

| 工具 | 用途 |
| --- | --- |
| `webview_status` | 确认页面开着、是哪个账号、加载完没有 |
| `webview_snapshot` | 拿页面文字和可点击元素的 ref |
| `webview_click` | 点 ref 对应的按钮 |
| `webview_fill` | 往输入框/富文本里写文本 |
| `webview_script` | 执行页面脚本（正文 iframe 只能这样写） |
| `webview_navigate` | 跳到编辑页 |
| `webview_screenshot` | 截图给用户看当前状态 |

**不要用 `browser_*`**：那是另一个无头 Chrome，没有登录态，打开只有登录页。
也**不要**告诉用户"请你自己在浏览器里完成剩下步骤" —— 上面的工具就是用来替他点的。

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

1. `webview_status` 确认页面在、已登录
2. 调用 `references/publishing-workflow.md` 走完整流程
3. 提取页面 URL 里的 token
4. 进入图文编辑器（点「写新图文」，失败则直连编辑页）
5. 依次填标题、摘要、正文（正文走 iframe 脚本）
6. 点「保存为草稿」，并确认出现成功提示

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

| 错误                        | 原因                               | 解决方案                                        |
| --------------------------- | ---------------------------------- | ----------------------------------------------- |
| `没有打开的平台页面`        | 运营工作台没选中账号               | 让用户在工作台选中该公众号，不要改用无头浏览器  |
| `token 提取失败`            | 页面还没跳到后台，或未登录完成     | `webview_status` 看当前地址，请用户完成扫码     |
| `编辑器未就绪`              | 页面加载中或入口改版               | 重试 + 回退到直连编辑页 URL                     |
| `ref_not_found`             | 页面重渲染，旧 ref 失效            | 重新 `webview_snapshot` 再操作                  |
| `AI 生成失败`               | 模型配置错误或 API 不可用          | 检查 AI 模型配置                                |
| `图片生成失败`              | 图片模型不可用                     | 支持单独重绘配图                                |

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
