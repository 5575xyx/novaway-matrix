# 平台发布手册（选择器 / 入口 / 判据）

这份手册对应 `packages/desktop/src/main/platform/publish/drivers.ts` 里的驱动配置。
**驱动改了就同步改这里** —— 模型和自动发布必须用同一套判断标准，否则会出现
「模型说发成功了、发布中心说找不到按钮」。

## 通用顺序

1. `webview_status`：确认页面开着、账号对、登录还在。
2. `webview_navigate`：进发布页（优先用下面表格里的入口）。
3. `webview_snapshot`：看表单结构和 ref（会自动下钻同源 iframe 与开放 shadow root）。
4. 上传素材 → 等上传完成 → 填标题/正文 → 选标签 → 提交。
5. **回读确认**：出现成功页或成功文案才算发完；没确认到就如实告诉用户。

## 各平台

### 公众号（wxGzh）

- 后台：`mp.weixin.qq.com`；编辑页需要 token，从地址栏或 `wx.data.t` 取。
- 正文在**同源 iframe `#ueditor_0`** 里，必须用 `webview_script` 下钻写入。
- **推荐直接建草稿**：`cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=...`，
  后台自己在用，比点编辑器稳，而且不会误触「群发」（不可撤销、有次数限制）。
- 成功判据：返回 `appMsgId`，拼出 `appmsgid=<id>` 的草稿地址。

### 小红书（xhs）

- 入口：`creator.xiaohongshu.com/publish/publish`。
- 上传：`input.upload-input`（或 `input[type=file]`）。
- 标题：`input[placeholder*="填写标题"]`；正文：`div.tiptap`（ProseMirror）。
- 发布按钮在 `<xhs-publish-btn>` 的 **closed shadow root** 里：脚本点不到。
  量宿主 `getBoundingClientRect()`，用 `webview_click_at` 点宿主右半边（发布在右、暂存在左）。
- 判据：宿主 `submit-disabled="false"` 时才可点。

### 抖音（douyin）

- 入口：`creator.douyin.com/creator-micro/content/upload`。
- 上传完成判据：**「取消上传」消失 且 出现「重新上传 / 上传成功」**。
  只看「上传成功」会误判（它一闪而过），只看「取消上传」也会误判（传输中也会出现）。
- 成功页：`/creator-micro/content/manage`。
- 发布页需要勾「AI 生成」标识（如果是 AI 内容）。

### 视频号（wxSph）

- 入口：`channels.weixin.qq.com/platform/post/create`。
- 整页在 **wujie 微前端**里（`wujie-app.wujie_iframe` 的 shadow root），
  直接 `document.querySelector` 找不到；`webview_*` 已内置深度查询。
- 提交按钮：`div.form-btns button`；成功页：`/platform/post/list`。

### 快手（kwai）

- 入口：`cp.kuaishou.com/article/publish/video`。
- 提交按钮是 `div[class*='button-primary']`，**注意排除侧边导航里的同名样式**。
- 上传没完成时点发布会弹「请等待上传完成」，所以要轮询重试，别当作失败。

### B站（bilibili）

- 入口：`member.bilibili.com/platform/upload/video/frame`（视频）/ `.../upload/text/edit`（专栏）。
- 标题：`input[placeholder="请输入稿件标题"]`；简介：`.desc-container .ql-editor`（Quill）。
- 上传大文件耗时长，别用固定超时判断失败。

## 失败速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 找不到元素 | 元素在 iframe / shadow root 里 | 用 `webview_snapshot`（深度查询），别自己写 `document.querySelector` |
| 点不动发布按钮 | closed shadow root | `webview_click_at` 按坐标点 |
| 填完是空的 | 富文本只认用户输入 | `webview_script` 里用 `execCommand("insertText")` |
| 上传一直转圈 | 大文件 / 弱网 | 等，并确认「取消上传」是否消失 |
| 公众号没 token | 页面不在后台域名 | 先导航到 `mp.weixin.qq.com` 让后台自己带出 token |
