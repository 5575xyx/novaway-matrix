# AI文档排版优化设计

## 概述

优化 NovaWay 办公模式中 AI 文档技能的排版效果，提升生成的文档在 Web UI 中的美观度、结构清晰度和整体阅读体验。

## 需求

- **目标**：提升美观度、结构和格式
- **输出格式**：HTML（当前已经是 HTML，由 Markdown 渲染而来）
- **改进重点**：表格排版、标题层级、文本格式、整体布局
- **约束**：保持现有 Markdown 兼容性、性能影响最小化、易于维护和扩展

## 当前架构

```
Markdown 文本 → marked 库 → HTML → DOMPurify 清理 → morphdom 更新 DOM
```

- `packages/ui/src/components/markdown.tsx`：Markdown 渲染组件
- `packages/ui/src/context/marked.tsx`：marked 配置（含 Katex、Shiki 代码高亮）
- `packages/ui/src/components/markdown.css`：当前样式

## 方案

采用方案1：增强 marked 配置和 CSS 样式。改动最小，风险最低，快速见效。

### 具体改动

#### 1. CSS 样式改进

修改 `packages/ui/src/components/markdown.css`：

**表格样式改进：**
- 添加表格容器，支持横向滚动
- 表头背景色区分
- 行 hover 效果
- 圆角边框容器
- 最后一行的分隔线去除

**标题样式改进：**
- 按层级区分字号（h1=24px, h2=20px, h3=18px）
- h1 添加底部边框线
- 统一上下间距

**代码块样式改进：**
- 增加内边距和圆角
- 添加背景色区分

#### 2. 响应式支持

添加媒体查询，确保在 768px 以下设备上：
- 表格字号缩小
- 标题字号缩小
- 表格内边距缩小

### 边界情况

- 无内容：保持空白
- 表格溢出：自动滚动
- 大段内容：利用现有缓存（200条限制）
- 嵌套表格：不特殊处理

### 不修改的部分

- 提示词文件（`office-document.md`）
- marked 渲染器配置（保持现有渲染逻辑）
- 其他组件样式

## 测试策略

- 视觉回归：确认样式不溢出其他组件
- 响应式：验证 768px 宽度下的显示效果
- 手动验证：AI 文档实际生成结果

## 交付物

1. 修改后的 `markdown.css` 样式文件
