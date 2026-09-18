# Git 面板增强验证报告

生成时间：2026-09-17
范围：调研开源 TUI git 工具 → 增强 `packages/tui` 的 Git 侧栏 → 后端 Git HttpApi 组 → SDK 生成 → `packages/app` 前端 Git 面板

## 1. 改动清单

| 文件                                        | 改动                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| `packages/tui/src/util/git-status.ts`       | 新增 `parseGitNumstat` + `GitNumstatEntry` 类型（+49 行） |
| `packages/tui/test/util/git-status.test.ts` | 新增 `git numstat 解析` describe 块，5 个用例（+32 行）   |
| `packages/tui/src/component/git-panel.tsx`  | 每行 `+N -M` 统计、贮藏可点选列表、列宽重排（+94 行变更） |

## 2. 功能改动

### 2.1 每文件 `+N -M` 变更统计（对齐 lazygit / VS Code）

- `load()` 里并行多跑两条只读命令：`git diff --numstat -- .` 与 `git diff --cached --numstat -- .`
- 未暂存和已暂存是两次不同的 diff，同一个文件两边的数字不一样，分开存两个 signal
- 按路径建 `Map` 索引，文件行渲染时查表；`theme.diffAdded` / `theme.diffRemoved` 上色
- 二进制文件 git 给的是 `-` 占位（解析成 `0/0`），不显示统计以免误导——VS Code 也不显示
- 未跟踪文件不出现在 numstat 里（`git diff` 只看索引已有内容），所以不带统计，符合预期
- 失败兜底：两条 numstat 都 `.catch(() => ({ stdout: "" }))`，面板不显示统计但整页不报错

**列宽重排**（40 列内容区预算）：`FILE_LABEL_MAX` 24 → 19，腾出统计数字的位置。
状态码 2 + 文件名 19 + 缩进 1 + 统计 ~10 + 悬停"丢弃" 4 = 36，留 3 列余量。

### 2.2 贮藏列表可点选（原来只能盲弹最近一次）

- 原来的 `弹出贮藏 (N)` 是单按钮 `git stash pop`，只有 1 条贮藏时没问题，3 条时只能一条一条盲弹
- 现在显示最近 3 条（`STASH_MAX = 3`），`stash@{N}` + 截断说明，点哪条弹哪条
- `stash pop <ref>` 会把那条从贮藏里移除，属于不可逆操作，按面板既有约定先弹确认框
- 复用现成的 `parseGitStashList`，没有引入新组件
- `stashes().length === 0` 时整块不渲染，不占垂直空间

### 2.3 numstat 解析器

- `parseGitNumstat`：`新增\t删除\tpath`
- 两种重命名写法都取新路径：`src/old.ts => src/new.ts` 与 `src/{a => b}/index.ts`
  - **花括号形式的 `{` 前缀和 `}` 后缀是新旧共有的前后缀，必须保留**
  - 第一版实现丢了前缀（`src/{a => b}/index.ts` 被解析成 `b/index.ts`），测试抓住后已修
- 二进制用 `binary: true` 标记，数字记 0
- 脏行（没有 tab / tab 数不足）静默跳过

## 3. 验证证据

| 命令（工作目录）                                                                                                                            | 结果                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `bun test test/util/git-status.test.ts --timeout 30000`（packages/tui）                                                                     | **18 pass / 0 fail**（30 个 expect） |
| `bun test --timeout 30000`（packages/tui，全量 67 文件）                                                                                    | **298 pass / 1 skip / 0 fail**       |
| `bun typecheck`（packages/tui）                                                                                                             | **EXIT=0**                           |
| `bun lint packages/tui/src/component/git-panel.tsx packages/tui/src/util/git-status.ts packages/tui/test/util/git-status.test.ts`（仓库根） | **14 warnings / 0 errors**           |

注：lint 的 14 条 warning 全部是这两个文件既有的写法风格（索引访问的非空断言、`createSignal<string>("")` 的类型参数、`DialogAlert.show` 的 floating promise），改动前同 3 个文件是 16 条，本次改动净减 2 条。

### 3.1 测试覆盖的用例

- 普通行：`3\t5\tsrc/a.ts` → `{added: 3, removed: 5, binary: false}`
- 二进制：`-\t-\tassets/logo.png` → `{binary: true, added: 0, removed: 0}`
- 两种重命名写法都取新路径（含 `{` 前缀保留）
- 带空格的路径不被拆散
- 空输出 + 脏行不炸

## 4. 后端 Git HttpApi 组

### 4.1 改动清单

| 文件                                                       | 改动                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/novaway/src/server/routes/instance/httpapi/groups/git.ts` | 新建，`GitApi` 10 个端点 + `ApiGitError` + 全部 payload/schema（含 `GitSnapshot`） |
| `packages/novaway/src/server/routes/instance/httpapi/handlers/git.ts` | 新建，`gitHandlers` 全部端点实现 + 纯函数解析器                       |
| `packages/novaway/src/server/routes/instance/httpapi/api.ts`  | +2 行：`GitApi` import 与 `.addHttpApi(GitApi)`                       |
| `packages/novaway/src/server/routes/instance/httpapi/server.ts` | +4 行：`gitHandlers,`、`Git.defaultLayer,`、`import { Git }`          |

### 4.2 端点

| 端点            | 方法 | 说明                                    |
| --------------- | ---- | --------------------------------------- |
| `GET /git`      | 读   | 聚合快照（分支/变更/分支列表/远程/贮藏/log） |
| `POST /git/add`     | 写   | 暂存指定文件                             |
| `POST /git/unstage` | 写   | 取消暂存                                 |
| `POST /git/discard` | 写   | 放弃改动（未跟踪走 `clean -f`，已跟踪走 `checkout --`） |
| `POST /git/commit`  | 写   | 提交（索引为空时先 `add -A`）            |
| `POST /git/push`    | 写   | 推送（无上游时自动 `-u` 首个远程）       |
| `POST /git/pull`    | 写   | 拉取                                     |
| `POST /git/stash`   | 写   | 贮藏 / 弹出 / 丢弃                       |
| `POST /git/branch`  | 写   | 创建 / 切换 / 删除分支                   |
| `POST /git/remote`  | 写   | 远程操作                                 |

**读端点聚合一次，写端点执行后直接返回新快照**——前端不需要二次请求刷新，省一轮往返。
7 条只读 git 命令用 `Effect.all(..., { concurrency: "unbounded" })` 并行跑。

**变更行按暂存侧拆行**：同一文件 `MM` 状态时后端拆成两行，每行自带互斥的 `staged` / `unstaged` 标记和该侧的 `+N -M`。
二进制文件不显示统计，未跟踪文件不参与 numstat（`git diff` 只看索引内容）。

### 4.3 本轮修掉的一个后端装配陷阱

`createRoutes` 的 provide 列表里**没有任何层对外提供 `Git.Service`**——`Vcs.defaultLayer` 和 `File.defaultLayer`
都是 `layer.pipe(Layer.provide(Git.defaultLayer))`，那只是内部消费，`Git.Service` 既不导出也不作为剩余 requirement 留在依赖图里。
所以新增直接依赖 `Git.Service` 的 handler 必须**显式**把 `Git.defaultLayer` 加进 provide 列表。

漏加时表现为 `Type 'Service' is not assignable to type 'RouteRequirements'`，
报错信息**不会告诉你缺的是哪个 Service**——定位方法是临时摘掉本轮新增的 `.addHttpApi(GitApi)` 与 `gitHandlers,`，报错消失即确认归因。

### 4.4 顺手修掉一个阻塞全仓库 SDK 生成的遗留 bug

`packages/sdk/js/script/build.ts:12` 的相对路径硬编码成 `../../opencode`——这是 opencode 改名 NovaWay 时漏改的，
导致 `bun ./script/generate.ts` 从仓库根**根本跑不通**（`script/generate.ts` 的第一步就是调它）。已改为 `../../novaway`。
同类的遗留路径还有 2 处未动：`packages/sdk-v2-latest/script/build.ts:12`、`packages/console/app/package.json:10`。

### 4.5 验证证据

| 命令（工作目录）                                                                                     | 结果                  |
| ---------------------------------------------------------------------------------------------------- | --------------------- |
| `bun typecheck`（packages/novaway）                                                                   | **EXIT=0**            |
| `bun lint packages/novaway/src/server/routes/instance/httpapi/groups/git.ts .../handlers/git.ts .../api.ts .../server.ts`（仓库根） | **0 warnings / 0 errors** |
| `bun typecheck`（packages/sdk/js）                                                                    | **EXIT=0**            |

## 5. SDK 生成

- 入口必须是 `bun ./script/generate.ts`（直接 `./script/generate.ts` 在 PowerShell 下报 `CantActivateDocumentInPipeline`）。
- `generate` 命令是**一次性**输出 OpenAPI spec 后退出，不起监听端口，不违反"禁止启动服务"。
- 生成的 SDK 是分组类模式：`export class Git extends HeyApiClient`，
  `OpencodeClient` 通过 `get git(): Git` 暴露 → app 侧调用形态是 `sdk.client.git.snapshot()` 等。
- `packages/sdk/openapi.json` 已含全部 10 个 `/git*` 路径。

### 一个刻意不做的事

`build.ts` 的最后一步是 `rm openapi.json`，会把受跟踪的 `packages/sdk/js/openapi.json` 删掉。
已用 `git checkout --` 恢复，因此该文件现在**不含 git 端点**（停留在基线态），而 `packages/sdk/openapi.json` 含。
仓库里没有消费方引用 `packages/sdk/js/openapi.json`（只有 `build.ts` 把它当临时文件用），
`packages/docs/openapi.json` 是 `../sdk/openapi.json` 的符号链接——所以取舍是：保持受跟踪文件与 HEAD 一致，不提交一份陈旧 spec。

## 6. 前端 Git 面板

### 6.1 改动清单

| 文件                                                    | 改动                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/app/src/pages/session/git-panel.tsx`          | 新建，`GitPanel` 组件（轮询刷新 / 暂存与未暂存分组 / 提交框 / 分支 / 贮藏 / 历史） |
| `packages/app/src/pages/session/session-side-panel.tsx` | 接线：import、`Tabs.Trigger value="git"`、`Tabs.Content`、`setFileTreeTabValue` 放行 `"git"` |
| `packages/app/src/context/layout.tsx`                   | 3 处 file-tree tab 联合类型加 `"git"`（迁移守卫、默认值断言、`setTab` 形参） |
| `packages/app/src/i18n/en.ts`、`zh.ts`                  | 各 +33 个 `git.*` 键，插在 `"common.yes"` 之前               |

### 6.2 落点选择

**复用 file-tree 侧栏的 Tabs，新增一个「Git」页签**，不新增独立的 layout store 结构。
收益：面板的开关、宽度、尺寸记忆全部复用现有 `fileTree` 那段，改动面显著小于新起一个侧栏面板。
代价：VS Code 式"源代码管理独立侧栏"的形态没做到，后续需要时可以再升级。

页签标签用字面量 `Git` 不走 i18n（专有名词例外）；中文「源代码管理」在 50px 页签宽内会溢出。

### 6.3 行为

- 轮询 `GET /git`，间隔 5000ms；写操作直接消费返回的新快照，不等下一次轮询
- 批量操作（暂存/取消暂存/放弃）单次上限 `MAX_BATCH = 200`，避免一次塞太多文件
- 放弃改动走 `window.confirm` 二次确认——不可逆操作，且本轮无任何运行时验证手段，原生确认框零风险
- `push` / `pull` / `commit` 用禁用态表达"没有可执行的条件"（无改动、无提交信息、无远程）
- 分支区下拉切换 + 内联新建分支输入框，`Enter` 提交
- 提交信息 `TextField` 的 `onKeyDown` 是结构类型标注（`{ key: string; preventDefault }`），
  因为该组件不给事件参数做类型推导；仓库既有写法见 `settings-memory.tsx:725-730`

### 6.4 踩掉的三个 SDK 真实类型坑

| 现象                                        | 根因                                                                 | 修法                                              |
| ------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| `TextField onChange` 拿到 `event.currentTarget.value` 报 TS2339 | Kobalte `TextField` 根的 `onChange` 签名是 `(value: string) => void`，不是 DOM 事件 | 改成 `onChange={(value: string) => ...}`         |
| `onKeyDown` 参数隐式 any 报 TS7006          | 该组件不给事件参数推导类型                                           | 显式标注最小结构类型，零 import                    |
| `<Show when={count}>` 报 TS2322            | 传的是 `Accessor<number\|undefined>`，SolidJS 把函数当 truthy，不是 `Element` | `count` 改成纯 `number`，在 JSX 属性位置调用保持响应式 |

另外 `no-unsafe-type-assertion` 抓到了错误信息提取的重复断言，抽成 `messageOf(err: unknown)`，
用 `instanceof Error` / `typeof` / `in` 收窄，去掉全部类型断言。

### 6.5 验证证据

| 命令（工作目录）                                                          | 结果                        |
| ------------------------------------------------------------------------- | --------------------------- |
| `bun typecheck`（packages/app，`tsgo -b`）                               | **EXIT=0**                  |
| `bun lint packages/app/src/pages/session/git-panel.tsx`（仓库根）         | **0 warnings / 0 errors**   |
| `bun lint`（5 个改动文件，仓库根）                                        | **15 warnings / 0 errors**（全部来自 `layout.tsx`、`session-side-panel.tsx` 既有写法，非本轮引入） |
| `bun test src/i18n/parity.test.ts`（packages/app）                        | **1 pass / 0 fail**         |
| `bun test` 定向 5 个受影响文件（`layout.test.ts`、`layout-scroll.test.ts`、`pages/layout/helpers.test.ts`、`i18n/parity.test.ts`、`file-tab-scroll.test.ts`） | **30 pass / 0 fail** |
| `bun test`（packages/app 全量，90 文件）                                  | **582 pass / 8 fail / 1 error**——与本轮改动前基线完全一致 |

基线那 8 fail + 1 error 全在未触碰模块（`prompt-input/submit.test.ts` 的 `modelsCtx.autoMode` 未注入、
`message-timeline.data.test.ts` 依赖的 `@solidjs/router@0.15.4` 未导出 `useLocation`），不是本轮回归。

`parity.test.ts` 只校验 2 个硬编码键、不强制全量对齐，且其余 16 个 locale 靠 base 合并回退英文，
所以只补 en/zh 是安全的。

## 7. 未验证项（诚实声明）

**只能靠 typecheck / lint / 单测验证，没有任何运行时验证。**

后端服务进程在本轮开始前就已死掉（`127.0.0.1:55786` 无监听、4096/4444 未监听），浏览器工具也起不来
（未配置 CDP 端点），因此**新增的 10 条后端 HTTP 接口和整个前端面板都没有跑过一次真实请求**。
全部交互必须实机人工验收。

### 7.1 TUI 面板

1. `+N -M` 在 44 列最小宽度下的实际对齐——列宽预算是按 40 列内容区算的，`stash@{12}` 这类 10 位 ref 或 `+9999 -9999` 这类 4 位数字可能挤到边界
2. 贮藏列表的实际渲染（`stash@{N}` 高亮 + 说明截断）
3. 悬停"丢弃"按钮的出现时机是否被统计数字挤动——设计上"丢弃"占位恒定，但统计数字用 `flexGrow={1}` 的文件名顶开，两者叠加后的抖动需要眼睛看
4. 大仓库下每条 numstat 100ms 上下的实测耗时（`gitExec` 有 8 秒超时兜底）
5. 文件行的鼠标命中区——可点区域必须是独立 `text` 元素（`span` 挂不了鼠标事件），统计数字那块不可点

### 7.2 后端接口

6. 10 条端点的请求/响应真实往返（只能靠 typecheck 保证 Schema 与 handler 签名一致，没验证过 HTTP 层）
7. 各端点的错误路径文案（`ApiGitError` 的 message 是否好读）
8. `POST /git/discard` 对未跟踪文件走 `clean -f`、已跟踪文件走 `checkout --` 的分支判断，只验证了逻辑，没跑过真实仓库
9. `POST /git/push` 无上游时自动 `-u` 首个远程的选择结果

### 7.3 前端面板

10. `Tabs.Content` 的高度行为——`@novaway/ui/tabs` 组件本身没有任何 `[data-slot="tabs-content"]` 的 CSS 定义，
    只能用 `flex-1 min-h-0 overflow-hidden` 兜底；如果 Tabs 组件内部把非激活页签 `display: none` 之外还限制了尺寸，
    最坏情况是内容块退化为自适应高度而不是撑满侧栏
11. 轮询 5000ms 与实际操作的时序冲突（写操作返回快照后立即又被轮询覆盖一次，行为应无感但没测过）
12. i18n 键的实际文案位置与截断
13. 非 en/zh locale 回退英文后的可读性

## 8. 后续

- **实机验收**（最高优先，本轮完全缺失）：起服务 → 打开 web UI → 逐个走一遍 10 条端点与 Git 页签的每个按钮
- 文件/提交搜索过滤（本轮刻意没做：面板已有 `FILE_GROUP_MAX = 12` 分组截断，过滤的收益相对低，而新增可聚焦输入框的风险高）
- hunk 级暂存 `git add -p`（lazygit 的头号功能，需要驱动交互式子进程，独立一轮）
- 文件历史 / blame、rebase / 冲突解决（超出 40 列侧栏的承载范围）
- 修掉剩余 2 处 `packages/opencode` 遗留路径（`packages/sdk-v2-latest/script/build.ts:12`、`packages/console/app/package.json:10`）

## 9. 第二轮：Git 面板升级为独立侧栏（2026-09-17）

上轮把 Git 面板做成了 file-tree 侧栏的第四个页签。经确认产品目标是 VS Code 式独立面板，本轮改为独立侧栏。

### 9.1 改动清单

| 文件                                        | 改动                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/app/src/context/layout.tsx`       | 新增 `DEFAULT_GIT_PANEL_WIDTH = 260`、`git: { opened, width }` store 块、迁移守卫、`layout.git` API（open/close/toggle/resize）、`layout.sidePanelWidth` 汇总 memo；回收 `fileTree.tab` 的 `"git"` 联合类型 |
| `packages/app/src/pages/session/session-side-panel.tsx` | 移除 Git 页签 trigger 与 `Tabs.Content`；新增 `#git-panel` 容器（`gitOpen`/`gitWidth` + 独立 `ResizeHandle` 220-480）；`open`/`panelWidth` 改为纳入 git 面板 |
| `packages/app/src/pages/session.tsx`        | `desktopGitOpen`、`desktopSidePanelOpen` 纳入 git；`sessionPanelWidth` 改为 `calc(100% - (${sidePanelWidth}) - reserved)` |
| `packages/app/src/components/session/session-header.tsx` | 新增 Git 面板开关按钮（`branch` 图标，`aria-controls="git-panel"`）                 |
| `packages/app/src/pages/session/use-session-commands.tsx` | 注册 `git.toggle` 命令，快捷键 `mod+shift+g`                                          |
| `packages/app/src/components/settings-keybinds.tsx`      | `git.` 前缀归入 `Navigation` 分组                                                      |
| `packages/app/src/i18n/en.ts` / `zh.ts`     | 各 +1 键 `command.git.toggle`（"Toggle source control" / "切换源代码管理"）              |

### 9.2 关键设计点

1. **面板共存而非互斥**：git 面板与 file-tree 面板可以同时打开，各占一段固定宽度，各有各的 resize 手柄（都 `edge="start"`，拖各自左边缘）。位置顺序：review → git → file-tree。
2. **宽度算法不复制**：新增 `layout.sidePanelWidth` memo，把「已打开的右侧独立面板宽度」算成 `"260px + 200px"` 形式的字符串，`session-side-panel.tsx` 用它定 aside 宽度、`session.tsx` 用它反推 session 内容宽度。两个消费方共用一处计算，避免宽度公式分叉。
3. **`sessionPanelWidth` 用括号包住求和**：`calc(100% - (260px + 200px) - 0px)`。不加括号会退化成 `100% - 60px`，这是最容易踩的坑。
4. **git 面板关闭即卸载**：内容包在 `<Show when={gitOpen()}>` 里，关闭后 `GitPanel` 卸载，5 秒轮询随之停止；容器保留 `width: 0px` + 过渡动画。
5. **未复用 `settings.general.showFileTree()` 作为 git 开关的显示条件**：文件树有「显示文件树」设置项，git 面板不受它限制——关掉文件树的用户仍应有源代码管理入口。
6. **`git-panel.tsx` 本轮零改动**：它原本就自带一行面板头（`branch` 图标 + 分支名 + ahead/behind + pull/push），从页签挪到独立面板不需要补标题栏。

### 9.3 持久化与迁移

`Persist.global("layout", ["layout.v6"])` 未升版本号——新增的是可选键，旧状态缺失时靠两层兜底：
- `migrate` 里 `migratedGit`：`value.git` 不是对象时补 `{ opened: false, width: 260 }`，因与 `gitPanel` 不等会触发整体回写；
- API memo 全部 `store.git?.x ?? DEFAULT`，且 `setStore("git", ...)` 在缺失时先初始化（与 `fileTree` 块同一套防御式写法）。

### 9.4 验证证据

| 命令（工作目录）                                                                                                          | 结果                                        |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `bun typecheck`（packages/app，`tsgo -b`）                                                                                | **EXIT=0**                                  |
| `bun lint`（本轮改动的 8 个 app 文件，仓库根）                                                                            | **0 errors / 42 warnings**——逐行核对 warning 落点，全部落在本轮未触碰的行；`session-side-panel.tsx:157` 那条是原有的 `as "changes" | "all" | "review"` 断言写法，只是行号位移 |
| `bun test src/context/layout.test.ts src/context/layout-scroll.test.ts src/pages/layout/helpers.test.ts src/i18n/parity.test.ts`（packages/app） | **27 pass / 0 fail** |
| `bun test`（packages/app 全量，90 文件）                                                                                  | **582 pass / 8 fail / 1 error**——与上轮基线完全一致 |

### 9.5 本轮新增的未验证项

14. 两个面板**同时打开**时的实际宽度分配——`calc(100% - (A + B) - reserved)` 在真实浏览器里的表现只做了静态推演
15. 两个相邻 resize 手柄的拖拽边界（git 220-480 / file-tree 200-480），拖其中一个会不会意外影响另一个
16. 面板开合的 200ms 宽度过渡与 `GitPanel` 挂载时机是否协调（开着的时候内容才开始首次加载）
17. `mod+shift+g` 快捷键在真实编辑器焦点场景下是否与其它工具冲突（仓库内已确认未被占用）
18. 窄窗口下两个面板同时打开把 session 内容挤到极窄时的表现（无最小宽度协调逻辑）

## 10. 第三轮：工具调用超时收口（2026-09-18）

用户要求「加超时机制，防止会话一直卡在工具调用上」。先审计后动手。

### 10.1 审计结论

| 工具 / 路径 | 原状态 | 本轮 |
| ----------- | ------- | ---- |
| shell 工具 | **本就有**：默认 120s，可传 `timeout` 覆盖，超时杀进程（3s 强杀宽限），并提示模型带更大 timeout 重试 | 加了配置项 + 30 分钟硬封顶 |
| `Git.Service.run` | **完全无超时**——真实缺口。`repo_clone`、`Vcs`、`File`、10 条 git HttpApi 端点、TUI 全走它 | 默认 60s + `timeoutMs` 覆盖 |
| `repo_clone` 工具 | 无独立超时，全靠 `Git.Service` | clone/fetch 显式 10 分钟 |
| `push` / `pull` HttpApi 端点 | 同上 | 显式 5 分钟 |
| TUI / 桌面端 | 与后端**共用同一条执行链路**（TUI 只渲染后端工具调用结果） | 后端修一次，两边同时生效 |
| `lsp.ts`、`generate_image/video/narration.ts`、`browser.ts` | 无超时 | **刻意未覆盖**（见 10.4） |
| 终端面板 | 交互 PTY，用户正在操作，不该有超时 | 保持不变 |

关键发现：`AppProcess.run`（`packages/core/src/process.ts`）**本来就支持 `options.timeout`**，只是 git 层没透传。
所以收口点在 `Git.Service.run` 一处，不需要新增基础设施。

### 10.2 为什么超时真的能杀掉进程

`cross-spawn-spawner.ts` 的 `spawnCommand` 用 `Effect.acquireRelease`（371-400 行）包住子进程句柄。
`AppProcess.run` 的 `Effect.timeoutOrElse` 触发时中断 `Effect.scoped`，scope 关闭就跑 release finalizer：

- 子进程已退出 → 按 exit code 决定是否补杀；
- 子进程仍在跑（超时就是这个分支）→ 向**进程组**发 `killSignal`（默认 SIGTERM），配了 `forceKillAfter` 会升级为 SIGKILL；
- Windows 路径走 `taskkill /pid <pid> /T /F`。

即：**超时 → 中断 scope → finalizer → 杀进程组**，不是只放弃等待。

### 10.3 改动清单

| 文件 | 改动 |
| ---- | ---- |
| `packages/novaway/src/git/index.ts` | `DEFAULT_TIMEOUT_MS = 60_000`、`Options.timeoutMs?`、`Result.timedOut`、`timedOut()` 判定、向 `appProcess.run` 透传 `Duration.millis(...)` |
| `packages/novaway/src/reference/repository-cache.ts` | `input.timeoutMs?`；clone/fetch 默认 `NETWORK_TIMEOUT_MS = 10 分钟` |
| `packages/novaway/src/tool/repo_clone.ts` | 加 `Config.Service` 依赖，透传 `cfg.experimental?.git_timeout` |
| `packages/novaway/src/config/config.ts` | `experimental` 块新增 `bash_timeout` / `git_timeout`（`PositiveInt`） |
| `packages/novaway/src/tool/shell.ts` | `DEFAULT_TIMEOUT_MS = 2 分钟`、`MAX_TIMEOUT_MS = 30 分钟`；默认值改为「配置文件 > 环境变量 > 内置」；单次调用 `Math.min(timeout, 30 分钟)` 封顶 |
| `packages/novaway/src/tool/shell/prompt.ts` | `Limits` 加 `timeoutMs`/`maxTimeoutMs`，3 处提示词行改为动态渲染当前上限 |
| `packages/novaway/src/server/routes/instance/httpapi/handlers/git.ts` | `NETWORK_TIMEOUT_MS = 5 分钟` 用于 push/pull；超时错误透出明确文案 |
| `packages/novaway/test/git/git.test.ts` | +2 用例（见 10.5） |
| `packages/novaway/test/tool/repo_clone.test.ts` | 加 `Config.defaultLayer`（`repo_clone` 新增依赖后必需） |

配置优先级：`config.experimental.bash_timeout` > `NOVAWAY_BASH_DEFAULT_TIMEOUT` > 内置 2 分钟。
封顶 30 分钟防止模型传离谱值把会话挂死。

### 10.4 刻意未覆盖

- `lsp.ts`：LSP 是长驻进程 + 双向 stdio 协议，加「单次调用超时」需要重新设计为按请求计时的握手层，不是加一个参数能解决的。
- `generate_image.ts` / `generate_video.ts` / `generate_narration.ts`：走 HTTP 客户端，超时应该在 provider 的 fetch 层统一加；视频生成可能正常耗时数分钟，按现在的方式加会误杀。
- `browser.ts`：浏览器自动化同样需要按操作分类计时，不是单一超时值能覆盖的。

这三条都记为后续独立任务，没有硬塞一个全局超时进去。

### 10.5 验证证据

| 命令（工作目录） | 结果 |
| ---------------- | ---- |
| `bun typecheck`（packages/novaway，`tsgo --noEmit`） | **EXIT=0** |
| `bun lint`（本轮改动的 7 个 src 文件，仓库根） | **0 errors / 12 warnings**——全部落在未触碰行（`consistent-return`、`unbound-method`） |
| `bun lint packages/novaway/test/git/git.test.ts` | **0 errors / 0 warnings** |
| `bun test test/git/git.test.ts` | **11 pass / 0 fail**（9 原有用例 + 2 个新超时用例） |
| `bun test test/git test/patch test/reference` | **33 pass / 2 fail** |
| `bun test test/tool/repo_clone.test.ts` | **2 pass / 3 fail**——与基线**完全一致** |
| `bun test test/reference/reference.test.ts` | **2 pass / 2 fail**——与基线**完全一致** |
| `bun test test/tool/shell.test.ts -t "timeout"` | **2 fail / 1 error**——与基线**完全一致** |

#### 新增的两个超时用例（端到端证明）

```ts
// 永不结束的 stdin 让 git 一直等输入,不会自己退出,可以确定性地触发超时路径。
it.live("run() kills the command and reports timedOut when the timeout expires", () =>
  Effect.gen(function* () {
    const tmp = yield* scopedTmpdir({ git: true })
    const git = yield* Git.Service
    const started = Date.now()
    const result = yield* git.run(["apply", "--cached", "-"], {
      cwd: tmp.path,
      stdin: Stream.never,
      timeoutMs: 1_000,
    })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBe(1)
    ...
    expect(Date.now() - started).toBeLessThan(10_000)
  }),
)
```

这个用例同时证明了三件事：超时确实触发、`timedOut` 位确实置位、进程确实被杀掉（整个用例 8.4s 跑完，没挂死）。

#### 基线对照实验方法

对每个疑似回归的失败项，用 `git stash push` 摘掉本轮改动后重跑，结果一致即确认既有问题：

- `repo_clone.test.ts`：2 pass / 3 fail（改动前后一致）
- `reference.test.ts`：2 pass / 2 fail（同一用例 `refreshes configured git references on new instance init` 在 ~6.7s 失败；日志显示它在等 `github.com/opencode-reference-refresh/repo/README.md`，是**需要联网克隆**的用例，当前环境无外网）
- `shell.test.ts` 超时子集：2 fail / 1 error（改动前后一致；根因是 `echo started && sleep 60` 这类 bash 语法在 Windows PowerShell 5.1 下无法解析，且 `Shell.gitbash()` 指向的 Git Bash 未安装）

已用 `grep` 核对：本轮对 shell 提示词的动态化**没有破坏**测试断言的三处字符串
（"shell tool terminated command after exceeding timeout"、"exceeding timeout 500 ms"、"retry with a larger timeout value in milliseconds"），
它们在 `shell.ts:567` 完整保留。

#### 全量测试未能跑完

`bun test`（packages/novaway 全量）跑了 421s 后 **Bun 自身段错误崩溃**（栈在原生模块 `watcher.node`，非本轮代码）。
因此未采用全量结果，改用 git 相关子目录（`test/git` + `test/patch` + `test/reference`）做针对性回归，33 pass / 2 fail。

### 10.6 本轮新增的未验证项

19. **`bash_timeout` / `git_timeout` 配置项的实际生效**——只有 typecheck 保证 Schema 与读取路径一致，没有跑过带配置文件的真实进程
20. **shell 工具 30 分钟封顶的行为**——封顶逻辑本身无运行时验证（对应测试是 Windows 环境问题，见上）
21. **`git_timeout` 在 `repo_clone` 路径的生效**（`cfg.experimental?.git_timeout` 读取点）
22. **超时后子进程是否真的被系统回收**——测试只证明了调用返回且 `timedOut` 置位，没验证 PID 消失
23. **`push`/`pull` 5 分钟超时的真实触发**（需要一个真正慢的远端才能触发，本地无法模拟）
24. **默认 60s 是否合适**——`Git.Service.run` 现在对所有 git 调用加了一层 60s 上限，`Vcs`/`File`/TUI 全都受它约束。大仓库的 `git status` 或 `git diff` 若超过 60s 会从「一直等到完成」变成「报错」。这是一个**行为变更**，需要有人确认定值合理


