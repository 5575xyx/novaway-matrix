# 微信公众号运营自动化 Skill 设计文档

**创建时间**：2026-06-22  
**版本**：1.0  
**状态**：实施完成

---

## 1. 概述

### 1.1 目标

创建一个 opencode 内置 skill，实现微信公众号运营的全流程自动化，包括：
- AI 生成文章内容（文本 + 配图）
- 自动发布到微信公众号草稿箱

### 1.2 范围

- **专注于微信公众号**：不涉及其他平台
- **全流程自动化**：从内容生成到自动发布
- **Electron WebView DOM 操作**：复用 XYMT-AUTO 现有方案

### 1.3 前置条件

1. 用户已登录微信公众平台（`mp.weixin.qq.com`）
2. Electron WebView 可用且已加载公众号后台页面
3. AI 模型配置完成（支持 OpenAI 兼容 API）

---

## 2. 架构设计

### 2.1 目录结构

```
packages/opencode/src/skill/prompt/wxgzh-ops/
├── SKILL.md                    # 核心 skill 定义（~200行）
├── references/
│   ├── content-generation.md   # AI 内容生成详细流程
│   ├── image-generation.md     # 配图生成流程
│   ├── publishing-workflow.md  # DOM 操作发布流程
│   └── selectors-reference.md  # DOM 选择器参考
└── prompts/
    ├── article-system.txt      # 文章生成系统提示词
    └── image-prompt.txt        # 图片生成提示词模板
```

### 2.2 触发条件

```
Use when the user wants to create and publish content to WeChat Official Account (微信公众号). 
Covers AI article generation, image generation, and automated publishing via Electron WebView. 
Make sure to use this skill whenever the user mentions "公众号", "微信公众号", "wechat official account", 
or wants to create/publish articles to WeChat, even if they don't explicitly ask.
```

### 2.3 核心工作流

```
┌─────────────────────────────────────────────────────────────┐
│                    微信公众号运营自动化                        │
├─────────────────────────────────────────────────────────────┤
│  阶段 1：内容生成                                            │
│  ├── 收集用户输入（主题、要点、目标人群、语气、篇幅）          │
│  ├── 调用 AI API 生成文章 JSON                               │
│  ├── 解析文章结果（标题、摘要、HTML、配图计划）               │
│  └── 输出：文章预览                                         │
├─────────────────────────────────────────────────────────────┤
│  阶段 2：配图生成                                            │
│  ├── 生成配图计划（最多 5 张）                               │
│  ├── 批量生成配图                                           │
│  ├── 将图片插入文章 HTML 对应位置                            │
│  └── 输出：完整文章 + 配图                                   │
├─────────────────────────────────────────────────────────────┤
│  阶段 3：自动发布                                            │
│  ├── 提取 WebView URL 中的 token                            │
│  ├── 导航到文章编辑页面                                     │
│  ├── 填充标题、摘要、正文                                   │
│  ├── 点击保存草稿按钮                                       │
│  └── 输出：发布结果                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 详细设计

### 3.1 SKILL.md 核心结构

**Frontmatter：**
```yaml
---
name: wxgzh-ops
description: "Use when the user wants to create and publish content to WeChat Official Account (微信公众号). Covers AI article generation, image generation, and automated publishing via Electron WebView. Make sure to use this skill whenever the user mentions '公众号', '微信公众号', 'wechat official account', or wants to create/publish articles to WeChat, even if they don't explicitly ask."
---
```

**核心内容：**
1. 使用场景说明
2. 前置条件检查
3. 三阶段工作流程
4. 输出格式定义
5. 错误处理指南
6. 配置要求
7. 示例对话

### 3.2 参考文档

#### 3.2.1 content-generation.md

**内容：**
- 表单状态结构（`DraftState` 类型定义）
- 篇幅映射（short/medium/long 对应字数）
- Prompt 构建规则（7 个必须要素）
- 系统提示词说明
- 文章结果解析逻辑
- 降级方案

#### 3.2.2 image-generation.md

**内容：**
- 配图计划生成规则（1-5 张）
- 配图类型说明（头图、核心观点图、行动建议图、要点图示）
- 图片提示词构建规则（7 个必须要素）
- 批量生成策略（`Promise.all()` 并行）
- 图片插入 HTML 方法
- 错误处理

#### 3.2.3 publishing-workflow.md

**内容：**
- 前置检查（4 项）
- 导航到编辑器（2 种方式）
- 填充内容（标题、摘要、正文）
- 保存草稿
- 错误恢复

#### 3.2.4 selectors-reference.md

**内容：**
- 标题输入框选择器（4 种）
- 摘要输入框选择器（3 种）
- 正文编辑器选择器（iframe + contenteditable）
- 保存按钮选择器（5 种）
- 选择器优先级说明

### 3.3 提示词

#### 3.3.1 article-system.txt

**系统提示词要点：**
- 角色：资深微信公众号运营总编
- 输出格式：严格 JSON（无额外文字）
- JSON 结构：title, summary, html, imagePlans
- 10 项具体要求（标题、摘要、HTML 格式、配图计划等）

#### 3.3.2 image-prompt.txt

**提示词模板变量：**
- `{topic}` - 文章主题
- `{audience}` - 目标读者
- `{tone}` - 内容风格
- `{plan.prompt}` - 画面需求

**强制要求：**
- 构图要求（主体清晰、层次分明、光线自然）
- 画质要求（高清、细节丰富、视觉高级感）
- 强限制（禁止文字、logo、水印、二维码、签名）

---

## 4. 集成设计

### 4.1 权限配置

**novaway.json 配置：**
```json
{
  "permission": {
    "skill": {
      "wxgzh-ops": "allow"
    }
  }
}
```

**Agent 权限配置（agent.ts）：**
```typescript
permission: {
  skill: {
    "wxgzh-ops": "allow",
  },
}
```

### 4.2 与 Pulse Orchestrator 集成

Pulse Orchestrator agent 已配置支持 MCP 服务器，可以扩展支持 wxgzh-ops skill：

```typescript
permission: {
  skill: {
    "wxgzh-ops": "allow",
    "xiaohongshu": "allow",
    "wechat-official": "allow",
  },
}
```

---

## 5. 使用场景

### 5.1 完整流程（生成 + 发布）

```
用户：帮我写一篇关于 AI 技术趋势的公众号文章并发布

助手：
1. 识别关键词"公众号" → 加载 wxgzh-ops skill
2. 收集详细信息（主题、目标人群、语气、篇幅）
3. 生成文章内容（调用 AI API）
4. 生成配图（3张）
5. 展示预览
6. 用户确认后执行自动发布
7. 报告结果：已保存为草稿
```

### 5.2 仅生成内容

```
用户：帮我生成一篇关于健康饮食的公众号文章

助手：
1. 识别关键词"公众号" → 加载 wxgzh-ops skill
2. 收集详细信息
3. 生成文章内容
4. 生成配图
5. 展示预览
6. 等待用户进一步指示（发布/修改/放弃）
```

### 5.3 发布已有内容

```
用户：把这篇文章发布到公众号

助手：
1. 识别关键词"公众号" → 加载 wxgzh-ops skill
2. 检查 WebView 状态
3. 执行自动发布流程
4. 报告发布结果
```

---

## 6. 错误处理

### 6.1 常见错误及解决方案

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| `token 提取失败` | WebView 未加载公众号页面 | 提示用户先登录公众号后台 |
| `编辑器未就绪` | 页面加载中或选择器变化 | 重试 + 回退到直连 URL |
| `AI 生成失败` | 模型配置错误或 API 不可用 | 检查 AI 模型配置 |
| `图片生成失败` | 图片模型不可用 | 支持单独重绘配图 |
| `保存草稿失败` | 网络连接或页面状态异常 | 检查网络连接和页面状态 |

### 6.2 降级方案

1. **AI 生成失败**：使用 `buildFallbackArticle()` 提供基础模板
2. **图片生成失败**：继续处理其他图片，单张失败不影响整体
3. **发布失败**：提供手动发布指引

---

## 7. 配置要求

### 7.1 AI 模型配置

需要配置以下 AI 模型：
- **文本模型**：用于生成文章内容（支持 OpenAI 兼容 API）
- **图片模型**：用于生成配图（支持 DALL-E、Flux 等）

### 7.2 WebView 配置

需要确保：
- Electron WebView 组件可用
- 已加载微信公众平台页面（`mp.weixin.qq.com`）
- JavaScript 执行权限已启用

---

## 8. 实施计划

### 8.1 文件创建清单

| 文件 | 优先级 | 预计行数 |
|------|--------|----------|
| `SKILL.md` | 高 | ~200 行 |
| `references/content-generation.md` | 高 | ~150 行 |
| `references/image-generation.md` | 高 | ~100 行 |
| `references/publishing-workflow.md` | 高 | ~200 行 |
| `references/selectors-reference.md` | 中 | ~100 行 |
| `prompts/article-system.txt` | 高 | ~50 行 |
| `prompts/image-prompt.txt` | 高 | ~20 行 |

### 8.2 实施步骤

1. **创建目录结构**
2. **编写 SKILL.md 核心文件**
3. **编写参考文档**
4. **编写提示词文件**
5. **配置权限**
6. **测试验证**

### 8.3 验证标准

- [ ] Skill 可以被 opencode 正确加载
- [ ] 触发条件正确识别"公众号"相关请求
- [ ] 内容生成流程正常工作
- [ ] 配图生成流程正常工作
- [ ] 自动发布流程正常工作
- [ ] 错误处理机制有效

---

## 9. 扩展性

### 9.1 未来扩展方向

1. **多平台支持**：扩展支持小红书、抖音等平台
2. **模板系统**：支持自定义文章模板
3. **定时发布**：支持定时发布功能
4. **数据分析**：集成阅读量、点赞量等数据分析
5. **批量操作**：支持批量生成和发布

### 9.2 维护策略

1. **选择器更新**：定期检查微信公众号页面变化，更新 DOM 选择器
2. **API 兼容性**：跟踪 AI 模型 API 变化，保持兼容性
3. **错误监控**：记录错误日志，持续优化错误处理

---

## 10. 附录

### 10.1 参考资料

- XYMT-AUTO 项目 `WxGzhAssistant.tsx` 组件实现
- XYMT-AUTO 项目 `handleWxGzhAutoSaveDraft()` 函数实现
- opencode skill 系统文档
- 微信公众平台页面结构

### 10.2 相关文件

- `packages/opencode/src/skill/index.ts` - Skill 核心服务
- `packages/opencode/src/tool/skill.ts` - Skill 工具
- `packages/opencode/src/session/system.ts` - 系统提示集成
- `XYMT-AUTO/src/views/account/components/WxGzhAssistant.tsx` - 参考实现
- `XYMT-AUTO/src/views/account/index.tsx` - 参考实现

---

**文档结束**
