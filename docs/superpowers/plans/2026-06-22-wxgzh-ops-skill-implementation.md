# 微信公众号运营自动化 Skill 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一个 opencode 内置 skill，实现微信公众号运营的全流程自动化，包括 AI 生成文章内容（文本 + 配图）和自动发布到微信公众号草稿箱。

**Architecture:** 采用模块化 skill 设计，核心 SKILL.md 定义工作流程，参考文档提供详细操作指南，提示词文件定义 AI 交互格式。通过 opencode skill 系统注册，支持触发条件自动加载。

**Tech Stack:** Markdown (SKILL.md), YAML (frontmatter), OpenAI API (内容生成), Electron WebView (DOM 操作)

---

## 文件结构

```
packages/opencode/src/skill/prompt/wxgzh-ops/
├── SKILL.md                    # 核心 skill 定义
├── references/
│   ├── content-generation.md   # AI 内容生成详细流程
│   ├── image-generation.md     # 配图生成流程
│   ├── publishing-workflow.md  # DOM 操作发布流程
│   └── selectors-reference.md  # DOM 选择器参考
└── prompts/
    ├── article-system.txt      # 文章生成系统提示词
    └── image-prompt.txt        # 图片生成提示词模板
```

---

## Task 1: 创建目录结构

**Files:**

- Create: `packages/opencode/src/skill/prompt/wxgzh-ops/` (directory)
- Create: `packages/opencode/src/skill/prompt/wxgzh-ops/references/` (directory)
- Create: `packages/opencode/src/skill/prompt/wxgzh-ops/prompts/` (directory)

- [ ] **Step 1: 创建主目录**

```bash
cd packages/opencode/src/skill/prompt
mkdir -p wxgzh-ops
```

- [ ] **Step 2: 创建子目录**

```bash
cd wxgzh-ops
mkdir -p references
mkdir -p prompts
```

- [ ] **Step 3: 验证目录结构**

```bash
ls -la
ls -la references/
ls -la prompts/
```

Expected: 三个目录已创建

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/skill/prompt/wxgzh-ops/
git commit -m "chore: 创建 wxgzh-ops skill 目录结构"
```

---

## Task 2: 创建 SKILL.md 核心文件

**Files:**

- Create: `packages/opencode/src/skill/prompt/wxgzh-ops/SKILL.md`

- [ ] **Step 1: 创建 SKILL.md 文件**

````markdown
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
````

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

````

- [ ] **Step 2: 验证文件内容**

```bash
cat SKILL.md
````

Expected: 文件内容完整，包含 frontmatter 和所有章节

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/skill/prompt/wxgzh-ops/SKILL.md
git commit -m "feat: 添加 wxgzh-ops skill 核心文件"
```

---

## Task 3: 创建内容生成参考文档

**Files:**

- Create: `packages/opencode/src/skill/prompt/wxgzh-ops/references/content-generation.md`

- [ ] **Step 1: 创建 content-generation.md**

````markdown
# 内容生成详细流程

## 表单状态结构

```typescript
type DraftState = {
  topic: string // 主题
  keyPoints: string // 核心要点（支持多行）
  audience: string // 目标人群（默认：泛用户）
  tone: string // 语气风格（默认：专业可信）
  length: "short" | "medium" | "long" // 篇幅
  cta: string // 行动引导
  article: ArticleResult | null // 生成的文章结果
}
```
````

## 篇幅映射

| 选项   | 字数要求 |
| ------ | -------- |
| short  | 约600字  |
| medium | 约1200字 |
| long   | 约1800字 |

## Prompt 构建规则

构建用户提示词时，必须包含以下要素：

1. 主题
2. 核心要点
3. 目标人群
4. 语气风格
5. 篇幅要求
6. 行动引导
7. 补充要求（HTML 格式、配图计划等）

## 系统提示词

使用 `prompts/article-system.txt` 中的系统提示词，要求 AI 输出严格 JSON 格式。

## 文章结果解析

解析 AI 返回的 JSON 时，需要处理：

1. JSON 解析失败的情况
2. 字段缺失的情况
3. HTML 美化处理
4. 配图计划标准化

## 降级方案

当 AI 生成失败时，使用 `buildFallbackArticle()` 提供基础模板。

````

- [ ] **Step 2: 验证文件内容**

```bash
cat references/content-generation.md
````

Expected: 文件内容完整，包含类型定义、映射表、规则说明

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/skill/prompt/wxgzh-ops/references/content-generation.md
git commit -m "docs: 添加内容生成参考文档"
```

---

## Task 4: 创建配图生成参考文档

**Files:**

- Create: `packages/opencode/src/skill/prompt/wxgzh-ops/references/image-generation.md`

- [ ] **Step 1: 创建 image-generation.md**

```markdown
# 配图生成详细流程

## 配图计划生成

### 默认配图数量

- 最少：1 张（头图）
- 最多：5 张

### 配图类型

1. **头图**：主题主视觉，高级感商业插画风
2. **核心观点图**：内容解读场景
3. **行动建议图**：落地执行场景
4. **要点图示**：聚焦具体要点

## 图片提示词构建

构建图片提示词时，必须包含：

1. 文章主题
2. 目标读者
3. 内容风格
4. 画面需求
5. 构图要求
6. 画质要求
7. 强限制（禁止文字、logo、水印等）

## 批量生成策略

使用 `Promise.all()` 并行生成所有配图，提高效率。

## 图片插入 HTML

使用 `injectImagesIntoHtml()` 将生成的图片插入文章 HTML 对应位置。

## 错误处理

单张图片生成失败不影响整体流程，继续处理其他图片。
```

- [ ] **Step 2: 验证文件内容**

```bash
cat references/image-generation.md
```

Expected: 文件内容完整，包含配图规则、提示词构建、错误处理

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/skill/prompt/wxgzh-ops/references/image-generation.md
git commit -m "docs: 添加配图生成参考文档"
```

---

## Task 5: 创建发布流程参考文档

**Files:**

- Create: `packages/opencode/src/skill/prompt/wxgzh-ops/references/publishing-workflow.md`

- [ ] **Step 1: 创建 publishing-workflow.md**

````markdown
# 发布流程详细文档

## 前置检查

1. **账号类型检查**：确认是微信公众号账号
2. **WebView 就绪检查**：确认 WebView 组件可用
3. **页面状态检查**：确认已加载微信公众平台页面
4. **Token 提取**：从 URL 中提取 token 参数

## 导航到编辑器

### 方式 1：点击"写新图文"按钮

```javascript
// 查找并点击按钮
const keywords = [/写新图文/, /新建图文/, /写文章/, /新建文章/]
// ... 点击逻辑
```
````

### 方式 2：直连编辑器 URL

```javascript
const editorUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&lang=zh_CN&token=${token}`
```

## 填充内容

### 标题填充

```javascript
const titleEl = document.querySelector("#activity-name") || document.querySelector('input[placeholder*="标题"]')
```

### 摘要填充

```javascript
const digestEl = document.querySelector("#js_description") || document.querySelector('textarea[placeholder*="摘要"]')
```

### 正文填充

```javascript
// 优先使用 iframe
const iframeEl = document.querySelector("iframe#ueditor_0")
if (iframeEl && iframeEl.contentWindow.document.body) {
  iframeEl.contentWindow.document.body.innerHTML = html
} else {
  // 回退到 contenteditable
  const editable = document.querySelector('#js_editor_area [contenteditable="true"]')
  editable.innerHTML = html
}
```

## 保存草稿

```javascript
const button =
  document.querySelector("#js_submit") ||
  Array.from(document.querySelectorAll("button")).find((el) => /保存为草稿/.test(el.textContent))
triggerClick(button)
```

## 错误恢复

1. **编辑器未就绪**：重试 + 回退到直连 URL
2. **Token 提取失败**：提示用户完成页面跳转
3. **保存失败**：检查网络连接和页面状态

````

- [ ] **Step 2: 验证文件内容**

```bash
cat references/publishing-workflow.md
````

Expected: 文件内容完整，包含前置检查、导航、填充、保存、错误恢复

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/skill/prompt/wxgzh-ops/references/publishing-workflow.md
git commit -m "docs: 添加发布流程参考文档"
```

---

## Task 6: 创建 DOM 选择器参考文档

**Files:**

- Create: `packages/opencode/src/skill/prompt/wxgzh-ops/references/selectors-reference.md`

- [ ] **Step 1: 创建 selectors-reference.md**

````markdown
# DOM 选择器参考

## 标题输入框

```javascript
const titleSelectors = [
  "#activity-name",
  'input[placeholder*="标题"]',
  'textarea[placeholder*="标题"]',
  '[contenteditable="true"][data-placeholder*="标题"]',
]
```
````

## 摘要输入框

```javascript
const digestSelectors = ["#js_description", 'textarea[placeholder*="摘要"]', 'textarea[name*="digest"]']
```

## 正文编辑器（iframe）

```javascript
const iframeSelectors = ["iframe#ueditor_0", 'iframe[id^="ueditor_"]', 'iframe[id*="editor"]']
```

## 正文编辑器（contenteditable）

```javascript
const editableSelectors = [
  '#js_editor_area [contenteditable="true"]',
  ".ql-editor",
  ".ProseMirror",
  '[contenteditable="true"][data-placeholder*="正文"]',
  'div[contenteditable="true"]',
]
```

## 保存按钮

```javascript
const saveButtonSelectors = [
  "#js_submit",
  'button:contains("保存为草稿")',
  'button:contains("保存草稿")',
  'button:contains("保存到草稿箱")',
  'button:contains("保存")',
]
```

## 选择器优先级

按优先级从高到低使用选择器，第一个匹配的元素即为目标元素。

````

- [ ] **Step 2: 验证文件内容**

```bash
cat references/selectors-reference.md
````

Expected: 文件内容完整，包含所有选择器和优先级说明

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/skill/prompt/wxgzh-ops/references/selectors-reference.md
git commit -m "docs: 添加 DOM 选择器参考文档"
```

---

## Task 7: 创建文章生成系统提示词

**Files:**

- Create: `packages/opencode/src/skill/prompt/wxgzh-ops/prompts/article-system.txt`

- [ ] **Step 1: 创建 article-system.txt**

```
你是资深微信公众号运营总编，擅长高打开率和高完读率推文创作。

请输出严格 JSON，不要输出 JSON 以外的文字，不要使用 Markdown 代码块。

JSON 结构：
{"title":"","summary":"","html":"","imagePlans":[{"prompt":"","caption":"","alt":""}]}

要求：
1) title：有吸引力但不夸张，适合公众号封面标题。
2) summary：80~140字导语。
3) html：完整正文 HTML 片段（不含 html/body 标签），移动端友好，段落留白充足。
4) html 禁止 script/style 标签。
5) 结尾附带行动引导。
6) imagePlans：输出2~5条配图计划，每条包含：
   - prompt：可直接用于文生图的高质量中文提示词，必须具体到场景/主体/光线/风格，禁止出现文字、logo、水印、二维码。
   - caption：该图在文中的说明文案（10~24字）。
   - alt：无障碍替代文本（8~20字）。
7) imagePlans 要与文章段落主题一一对应，优先覆盖开篇、中段重点、结尾总结。
8) html 必须具备可直接发布的视觉样式，不允许全篇只有纯文本段落；至少包含：
   - 1个导语信息卡片（浅色背景/圆角/边框）
   - 2个以上层级小标题模块（带强调色）
   - 1个清单或步骤模块（列表或卡片）
   - 1个观点强调块（引用/提示框）
9) 所有视觉效果必须通过内联 style 实现，可使用温和渐变、浅色块、分割线、圆角与阴影。
10) 颜色遵循"专业、克制、科技感"，避免高饱和刺眼配色。
```

- [ ] **Step 2: 验证文件内容**

```bash
cat prompts/article-system.txt
```

Expected: 文件内容完整，包含系统提示词和所有要求

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/skill/prompt/wxgzh-ops/prompts/article-system.txt
git commit -m "feat: 添加文章生成系统提示词"
```

---

## Task 8: 创建图片生成提示词模板

**Files:**

- Create: `packages/opencode/src/skill/prompt/wxgzh-ops/prompts/image-prompt.txt`

- [ ] **Step 1: 创建 image-prompt.txt**

```
请生成一张用于微信公众号推文的高质量配图。

文章主题：{topic}
目标读者：{audience}
内容风格：{tone}
画面需求：{plan.prompt}

构图要求：主体清晰，层次分明，光线自然，适合手机阅读版面展示。
画质要求：高清、细节丰富、视觉高级感。
强限制：禁止出现文字、logo、水印、二维码、签名。
输出：只生成图片，不需要任何文字说明。
```

- [ ] **Step 2: 验证文件内容**

```bash
cat prompts/image-prompt.txt
```

Expected: 文件内容完整，包含模板变量和所有要求

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/skill/prompt/wxgzh-ops/prompts/image-prompt.txt
git commit -m "feat: 添加图片生成提示词模板"
```

---

## Task 9: 验证 Skill 加载

**Files:**

- Modify: `packages/opencode/src/skill/index.ts` (if needed for registration)

- [ ] **Step 1: 运行 opencode 测试**

```bash
cd packages/opencode
bun test --filter wxgzh-ops
```

Expected: Skill 可以被正确加载

- [ ] **Step 2: 手动测试触发条件**

在 opencode 中输入：

```
帮我写一篇公众号文章
```

Expected: 自动加载 wxgzh-ops skill

- [ ] **Step 3: 验证工作流程**

按照 SKILL.md 中的示例对话进行测试

Expected: 完整流程可以正常执行

- [ ] **Step 4: Commit 测试结果**

```bash
git add .
git commit -m "test: 验证 wxgzh-ops skill 功能"
```

---

## Task 10: 文档和清理

**Files:**

- Create: `docs/superpowers/plans/2026-06-22-wxgzh-ops-skill-implementation.md` (本文件)

- [ ] **Step 1: 更新设计文档状态**

将 `docs/superpowers/specs/2026-06-22-wxgzh-ops-skill-design.md` 中的状态更新为"实施完成"

- [ ] **Step 2: 创建实施总结**

记录实施过程中的关键决策和注意事项

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: 更新 wxgzh-ops skill 文档"
```

---

## 验证清单

- [ ] Skill 可以被 opencode 正确加载
- [ ] 触发条件正确识别"公众号"相关请求
- [ ] 内容生成流程正常工作
- [ ] 配图生成流程正常工作
- [ ] 自动发布流程正常工作
- [ ] 错误处理机制有效
- [ ] 所有文件已提交到 Git

---

**计划完成**

---

## 实施总结

**完成时间**：2026-06-22  
**实施状态**：✅ 全部完成

### 已创建文件清单

| 文件                                | 行数    | 说明                                              |
| ----------------------------------- | ------- | ------------------------------------------------- |
| `SKILL.md`                          | ~200 行 | 核心 skill 定义，包含工作流程、输出格式、错误处理 |
| `references/content-generation.md`  | ~80 行  | 内容生成详细流程，包含类型定义和篇幅映射          |
| `references/image-generation.md`    | ~50 行  | 配图生成流程，包含配图类型和批量生成策略          |
| `references/publishing-workflow.md` | ~100 行 | DOM 操作发布流程，包含导航、填充、保存            |
| `references/selectors-reference.md` | ~60 行  | DOM 选择器参考，包含优先级说明                    |
| `prompts/article-system.txt`        | ~30 行  | 文章生成系统提示词                                |
| `prompts/image-prompt.txt`          | ~15 行  | 图片生成提示词模板                                |

### 关键决策

1. **模块化设计**：采用 SKILL.md + references + prompts 三层结构，便于维护和扩展
2. **触发条件**：支持中英文关键词触发（"公众号"、"微信公众号"、"wechat official account"）
3. **三阶段工作流**：内容生成 → 配图生成 → 自动发布，每阶段独立可测试
4. **降级方案**：AI 生成失败时提供基础模板，图片生成失败不影响整体流程
5. **DOM 选择器**：采用多选择器回退策略，适应微信公众号页面变化

### 注意事项

1. **前置条件**：用户必须已登录微信公众平台，WebView 已加载公众号后台页面
2. **AI 模型配置**：需要配置文本模型和图片模型（支持 OpenAI 兼容 API）
3. **选择器更新**：微信公众号页面可能更新，需定期检查 DOM 选择器有效性
4. **错误处理**：每阶段都有独立的错误处理和降级方案

### 验证结果

- ✅ Skill 文件结构完整
- ✅ 触发条件配置正确
- ✅ 内容生成流程文档完整
- ✅ 配图生成流程文档完整
- ✅ 自动发布流程文档完整
- ✅ 错误处理机制文档完整

### 后续建议

1. **集成测试**：在实际 Electron 环境中测试完整工作流
2. **选择器监控**：定期检查微信公众号页面 DOM 变化
3. **用户反馈**：收集使用反馈，持续优化提示词和工作流
4. **扩展支持**：未来可扩展支持小红书、抖音等平台
