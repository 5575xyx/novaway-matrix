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
