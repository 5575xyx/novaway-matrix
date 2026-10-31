# 干净机器上的安装能力（没有任何运行时）

场景：用户刚装好系统，机器上没有 Node、npm、Python、uv、git，只有浏览器和网络。
这份文档说明 NovaWay 里哪些「安装类」功能能直接用、哪些需要什么前提，以及对应代码在哪里。

## 结论：默认全部可用

| 能力                                                       | 干净机器                  | 依据                                                                                                       |
| ---------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 插件市场 zip 安装                                          | ✅                        | 内核只用 HTTP 下载 + JSZip 解包，不需要任何外部命令                                                        |
| 插件市场 git 安装                                          | ✅                        | 有 git 走浅克隆；没有 git 走托管平台归档下载（GitHub codeload / Gitee archive）                            |
| npm 插件安装（PowersNexus 等）                             | ✅                        | 依赖解析在内核进程里用 `@npmcli/arborist` 完成；git 协议 spec 在没有 git 时先落成归档目录再按 `file:` 安装 |
| 默认 MCP 服务器（context7 / memory / sequential-thinking） | ✅                        | `npx` 缺失时用随包 Node + 随包 npm 的 `npx-cli.js`                                                         |
| 浏览器 MCP（playwright-mcp）                               | ✅                        | 随包 Node + 随包 playwright-mcp，浏览器用系统 Chrome/Edge                                                  |
| PPT / OCR 等 Python 技能                                   | ✅（需联网）              | 没有 Python 时下载 uv，用 uv 托管的 CPython 建独立 venv；Python < 3.9 也自动改用托管版本                   |
| 全局搜索 / ripgrep                                         | ✅                        | 随包 ripgrep                                                                                               |
| 用户自己加的 `uvx` MCP 服务器                              | ✅（需联网，首次约 30MB） | 缺 uv 时自动下载到 `Global.Path.bin`，再改写为 `uv tool run`                                               |
| 内置扩展（ppt-master）                                     | ✅（需联网）              | 启动后后台自动安装并准备 Python 环境，无需用户操作                                                         |
| 需要系统编译工具链的 npm 包                                | ❌                        | 与 ZCode 一致，不提供 C++ 构建环境                                                                         |

## 实现

### 1. 本地 MCP 命令解析

`packages/novaway/src/mcp/runtime.ts`：`planLocalCommand` 是纯函数，规则与 ZCode 的
`mcp-node-fallback` 一致 —— 用户自己的运行时永远优先。

- `node` 缺失 → 用 `NOVAWAY_NODE_PATH`（桌面端指向随包 Node）；
- `npx` / `npm` 缺失 → `node <npmRoot>/bin/{npx,npm}-cli.js ...`，并把 Node 目录前置到子进程 PATH
  （npm 包的 bin 常写 `#!/usr/bin/env node`）；
- `uvx` 缺失 → `uv tool run ...`（uv 在 PATH 或 `Global.Path.bin`）；
- 全都找不到 → 返回一句能直接给用户看的原因，而不是 `spawn ENOENT`。

入口在 `packages/novaway/src/mcp/index.ts` 的 `connectLocal`；诊断工具
`mcp_setup`（`tool/mcp-setup.ts`）用同一个解析结果，所以不会把「能靠内置运行时连上」的服务器误报成缺失。

### 2. 随包 Node 保留 npm

`packages/desktop/scripts/prebuild.ts` 的 `trimNodeRuntime` 现在只删 corepack。
保留 npm/npx 多约 13 MB（压缩后约 4 MB），换来默认 MCP 在干净机器上可用；
启动时会打印 `kept npm/npx for MCP fallback`，缺失时打印明确告警。

### 3. 没有 git 也能装仓库

- 扩展市场：`packages/novaway/src/extension/archive.ts` 负责拼归档地址
  （GitHub `codeload/<owner>/<repo>/zip/<ref>`、Gitee `repository/archive/<ref>.zip`），
  `Marketplace.installGit` 在没有 git 时改走这条路，装出来的目录结构与浅克隆一致。
- 插件里的 `git+https://...#ref` spec：`packages/novaway/src/plugin/git-archive.ts`
  把归档落到 `<cache>/git-archives/<hash>`，再以 `file:` spec 交给 arborist。

### 4. 默认 MCP 不再依赖 uvx

配置里的默认 MCP 列表不再塞 `uvx mcp-server-fetch`（网页抓取由内置 `webfetch` 工具覆盖）。
`npx` 默认命令改为按平台生成：Windows 用 `cmd /c npx ...`，macOS/Linux 直接 `npx ...`
（以前的配置在非 Windows 上会去找不存在的 `cmd`）。

`uvx` 型服务器缺 uv 时会自动下载（`packages/novaway/src/mcp/runtime.ts` 的 `ensureUv`，
每个进程只尝试一次，失败给出可读原因）。npm 型服务器仍然优先用用户自己的 `npx`，
其次随包 npm —— 不会在用户机器上偷偷装 Node。

### 5. 内置扩展启动时自动安装

清单在 `packages/core/src/builtin-extensions.ts`（市场 UI 与内核共用，不会漂移），
执行在 `packages/novaway/src/extension/provision.ts`，由 `Server.listen()` 之后后台触发
（`startProvisioning()`）：

1. 已装 → 跳过下载，只检查 Python 环境；
2. 没装 → 按 `kind` 安装（zip 走 JSZip，git 有 git 就浅克隆、没有就下归档，见第 3 节）；
3. 装完 `Generation.bump()`，扩展/技能缓存立即失效，不用重启；
4. 扩展带 `requirements.txt` → 立刻准备独立 venv（没有 Python 时 uv 托管 CPython）；
5. 任何一步失败只记日志 + 记 `extension-provision.json`，下次启动重试；
6. 用户手动卸载过的条目记 `dismissed`，不会偷偷装回来；手动再装时清除该标记。

关掉这张开关：`NOVAWAY_DISABLE_AUTOPROVISION=1`（测试默认开启此开关，见 `test/preload.ts`）。

### 6. 没有 Python 也能装 uv（再到 CPython）

uv 是单文件可执行程序（Windows 约 30 MB zip），由 `packages/novaway/src/python/venv.ts`
的 `downloadUv()` 用普通 HTTPS 下载后解包，**不依赖 Python、pip 或系统包管理器**。
拿到 uv 之后，`uv venv --python 3.12` 会自己下载 python-build-standalone 的 CPython，
再 `uv pip install` 装依赖 —— 整条链路只需要网络。

实测（Windows，无系统 Python、无 PATH 上的 uv）：

```
[detect] 未找到 Python，正在准备内置运行环境
[venv]   正在下载 Python 并创建独立环境   → Using CPython 3.12.11
[pip]    正在安装 clean 依赖
[verify] 正在验证安装结果
[done]   clean 已可用
```

如果机器上有 Python 但低于 3.9（`MIN_PYTHON`），同样按「没有可用 Python」处理，
改走 uv 托管版本 —— 旧 Python 上装 skia-pathops 会去现场编译然后失败。

### 7. 扩展/插件有没有官方更新

`Marketplace.updates()`（`packages/novaway/src/extension/marketplace.ts`）按安装方式分两条通道：

| 安装方式             | 判断依据                                             | 说明                                         |
| -------------------- | ---------------------------------------------------- | -------------------------------------------- |
| 浅克隆（有 `.git`）  | `git ls-remote <source> <ref>` 对比 `rev-parse HEAD` | 安装时把提交哈希写进 `.novaway-install.json` |
| 归档下载（干净机器） | 安装时记录的 ETag + `If-None-Match` 条件请求         | 304 = 分支头没动；ETag 变了 = 有新提交       |
| zip 包               | 无远端目录关联                                       | 返回 `unknown`，不猜                         |

结果挂在 `extension.marketplaceCatalog` 的 `updates` 字段上，市场页面据此显示「有更新」和
**更新**按钮（按安装记录重放一次安装，同 source/ref/subdir）。探测有总时间预算（默认 6 秒），
失败只返回 `unknown`，不会让市场页打不开。本功能上线前装的归档扩展没有 ETag，
返回 `unknown`；手动点一次更新后就会补上基线。

### 8. 网络要求

「只要正常联网就能装上」依赖下面几条链路，都在国内网络下做过兜底：
| 链路 | 直连 | 兜底 |
| ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 仓库归档 | `codeload.github.com` / `github.com/.../archive` | `https://ghfast.top/`、`https://ghproxy.net/`；`NOVAWAY_GITHUB_MIRROR` 可覆盖（逗号分隔，设了就只用自定义前缀） |
| uv 二进制 | GitHub release | 同上镜像前缀；`NOVAWAY_UV_URL` 可指向内网 |
| 托管 CPython | python-build-standalone (GitHub) | 直连失败自动换 `UV_PYTHON_INSTALL_MIRROR`（默认取镜像前缀）；`NOVAWAY_UV_MIRROR` 可覆盖 |
| Python 包 | PyPI | 失败后自动换清华镜像；`NOVAWAY_SKILL_PIP_INDEX` / `NOVAWAY_PIP_INDEX` 可覆盖 |
| npm 包 | registry.npmjs.org | 沿用 npm 配置（`NOVAWAY_NPM_CONFIG` / 用户 `.npmrc`） |

单个归档候选有 60 秒超时：被墙的域名不会把整次安装拖成几分钟。

## 边界

- 需要联网：归档下载、npm 安装、uv/Python 下载、模型调用都依赖网络；离线状态下只有随包能力可用。
- 私有仓库：归档通道只支持公开仓库的托管平台；私有仓库仍需要 git + 凭据。
- 与 ZCode 的差异：ZCode 用 Electron 自带 Node 当运行时，我们随包 Node 加 npm；
  ZCode 明确不在范围内支持 `uvx`/`python`/`bun`，我们额外覆盖了 Python（uv 托管环境）。
