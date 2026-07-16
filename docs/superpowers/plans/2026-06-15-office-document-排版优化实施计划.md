# AI文档排版优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 优化 AI 文档在 Web UI 中的排版效果，改进表格、标题、代码块和响应式设计

**Architecture:** 仅修改 `packages/ui/src/components/markdown.css` 一个文件，增强现有 CSS 样式。不改动 marked 渲染器或提示词内容。

**Tech Stack:** CSS, SolidJS UI 组件

---

### Task 1: 改进表格样式

**Files:**

- Modify: `packages/ui/src/components/markdown.css:228-251`

- [ ] **Step 1: 在 CSS 文件中找到表格样式区域**

读取 `packages/ui/src/components/markdown.css`，定位到第 228-251 行的表格样式部分。

- [ ] **Step 2: 替换表格样式为改进版本**

将第 228-251 行的现有表格样式替换为：

```css
/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 24px 0;
  font-size: var(--font-size-base);
  display: block;
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid var(--border-weak-base);
}

th,
td {
  padding: 12px 16px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--border-weaker-base);
}

th {
  color: var(--text-strong);
  font-weight: var(--font-weight-medium);
  background: var(--surface-base);
  border-bottom: 2px solid var(--border-weak-base);
}

tr:last-child td {
  border-bottom: none;
}

tr:hover td {
  background: var(--surface-hover);
}
```

- [ ] **Step 3: 验证样式语法正确性**

Run: `bun lint --filter=@novaway/ui`
Expected: PASS（无样式相关错误）

- [ ] **Step 4: 提交**

```bash
git add packages/ui/src/components/markdown.css
git commit -m "feat: 改进 AI 文档表格排版样式"
```

### Task 2: 改进标题样式

**Files:**

- Modify: `packages/ui/src/components/markdown.css:19-32`

- [ ] **Step 1: 替换标题样式为分层级版本**

将第 19-32 行的标题样式替换为：

```css
/* Headings: 按层级区分字号和间距 */
h1 {
  font-size: 24px;
  font-weight: var(--font-weight-bold);
  margin-top: 32px;
  margin-bottom: 16px;
  color: var(--text-strong);
  border-bottom: 2px solid var(--border-weak-base);
  padding-bottom: 8px;
}

h2 {
  font-size: 20px;
  font-weight: var(--font-weight-semibold);
  margin-top: 28px;
  margin-bottom: 14px;
  color: var(--text-strong);
}

h3 {
  font-size: 18px;
  font-weight: var(--font-weight-medium);
  margin-top: 24px;
  margin-bottom: 12px;
  color: var(--text-strong);
}

h4,
h5,
h6 {
  font-size: 16px;
  font-weight: var(--font-weight-medium);
  margin-top: 20px;
  margin-bottom: 10px;
  color: var(--text-strong);
}
```

- [ ] **Step 2: 验证样式语法正确性**

Run: `bun lint --filter=@novaway/ui`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/ui/src/components/markdown.css
git commit -m "feat: 改进 AI 文档标题层级排版样式"
```

### Task 3: 改进代码块样式

**Files:**

- Modify: `packages/ui/src/components/markdown.css:123-128`

- [ ] **Step 1: 替换代码块样式为改进版本**

将第 123-128 行的 `.shiki` 样式替换为：

```css
.shiki {
  font-size: 13px;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--border-weak-base);
  background: var(--surface-base);
  overflow-x: auto;
}
```

- [ ] **Step 2: 验证样式语法正确性**

Run: `bun lint --filter=@novaway/ui`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/ui/src/components/markdown.css
git commit -m "feat: 改进 AI 文档代码块排版样式"
```

### Task 4: 添加响应式支持

**Files:**

- Modify: `packages/ui/src/components/markdown.css`（文件末尾）

- [ ] **Step 1: 在文件末尾添加响应式媒体查询**

```css
@media (max-width: 768px) {
  h1 {
    font-size: 20px;
  }

  h2 {
    font-size: 18px;
  }

  h3 {
    font-size: 16px;
  }

  th,
  td {
    padding: 8px 12px;
  }
}
```

- [ ] **Step 2: 验证样式语法正确性**

Run: `bun lint --filter=@novaway/ui`
Expected: PASS

- [ ] **Step 3: 验证整体构建**

Run: `bun run build`（从 packages/ui 目录）
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/ui/src/components/markdown.css
git commit -m "feat: 添加 AI 文档排版响应式支持"
```
