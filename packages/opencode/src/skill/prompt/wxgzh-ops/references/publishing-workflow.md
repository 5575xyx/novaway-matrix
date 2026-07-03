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
const keywords = [/写新图文/, /新建图文/, /写文章/, /新建文章/];
// ... 点击逻辑
```

### 方式 2：直连编辑器 URL

```javascript
const editorUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&lang=zh_CN&token=${token}`;
```

## 填充内容

### 标题填充
```javascript
const titleEl = document.querySelector('#activity-name') || 
                document.querySelector('input[placeholder*="标题"]');
```

### 摘要填充
```javascript
const digestEl = document.querySelector('#js_description') || 
                document.querySelector('textarea[placeholder*="摘要"]');
```

### 正文填充
```javascript
// 优先使用 iframe
const iframeEl = document.querySelector('iframe#ueditor_0');
if (iframeEl && iframeEl.contentWindow.document.body) {
  iframeEl.contentWindow.document.body.innerHTML = html;
} else {
  // 回退到 contenteditable
  const editable = document.querySelector('#js_editor_area [contenteditable="true"]');
  editable.innerHTML = html;
}
```

## 保存草稿

```javascript
const button = document.querySelector('#js_submit') || 
              Array.from(document.querySelectorAll('button'))
                .find(el => /保存为草稿/.test(el.textContent));
triggerClick(button);
```

## 错误恢复

1. **编辑器未就绪**：重试 + 回退到直连 URL
2. **Token 提取失败**：提示用户完成页面跳转
3. **保存失败**：检查网络连接和页面状态