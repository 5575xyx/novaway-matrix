# 发布流程详细文档（内嵌浏览器）

发布走的是**用户在运营工作台里打开的那块公众号后台页面**，不是无头浏览器：

- 页面已经登录好，token 就在地址栏里；
- 每一个动作都显示在用户眼前，出问题他能立刻看见；
- `browser_*` 工具在这里是错的：它另起一个没有登录态的 Chrome，打开只有登录页。

## 前置检查

1. `webview_status` —— 确认 `platform` 是 `wxGzh`、`url` 含 `mp.weixin.qq.com`、`ready` 为 true。
   没有页面时它会返回明确错误：提示用户先在「运营工作台」选中该账号，不要让用户自己去点后台。
2. 页面不在公众号后台 → `webview_navigate` 到 `https://mp.weixin.qq.com/`。

## 提取 token

```js
location.href
```

用 `webview_script` 执行，从返回的 URL 里取 `token` 查询参数。没有 token 说明还没登录成功，
先让用户完成扫码登录，不要继续。

## 进入图文编辑器

优先走首页入口（更稳，能带上站点自己的一次性参数）：

1. `webview_snapshot`，在 refs 里找文本匹配 `写新图文 / 新建图文 / 写文章 / 新建文章` 的元素；
2. `webview_click` 点它；
3. 再 `webview_snapshot` 确认出现了 `#activity-name` 或 `iframe#ueditor_0`。

入口没找到时直连编辑页：

```
https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&lang=zh_CN&token=<token>
```

用 `webview_navigate` 打开，再用 `webview_snapshot` 等编辑器就绪。

## 填充内容

顺序固定：标题 → 摘要 → 正文。每步用 `webview_snapshot` 拿到 ref 再填，不要凭记忆写选择器。

### 标题

```js
document.querySelector("#activity-name") ||
document.querySelector('textarea[placeholder*="标题"]') ||
document.querySelector('input[placeholder*="标题"]')
```

用 `webview_fill`（自动处理 input/textarea/contenteditable 三种情况）。

### 摘要

```js
document.querySelector("#js_description") ||
document.querySelector('textarea[placeholder*="摘要"]')
```

同样用 `webview_fill`；摘要可以为空，但填了能让分享卡片更好看。

### 正文（富文本 iframe）

公众号正文在 `iframe#ueditor_0` 里，`webview_fill` 够不到，用 `webview_script`：

```js
(() => {
  const frame =
    document.querySelector("iframe#ueditor_0") ||
    document.querySelector('iframe[id^="ueditor_"]') ||
    document.querySelector('iframe[id*="editor"]')
  if (frame && frame.contentWindow && frame.contentWindow.document) {
    const body = frame.contentWindow.document.body
    body.innerHTML = HTML
    body.dispatchEvent(new Event("input", { bubbles: true }))
    return { ok: true, mode: "iframe" }
  }
  const editable = document.querySelector('#js_editor_area [contenteditable="true"], .ProseMirror')
  if (!editable) return { ok: false, error: "editor_not_found" }
  editable.innerHTML = HTML
  editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }))
  return { ok: true, mode: "contenteditable" }
})()
```

把 `HTML` 替换成文章正文的 HTML 字符串（转义后内联）。

## 保存草稿

1. `webview_snapshot`；
2. 在 refs 里找文本匹配 `保存为草稿 / 保存并群发 / 群发` 的按钮 —— **默认点「保存为草稿」**，
   群发是不可撤销的，只有用户明确要求"直接群发"才点群发；
3. `webview_click`；
4. 再 `webview_snapshot` 确认出现 `已保存 / 保存成功`。没看到提示就再等一次快照，不要重复点击。

## 错误恢复

| 现象 | 处理 |
| --- | --- |
| `webview_status` 报没有页面 | 让用户在「运营工作台」选中该公众号账号 |
| 地址里没有 token | 用户还没登录完，停下来请他扫码 |
| 编辑器一直不就绪 | 直连编辑页 URL；仍失败就截图 `webview_screenshot` 给用户看 |
| 填完标题/正文没变化 | 重新 `webview_snapshot` 取 ref —— 页面可能已经重渲染 |
| 保存后没有成功提示 | 用 `webview_screenshot` 确认页面状态，不要盲目重试 |
