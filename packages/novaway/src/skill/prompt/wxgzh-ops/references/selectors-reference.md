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

## 影子树与 iframe：为什么要"深度查询"

平台后台不是普通单文档页面，`document.querySelector` 只能看到最外层：

| 平台 | 元素实际在哪 | 查询方式 |
| --- | --- | --- |
| 公众号正文 | 同源 iframe `#ueditor_0` | `iframe.contentDocument.querySelector(...)` |
| 视频号 | wujie 微前端的 shadow root（`wujie-app.wujie_iframe`） | `host.shadowRoot.querySelector(...)` |
| 小红书发布按钮 | **closed** shadow root（`<xhs-publish-btn>` 内部） | 脚本进不去，只能按坐标点 |

`webview_snapshot` / `webview_click` / `webview_fill` 已经内置了深度查询：
会遍历主文档 → 同源 iframe → 开放 shadow root（最多 6 层）。

closed shadow root 没有编程入口，处理办法：

1. `webview_screenshot` 看清按钮位置；
2. `webview_script` 量宿主元素：`(() => { const h = document.querySelector('xhs-publish-btn'); const r = h.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`；
3. `webview_click_at` 点宿主里的按钮中心（发布在右半边）。

坐标是 CSS 像素，与截图同比例。
