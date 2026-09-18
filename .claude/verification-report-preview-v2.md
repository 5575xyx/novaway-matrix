# 预览 V2 验证报告：分屏 + dev server 自动发现

生成时间：2026-09-14
设计契约：`.claude/context-summary-preview-v2.md`

## 1. 验证环境

- 平台：Windows PowerShell，Bun 1.3.14
- 类型检查器：`tsgo -b`（`bun typecheck`）
- Lint：根目录 `oxlint`（130 rules / 16 threads）
- 测试：`bun test`，UI 相关用例带 `--preload ./happydom.ts`
- 桌面端无法实机运行（规则禁止后台起服务），故只做类型与静态校验，行为验收留给人工

## 2. 命令与结果

| 命令                                                  | 工作目录           | 结果                        |
| ----------------------------------------------------- | ------------------ | --------------------------- |
| `bun typecheck`                                       | `packages/app`     | 0 错误，EXIT=0              |
| `bun typecheck`                                       | `packages/desktop` | 0 错误，EXIT=0              |
| `bun test --preload ./happydom.ts <7 个相关用例文件>` | `packages/app`     | 41 pass / 0 fail，169 断言  |
| `bun test --preload ./happydom.ts ./src`              | `packages/app`     | 570 pass / 8 fail / 1 error |
| `bun run lint <15 个改动文件>`                        | 仓库根             | 34 warnings / 0 errors      |

### 全量测试的 8 fail + 1 error 判定为基线，与本轮改动无关

失败全部落在本轮**未触碰**的模块：

- `src/components/file-tree.test.ts`（1 fail）
- `src/utils/model-name.test.ts`（2 fail）
- `src/components/prompt-input/submit.test.ts`（4 fail，`modelsCtx.autoMode` 为 undefined）
- `src/pages/session/message-timeline.data.test.ts`（1 error，`@solidjs/router` 未导出 `useLocation`）

已用 `Select-String` 确认上述模块不含 `preview` / `devServer` / `viewMode` 相关引用（仅 `submit.ts` 有一个无关的 `preview?: string` 字段）。

### oxlint 34 warnings 判定为基线

其中 2 条落在本轮新增文件（`context/preview.tsx:9`、`context/dev-server.tsx:11`），规则 `typescript-eslint(unbound-method)`，指向 `createSimpleContext({ use ... })`。对既有 `context/terminal.tsx` + `context/command.tsx` 单独跑同一命令得到 8 条同类 warning —— 即**每个** `createSimpleContext` 调用点都会触发，属于仓库既有风格，非新增问题。其余 32 条分布在 `session.tsx` 等文件的 `consistent-return` / `unbound-method`，行号均不在本轮改动范围内。

## 3. 逐条验收标准自评

| #   | 标准                                                              | 状态             | 依据                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 标题栏按钮循环 chat → split → preview → chat，图标与 tooltip 同步 | 静态通过，待人工 | `layout.tsx:941-947` `toggle()` 三态循环；`session-header.tsx` 图标三态 `layout-right` / `layout-right-partial` / `layout-right-full`，`text-icon-strong` 判定改为 `!== "chat"`        |
| 2   | split 下可横向拖拽，拖拽无过渡动画，拖到 320 以下不折叠           | 静态通过，待人工 | `ResizeHandle direction="horizontal" edge="start" min={320}`；宽度持久化到 `layout.previewWidth`，`previewMaxWidth()` 上限 `窗口宽 × 0.6` 且不低于 320；未接 `onCollapse`，故不会折叠  |
| 3   | 刷新/重启后 split 宽度与模式按会话恢复                            | 静态通过         | `layout.tsx:110-112` `previewWidth?: number` 与 `viewMode?` 均在持久化的 sessionView 形态内；宽度走 `previewWidth.set()` 落库                                                          |
| 4   | 终端打印 dev server 后浮出建议条，点「打开」填入地址并切到 split  | 静态通过，待人工 | `terminal.tsx:579` `devServers.report(data)` 在 `output.push` 之前、且仅走 string 分支（控制帧 L574 提前 return）；`dev-server.tsx:56-62` `accept()` 写 URL 并 `viewMode.set("split")` |
| 5   | 忽略后不重复弹；不同端口分别弹                                    | 单测通过         | `utils/dev-server-detect.test.ts` 15 例覆盖去重、多端口、ANSI、跨 chunk、`0.0.0.0 → localhost`                                                                                         |
| 6   | 切换 workspace 后建议重置                                         | 静态通过         | `dev-server.tsx:23-37` `createEffect` 监听 `sdk.directory` 与 `sessionKey()`，换目录重建 detector 去重集合、换会话清空 pending；Provider 本身也在 keyed Show 内随目录重挂              |
| 7   | typecheck / oxlint / i18n parity 全绿；新增单测通过               | 通过             | 见第 2 节；`preview-url.test.ts` 6 例、`dev-server-detect.test.ts` 15 例、`parity.test.ts` 1 例均绿                                                                                    |

## 4. 与设计契约的偏差

1. **Provider 挂载位置改为 `pages/directory-layout.tsx`**（契约写的是 `app.tsx`）。原因：`usePreview` 需要 `Persist.workspace(directory)`、`useDevServers` 需要 `useSessionLayout()` 的 `useParams()`，两者都必须位于 `/:dir` 路由作用域内；且挂在 `<Show when={resolved()} keyed>` 里可保证换工作区自动重建，与 `SDKProvider` 的生命周期一致。
2. **未做标题栏建议角标**。浮动建议条已承担提示职责，角标会与其信息完全重复，故删除。`session-header.tsx` 只保留三态图标 + 三态 tooltip 文案。
3. **建议条定位在会话内容行内**，而非会话面板右下角。给内容行容器补了 `relative`，使 `bottom-3 right-3` 落在 composer 之上而不遮挡输入框。
4. **`normalizePreviewUrl` 顺带修掉 3 个 V1 遗留缺陷**（由新增单测暴露）：
   - 裸 `localhost:3000` 被当成文件路径，得到 `file:///localhost:3000` → 现补 `http://`
   - `://` 未被拒绝，得到 `file:///://` → 现拒绝
   - `file:///`（只有根）未被拒绝 → 现要求 pathname 长度 > 1
     实现上把「盘符路径」「裸 localhost 地址」两类判断前置到通用协议判断之前，规避 `new URL` 把 `localhost:` 当协议解析的坑。
5. **`createSimpleContext` 必填 `name` 已补**（`"Preview"` / `"DevServer"`）。首次 typecheck 因此报 `TS2305`/`TS18046`/`TS2345`，同时 `createStore` 应从 `solid-js/store` 导入而非 `solid-js`，一并修正。

## 5. 未覆盖 / 需人工确认

- 桌面端本地文件预览（上一轮改动，涉及 `packages/desktop` 的自定义协议与 `oc-file`）本轮只做 typecheck，未实机点开文件验证。
- `message-timeline.data.test.ts` 的 `useLocation` 导出错误来自 `@solidjs/router@0.15.4` 包本身，与本轮无关，建议单独排查依赖版本。
- 分屏拖拽的手感（`min(px, 60%)` 与 `previewPaneWidth()` 在极端窄窗口下可能有细微不一致）需人工确认。

## 6. 实机首跑暴露的问题（已修）

**TDZ：`ReferenceError: Cannot access 'store' before initialization`（`previewMaxWidth`）**

`previewMaxWidth` 最初放在组件上半段，内部读 `store.view`，但 `const [store, setStore] = createStore(...)` 声明在更靠后。TS 不检查闭包内的前向引用（函数体被视为延迟执行），所以 typecheck 全绿；但 `previewPaneWidth = createMemo(...)` 在定义处**立即**求值，同步调到 `previewMaxWidth()` → 撞上 TDZ → 整个页面白屏。

修复：把 `previewMaxWidth` / `previewPaneWidth` 两行移到 `createStore` 之后，并留注释说明原因。教训是 `createMemo` / `createComputed` / `createEffect` 的首次执行是同步的，凡是被它们立即执行的引用都必须已初始化，不能靠"反正函数后面才会跑"来安排顺序。

已全量排查本轮新增代码的同类风险：其余 `createEffect` / `persisted` / `createStore` 调用所引用的绑定均已在其前声明；`use-session-commands.tsx` 的 handler 是纯回调，无立即执行问题。`ResizeHandle` 用 `splitProps` 代理，`size`/`min`/`max` 在 `mousedown`/`mousemove` 时才读取，传 memo 安全。

**composer 没跟着左栏收窄**

分栏最初只加在消息行（`content row`）内部，而对话框是会话面板的另一个子元素，位于消息行**之下**、横跨整个会话面板宽度 —— 于是分屏时聊天消息缩到了左边，输入框却仍然横跨到预览页下面。

修复：把分栏上提一层，左栏改成纵向 `flex flex-col`，同时装「消息容器（`flex-1 min-h-0`）」和「对话框（`shrink-0`）」，右栏只放预览。核对过 `session-composer-region.tsx` 根容器是 `shrink-0 w-full flex flex-col` 的普通流式布局，无绝对定位，所以换参照物不会错位。顺带确认 `centered()` 的居中现在是相对左栏宽度计算，行为正确。改完用 `bunx prettier --write` 只格式化了这一个文件。

## 7. 结论（Part A）

静态层面全部通过：两个包 typecheck 0 错误、oxlint 0 错误（warnings 均为基线）、新增 21 例单测全绿、相关回归 41 例全绿、全量 570 通过且失败项均在未触碰模块。验收标准 1–6 中依赖交互表现的 4 条（1、2、4、5 的呈现部分）需要人工实机确认。

---

# Part B：自动打开预览 + 预览内元素选取

补充时间：2026-09-16

范围：本地 dev server 首次出现自动打开预览；本轮新写入的 HTML 自动打开预览；预览里选中元素带进对话以便直接修改。

## 8. 命令与结果

| 命令                                                                                                                              | 工作目录           | 结果                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `bun typecheck`                                                                                                                   | `packages/app`     | 0 错误，EXIT=0                                                               |
| `bun typecheck`                                                                                                                   | `packages/desktop` | 0 错误，EXIT=0                                                               |
| `bun test --preload ./happydom.ts src/utils/preview-sources.test.ts src/utils/preview-pick.test.ts src/utils/preview-url.test.ts` | `packages/app`     | 17 pass / 0 fail，90 断言                                                    |
| `bun test --preload ./happydom.ts ./src`                                                                                          | `packages/app`     | 582 pass / 8 fail / 1 error（较基线 +17 例，新增全绿；失败项与基线完全一致） |
| `bunx oxlint <16 个改动文件>`                                                                                                     | 仓库根             | 22 warnings / 0 errors                                                       |

## 9. 首跑暴露并已修掉的 6 个问题

1. `preview-pick.ts` `TS2322 Type 'string[]' is not assignable to type 'string'` —— `styleList` 漏了 `.join("\n")`。后续重构为返回 `string[]`，`pickedElementComment` 改为按数组遍历；原来按字符串遍历会把说明拆成 `- c` / `- o` / `- l` 逐字换行，单测的 `toContain("color: rgb(59, 130, 246);")` 正好把它暴露出来。
2. `windows.ts` `TS2345 Buffer not assignable to BodyInit` —— 新增 `toBytes()` 把结果复制成 `Uint8Array`（Buffer 的底层 ArrayBuffer 可能被池化并带偏移，不能直接当 BodyInit）。
3. `windows.ts` `TS2345 Uint8Array<ArrayBufferLike> not assignable to BodyInit` —— 连带问题：`injectInspectorTag` 与内部 `splice` 的返回类型被 TS 5.7+ 的泛型 typed array 放宽成 `ArrayBufferLike`。三处统一收窄为 `Uint8Array<ArrayBuffer>`，并用 `new Uint8Array(new ArrayBuffer(n))` 保证落在非池化 buffer 上。
4. `session.tsx` `TS2345` / `TS18048` —— `SnapshotFileDiff.file` 是 `string | undefined`，循环里必须先判 `!file` 再进 `shouldAutoOpenHtml(file)` 与 `file.split(...)`。
5. `isExcludedPath(".\\git\\hooks\\index.html")` 误判为未排除 —— Windows 下 `.git` 按分隔符切成 `.` 与 `git` 两段，单段匹配漏掉。新增点号目录基名表 + 相邻段判定。
6. `previewFilePath("file:bad")` 返回 `/bad` —— 收紧为必须匹配 `^file://`，残缺输入直接返回 `undefined`。顺带修 `relativeToWorkspace`：原实现用整串相等（`value !== base`）判前缀，逻辑永远为 false；改为前缀匹配并要求前缀后是分隔符，避免 `E:/work` 误匹配 `E:/work2`。

## 10. 实现要点

**桌面端按字节注入 inspector**（`packages/desktop/src/main/preview-inspector.ts` + `windows.ts`）

- `preview-inspector.ts` 导出 `INSPECTOR_PATH = "/__nova_inspector.js"` 与 `INSPECTOR_SOURCE`（用 `String.raw` 保留正则里的反斜杠）。
- `windows.ts` 的 `protocol.handle` 改为 async；对 `file:` 与 `oc-file:` 入站的 HTML 响应统一走 `withInspector`：`latin1` 读写、在 `</body>`（或 `<body>`、或文件头）前拼 `<script src="oc-file://local/__nova_inspector.js">`，随后删除 `content-length` 与 `content-encoding`、设 `cache-control: no-store`。
- 选同源 `<script src>` 而非内联：内联会被页面自带 CSP 拦掉，同源请求不会。
- 选 `latin1` 往返：注入串是纯 ASCII，字节一一对应，不破坏 GBK/GB2312 等非 UTF-8 文档。
- inspector 脚本必须纯 ASCII（多字节字符会污染非 UTF-8 文档），提示文案由父端随 `PICK_ARM` 消息下发，保证 i18n 在父端。

**父端选取上下文**（`packages/app/src/context/preview-inspection.tsx`）

- `usePreviewInspection()` 返回 `{ready, armed, toggle, setFrame}`，init 收 `{directory}`。
- 来源校验用 `event.source !== frame.contentWindow` 直接丢弃，不比对 URL（`window.location.href` 可能被规范化）；`isPickMessage` 只做字段形状校验。
- `PICK_ARM` 是双向消息：父端下发开关，脚本侧 Esc 取消也回发同一条，两端状态自动同步。
- `addPicked` 用 `previewFilePath()` 取本机绝对路径、`relativeToWorkspace()` 转相对路径，产出 `{type:"file", path, comment, preview}`，复用现有 review 注释通道。
- `comment` 由父端组装成中性描述（CSS 路径 / 标签+属性 / 文本 / 关键样式 / ```html 源码片段），用户自己的修改要求写在正文；`preview` 只放短标签。

**自动打开**

- `context/dev-server.tsx` 重写：`report(chunk)` 内直接 `preview.setUrl` + `viewMode.set("split")` + toast，只返回 `{report}`；换目录或换会话重建 detector。
- `pages/session.tsx` 在 `turnDiffs()` 上新加 `createEffect(on(...))`，`autoOpenedHtml` Set 去重，跳过已排除目录与已是当前预览地址的；toast 文案用 `file.split(/[\\/]/).pop()`。
- 用 `turnDiffs` 而非 `vcsQuery`：后者只在 review 面板打开（`wantsReview()` 为真）时才 enabled。
- `pages/session/dev-server-suggestion.tsx` 已删除，`session.tsx` 的 import 与 `<DevServerSuggestion />` 一并移除。

**i18n**

- 删除 3 个已无引用的 `preview.suggestion.*`，新增 8 个：`preview.autoOpened` / `autoOpenedFile` / `pick.toggle` / `pick.unavailable` / `pick.hint` / `pick.added` / `pick.addedHint` / `pick.notFile`。`src/i18n/parity.test.ts` 在全量 582 pass 内通过。
- `ToastVariant` 只有 `default` / `success` / `error` / `loading`，没有 `warning`，故「当前预览不是本地文件」用默认样式。

## 11. 未覆盖 / 需人工确认

- 无浏览器 CDP、规则禁止起服务，**元素选取链路整条未验**：inspector 是否被页面成功取到（`oc-file://local/__nova_inspector.js`）、点击选取是否命中、Esc 是否取消、context chip 内容是否正确展示。
- dev server 自动打开、新 HTML 自动打开的**焦点行为**未验：会不会打断正在编辑的输入焦点。
- `withInspector` 改动了所有本地 HTML 响应的处理路径，需确认**非 UTF-8 编码页面**渲染仍正常（这轮注入是 latin1 字节往返，理论上无损，但未实机核对）。
- 元素选取只覆盖本地文件；dev server 场景下 iframe 跨源，父端收不到消息，按钮会置灰并提示——该降级路径未验。

## 12. 结论（Part B）

静态层面全部通过：`packages/app` 与 `packages/desktop` typecheck 均 0 错误，16 个改动文件 oxlint 0 错误，新增与相关的 17 例单测全绿，全量 582 pass 且失败项与基线完全一致。本轮共修掉 6 个首跑暴露的类型/逻辑缺陷。交互表现（元素选取、自动打开的焦点、跨源降级、非 UTF-8 页面）全部待人工实机确认。

---

# Part C：dev server 预览也能选取元素（2026-09-16）

## 13. 范围

之前元素选取只覆盖本机 HTML 文件（经 `oc-file:` 协议注入）。dev server 预览是跨源 iframe，`oc-file` 注入不进去，按钮永远置灰。本轮让 dev server 的 HTML 文档也能注入 inspector，使选取按钮在两种预览里都能用。

## 14. 方案

渲染进程把当前预览地址的源（origin）上报主进程；主进程用 `protocol.handle("http"/"https")` 在**网络层**拦截该源的文档响应，按字节注入同一段 inspector 脚本，其余 http 流量原样透传。

不改 `preview-inspector.ts`：脚本本身与来源无关，仍是纯 ASCII、经 `oc-file://local/__nova_inspector.js` 下发。本地文件走 `oc-file` handler，dev server 走 http handler，两条路径共用 `rewriteHtml()`。

## 15. 一处必须修正的递归陷阱

初版透传直接写 `net.fetch(request)`，查证 Electron 文档（`docs/api/net.md`）后确认这是**无限递归**：

> By default, requests made with `net.fetch` can be made to custom protocols as well as `file:` … When the non-standard `bypassCustomProtocolHandlers` option is set in RequestInit, custom protocol handlers will not be called for this request. This allows forwarding an intercepted request to the built-in handler.

文档给出的官方示例正是本方案的原型：

```js
protocol.handle("https", (req) => {
  if (req.url === "https://my-app.com") return new Response("<body>my app</body>")
  else return net.fetch(req, { bypassCustomProtocolHandlers: true })
})
```

因此在 `windows.ts` 里抽出 `passThrough(request)` 统一带 `bypassCustomProtocolHandlers: true`，handler 内三处透传（不匹配源 / 取响应 / catch 兜底）全部改走它。该选项在 Electron 42 的 `electron.d.ts` 中已有类型定义（`fetch(input, init?: RequestInit & { bypassCustomProtocolHandlers?: boolean })`），无需断言。

顺带把一条已失效的注释改掉了（原写「net.fetch 本身不走协议 handler」，与事实相反）。

## 16. 其余设计取舍

- **只改 GET + 只改命中的源**：非 GET（含 dev server 的 POST）与不匹配源直接透传，不构造也不读取 body。
- **SSE / WebSocket 不受影响**：`isHtmlResponse` 只看 content-type 与扩展名，`text/event-stream` 不会命中，返回的是原 `Response` 对象，body 流未被触碰；WebSocket 升级请求不走协议 handler。
- **CSP 必须一起剥**：注入脚本来自 `oc-file`，dev server 常带 `script-src 'self'` 会拦掉它。`rewriteHtml(response, stripCsp)` 对 http 分支删除 `content-security-policy` / `-report-only`；本地文件分支传 `false` 保持原行为。项目已声明安全优先级最低，此处取舍与之一致。
- **COEP 兜底**：inspector 响应加 `cross-origin-resource-policy: cross-origin`（+ `access-control-allow-origin: *`），开启 `Cross-Origin-Embedder-Policy` 的页面才允许加载跨源脚本。
- **主窗口用默认 session**：`createMainWindow` 的 `webPreferences` 没有 `partition`，`platform/platforms/*` 里的 partition 只用于第三方登录窗，所以挂在默认 session 上的 handler 对主窗口 iframe 生效。
- **异常全部兜底透传**：该 handler 覆盖主进程**全部** http 流量，抛错等于掐断 app 自己的请求。整个 handler body 包 try/catch，且 `registerPreviewHttpProtocol` 对 `protocol.handle` 本身也 try/catch——若某协议不允许接管，仅降级并写 warning，不影响 app。
- **`previewOrigin` 无 cleanup 解除**：`PreviewInspectionProvider` 按会话挂载，多个会话在同一目录可能先后挂载；若 onCleanup 里上报空串，卸载/挂载时序会造成误解除。改为只在地址变化时上报（地址清空即解除），残余源只影响预览 iframe 自己能访问的文档。
- **选取结果的分流**：地址能映射到工作区文件 → 仍走文件上下文（`preview.pick.addedHint`）；映射不到（dev server 虚拟路径）→ 用 `prompt.set` 把元素说明作为**正文文本段**追加到输入框末尾（`preview.pick.appendedHint`），图像附件保留在数组末尾，`start/end` 按其余片段累计长度计算。不新增 `ContextItem` 类型（现有类型只有 `FileContextItem`），也不改 composer 内部结构。
- **顺带修一处**：`isHtmlResponse` 的扩展名正则原来锚定 `$`，带查询串的 URL 永远匹配不上；改为 `(?:[?#]|$)`，参数改名 `source`（既可能是文件路径也可能是请求地址）。

## 17. 改动文件

桌面端：`main/windows.ts`（`passThrough` / `handlePreviewScheme` / `requestOrigin` / `registerPreviewHttpProtocol` / `setPreviewInspectorOrigin` / `rewriteHtml` / `inspectorResponse` 头 / `isHtmlResponse`）、`main/index.ts`（import + `app.whenReady` 后调用）、`main/ipc.ts`（`set-preview-inspector-origin` handler）、`preload/index.ts`、`preload/types.ts`。

应用端：`context/preview-inspection.tsx`（origin 上报 + `appendPromptText` + 分流）、`app.tsx`（`window.api` 声明补一项）、`i18n/zh.ts` 与 `i18n/en.ts`（改 `pick.unavailable`，新增 `pick.appendedHint`，删除已无引用的 `pick.notFile`）。

## 18. 命令与结果

| 命令                                     | 工作目录           | 结果                                                                                   |
| ---------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `bun typecheck`                          | `packages/app`     | 0 错误，EXIT=0                                                                         |
| `bun typecheck`                          | `packages/desktop` | 0 错误，EXIT=0                                                                         |
| `bun test --preload ./happydom.ts ./src` | `packages/app`     | 582 pass / 8 fail / 1 error，3071 断言，590 用例 90 文件 —— **与 Part B 基线逐项一致** |
| `bun lint <9 个改动文件>`                | 仓库根             | 25 warnings / 0 errors，EXIT=0                                                         |

`packages/desktop` 没有 `lint` 与 `test` 脚本（只有 `typecheck`），故桌面端只做类型校验。

25 条 warning 全部是仓库既有模式：`ipc.ts` / `index.ts` / `app.tsx` / `windows.ts` 的 `no-unsafe-type-assertion`、`consistent-return` 等，以及 `preview-inspection.tsx:23` 那条 `createSimpleContext({ use ... })` 触发的 `typescript-eslint(unbound-method)`（与 Part B 已确认的每个 `createSimpleContext` 调用点都会触发同一规则一致）。本轮新增代码 0 warning——过程中发现并删掉了 `preview-inspection.tsx` 里一个未使用的 `PICK_ELEMENT` import。

`src/i18n/parity.test.ts` 在全量 582 pass 内通过，确认删一个 key、加一个 key 后 zh/en 仍然对齐。

## 19. 未覆盖 / 需人工确认

本轮仍无法实机验证，且比 Part B 多一条链路：

- **http 拦截本身是否生效**：`protocol.handle("http")` 对标准协议接管成功与否只有实机日志能证明；失败时只写 warning 并降级为按钮置灰。
- **递归是否真的没发生**：`bypassCustomProtocolHandlers` 的类型定义与文档都支持，但未实机观察请求次数。
- **注入脚本在跨源沙箱 iframe 内是否可运行**：预览 iframe 带 `sandbox="allow-scripts allow-same-origin …"`，`oc-file:` 已注册为 `standard` + `secure`，理论上可加载，但需实机确认。
- **CSP 剥离是否真的必要且生效**：取决于具体 dev server（Vite / Next / Nuxt）是否下发 CSP。
- **app 自身 http 流量是否被误伤**：例如 `context/dev-server.tsx` 的端口探测如果请求了已上报的源，会拿到被改写（多一个 script 标签、`cache-control: no-store`）的文档响应。理论无害（不改 content-type、不改状态码），但值得留意。
- 其余 Part B 的待验项（点击命中、Esc 取消、context chip、自动打开焦点、非 UTF-8 页面）不变。
- `preview.pick.appendedHint` 追加正文的路径未经实机确认：`prompt.set` 在 composer 外部调用属于仓库既有做法（`prompt-input.tsx` 的历史回填与编辑回填同型），但需确认追加后输入框内容与光标位置正确。

---

# Part D：预览地址栏不再预填默认地址（2026-09-16）

## 20. 范围

实机反馈：地址栏一进来就写着 http://localhost:3000，但什么都没加载，纯粹是假的。删掉这个预填。

## 21. 改动

packages/app/src/pages/session/preview-panel.tsx：

- 删除 const DEFAULT_PREVIEW_URL = "http://localhost:3000"（全仓库唯一引用点在 store.draft 初值）。
- draft: url() || DEFAULT_PREVIEW_URL → draft: url()。
- go() 加空输入早退：if (!store.draft.trim()) return。空输入表示还没填，不是非法地址，弹红字报错在这里是噪音，占位文案已经说明了格式。

## 22. 命令与结果

| 命令                                                     | 结果                        |
| -------------------------------------------------------- | --------------------------- |
| un typecheck                                             | packages/app 0 错误，EXIT=0 |
| un lint packages/app/src/pages/session/preview-panel.tsx | 0 warnings / 0 errors       |

空状态 UI（preview.empty.description / .hint）本来就是按「没有地址」设计的，现在真正用上了；刷新/在浏览器打开按钮本来就有 disabled={!url()}，不受影响。
