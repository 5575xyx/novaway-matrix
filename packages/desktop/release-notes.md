## 本次更新

### 新增

- **运营工作台支持一站式多平台发布**：选好内容（视频 / 图文 / 文章）和素材，勾选多个平台的账号一次发布。发布过程逐个账号显示进度，单个平台失败不影响其它平台，支持中途取消；发布结果会保存下来，可在账号详情和发布弹窗里回看。
  - 目前支持：小红书、抖音、视频号（视频 + 图文）；B站、快手（视频）；公众号（文章）；闲鱼（图文）。
  - 不支持当前内容类型的平台会直接置灰并注明原因，不会再让你选完等到最后才失败。
- **更新体验整体升级**：
  - 更新包下载完成后，左上角的「更新」按钮会一直显示——哪怕你重启了应用、隔了几天才想起来装，点一下就直接安装，不需要重新下载；
  - 如果一个版本下载了还没装、线上又发了更新的版本，会自动改下最新版，安装时以最新为准；
  - 每次更新安装完成后，会自动清理掉用过的安装包，不再在磁盘上越积越多；
  - 断网时也依然可以安装已经下载好的更新。
- **对话过程中实时跟随文件写入**：任务执行时如果 AI 在修改文件，右侧面板会自动展开，以打字机效果实时看到文件的变更过程，完成后自动收起。对话框右上角有跟随开关——跟随中显示为绿色呼吸动画，未跟随为灰色，点击即可切换。

### 修复

- **运营工作台账号列表显示不出头像和用户名**：此前从旧版本迁移过来的账号，登录后列表里只有一串空白记录或「公众号」这样的占位文字。现在会自动补全账号资料：优先走平台接口，被风控拦截时自动改用登录态页面读取，打开工作台、点「检测登录」或重新登录都会触发补全，且不会用空数据覆盖已有的好数据。
- 修复了 PPT、Word 等 Office 文件生成或编辑后，右侧预览不会自动刷新的问题。

### 改进

- 平台接口请求统一改用 Chromium 网络栈（与登录窗口一致的浏览器指纹），降低被小红书、抖音等平台风控误拦的概率。
- 发布与资料读取的隐藏窗口用完即清，登录凭据不在磁盘长期留存。

---

## English

### New

- **One-stop multi-platform publishing** in the workspace: pick a content type (video / image-text / article), attach files, select accounts across platforms and publish once. Progress is shown per account, a failure on one platform doesn't stop the rest, and results are kept for review.
  - Supported today: Xiaohongshu, Douyin, WeChat Channels (video + image-text); Bilibili, Kuaishou (video); WeChat Official Account (article); Xianyu (image-text).
  - Platforms that don't support the chosen type are greyed out with a reason, up front.
- **Overhauled update experience**:
  - Once an update is downloaded, the update button stays visible — even after restarting the app days later, clicking it installs immediately without re-downloading;
  - If a newer version ships while a downloaded one sits uninstalled, the latest one is fetched automatically and that's what gets installed;
  - Used installers are cleaned up automatically after each update instead of piling up on disk;
  - Updates can be installed offline as long as they're already downloaded.
- **Live file-follow during tasks**: when the AI edits files, the side panel opens automatically and shows changes with a typewriter effect, then closes when done. A toggle above the composer shows green with a breathing animation while following, grey when off.

### Fixed

- **Missing avatars and nicknames in the workspace account list**: accounts migrated from older versions showed blank rows or placeholder text like "公众号". Profiles are now backfilled automatically — via platform APIs first, falling back to reading the logged-in page when risk control blocks the API. Never overwrites good data with empty values.
- Fixed Office files (PPT/Word) not refreshing the preview panel after being generated or edited.

### Improved

- Platform API requests now go through the Chromium network stack (same browser fingerprint as the login window), reducing false positives from Xiaohongshu/Douyin risk control.
- Hidden windows used for publishing and profile capture are wiped after use; credentials don't linger on disk.
