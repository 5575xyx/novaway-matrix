<p align="center">
  <img src="packages/desktop/icons/novaway-icon.svg" alt="NovaWay Matrix" width="120">
</p>

<h1 align="center">NovaWay Matrix</h1>

<p align="center">终端里的 AI 编程与办公自动化 Agent —— 为国产大模型与中文场景深度优化。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/xymt-novaway"><img alt="npm" src="https://img.shields.io/npm/v/xymt-novaway?style=flat-square&label=xymt-novaway"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square">
  <img alt="platform" src="https://img.shields.io/badge/platform-win--x64%20%7C%20mac--arm64%2Fx64%20%7C%20linux--x64-lightgrey?style=flat-square">
</p>

<p align="center">
  <b>简体中文</b> |
  <a href="README.en.md">English</a>
</p>

---

NovaWay Matrix 基于开源项目 [opencode](https://github.com/anomalyco/opencode) 构建，是一款 AI 编程与办公自动化 Agent，提供**终端（TUI）**与 **Electron 桌面端**两种形态。在原版能力之上，针对国内用户做了深度改造：内置国产大模型专属提示词、全中文界面与 NovaWay 品牌图标，以及 PPT / 小红书 / 公众号等中文办公技能。命令行入口为 `novaway`。

> 声明：本项目基于 opencode（MIT）二次开发，与 opencode 官方团队无任何关联。

## 安装

需要 Node.js ≥ 18（用于全局安装与 postinstall 解包）。支持 **Windows x64**、**macOS**（Apple Silicon 与 Intel）、**Linux x64**；npm 会按你的 `os` / `cpu` 自动只装匹配平台的二进制包，无需手动选择。

```bash
npm install -g xymt-novaway
```

装完直接运行：

```bash
novaway
```

### 国内加速（强烈建议）

平台二进制随 npm 分发（不再从 GitHub 下载），单个平台包约 **180 MB**。官方源在国内实测只有几十 KB/s，很容易超时；而平台包挂在 `optionalDependencies` 下，**下载失败时 npm 会静默跳过它**，紧接着 postinstall 报 `Try manually installing xymt-novaway-<os>-<arch>` 并回滚整个安装 —— 看着像包坏了，其实只是网慢。所以国内请走淘宝镜像：

```bash
npm install -g xymt-novaway --registry=https://registry.npmmirror.com --foreground-scripts
```

`--foreground-scripts` 只是把 postinstall 的输出打出来，便于确认二进制真的解包成功（可选）。想长期生效就把镜像设为默认源：

```bash
npm config set registry https://registry.npmmirror.com
```

如果镜像报 404 或版本偏旧，说明它还没同步到最新版，手动触发一次同步（约 1 分钟后重试安装）：

```bash
curl -X PUT "https://registry-direct.npmmirror.com/-/package/xymt-novaway/syncs"
curl -X PUT "https://registry-direct.npmmirror.com/-/package/xymt-novaway-windows-x64/syncs"
```

> 第二条把 `windows-x64` 换成你的平台：`darwin-arm64` / `darwin-x64` / `linux-x64`。

### 其他包管理器

```bash
pnpm add -g xymt-novaway
yarn global add xymt-novaway
bun add -g xymt-novaway
```

> `pnpm` 默认不执行 postinstall 脚本。若安装后运行 `novaway` 提示 `postinstall script was not run`，手动补跑一次：
> `cd $(pnpm root -g)/xymt-novaway && node postinstall.mjs`

### 验证安装

```bash
novaway --version     # 应打印版本号，如 0.1.5
novaway               # 进入 TUI
```

## 桌面端（Desktop）

除终端外，NovaWay 提供基于 **Electron** 的桌面应用（并非简单套壳），已替换为 NovaWay 品牌图标与中文界面，内置 16 种语言、支持自动更新（electron-updater）。它以 **Sidecar** 方式运行 `novaway` 内核，并提供两种形态：

**① 工作台窗口** —— 完整的 NovaWay 主窗口，承载 AI 编程与办公对话；支持自定义服务地址、深链（deep link）唤起、Windows 下的 WSL 配置。

**② 悬浮桌宠（Floating Pet）** —— 常驻桌面的悬浮精灵，可跟随光标、随时唤起：

- **两种显示模式**：`full`（完整）/ `minimal`（极简收起），一键切换。
- **可展开面板**，含两个标签页：
  - **任务监控** —— 实时查看正在运行的 Agent 任务进度（待处理 / 进行中 / 已完成 / 已取消）。
  - **通知** —— 汇集任务与运营事件提醒。
- **换肤** —— 内置多款桌宠皮肤（如 snow 等），并支持自定义颜色。

### 多平台账号与一键发布

桌面端内置国内主流内容平台的**登录态管理与自动化发布**能力，与内置技能（小红书 / 公众号运营等）配合形成「生成内容 → 发布运营」闭环，覆盖：

> 小红书、抖音、快手（含签名）、B 站、微信公众号、微信视频号、闲鱼

- **扫码/网页登录**并自动捕获、校验会话（登录态失效检测，支持批量检查）。
- **账号分组管理**（新增 / 编辑 / 删除分组、账号跨组移动）。
- **一键发布**内容到已登录账号。

### 打包与构建

可打包为 macOS（`.dmg` / `.zip`，Apple Silicon 与 Intel）、Windows（`.exe`，NSIS）、Linux（`.AppImage` / `.deb` / `.rpm`），产物名形如 `novaway-desktop-<os>-<arch>.<ext>`。

```bash
cd packages/desktop
bun run dev              # 本地开发调试
bun run package:win      # 打包 Windows（或 package:mac / package:linux）
```

## 亮点

- **国产大模型开箱即用** —— 为 DeepSeek、通义千问（Qwen）、智谱 GLM、Kimi、MiniMax、小米 MiMo 等分别内置了针对性系统提示词；同时兼容 Claude、GPT、Gemini。
- **全中文界面** —— 终端 TUI 与 Electron 桌面端均已中文化，并换上 NovaWay 品牌图标。
- **内置技能（Skills）** —— 一句话生成 PPT（office-ppt）、小红书运营（xiaohongshu-ops）、微信公众号运营（wxgzh-ops），以及文档 / 数据 / 会议 / 设计 / 网页等 Office 系列技能。
- **多 Agent 编排** —— 内置 Orchestrator 编排器：建立带依赖关系的任务计划，按拓扑顺序并发派生子 Agent 执行，并在任务间传递结果；配合 Workflow 编排复杂流程，支持后台并行开关。它对各主 Agent 默认可用、由模型按需调用（并非自动常驻运行），而 pulse-orchestrator 运营主 Agent 会主动借助它完成多步编排。
- **会话智能** —— 目标（goal）、检查点（checkpoint）、蒸馏（distill）等会话记忆与自我组织机制。
- **MCP 生态** —— 预置 context7（实时文档）、sequential-thinking、memory、browser、desktop-commander 等 MCP 服务。
- **数据库管理** —— 内置可视化数据库客户端：管理多个连接、树形浏览库/表/字段、直接执行 SQL 并查看结果。

## 内置 Agent

主 Agent 可用 `Tab` 键切换，分为三类：

### 开发

- **build** —— 默认主 Agent，按配置权限调用全部工具（读写文件、执行命令、跑测试）。特点是端到端完成编码任务，从实现到验证一站式落地。
- **plan** —— 只读规划 Agent，禁用一切编辑工具、执行命令前先询问。优势在于安全地探索陌生代码库、先定方案再动手，杜绝误改。

### 办公模式（Office）

一组专职「员工」Agent，把日常办公场景拆成各有所长的角色：

- **文档整理**（office-document）—— 写作、改写、审稿、方案、报告与周报 / 月报。优势：把零散素材整理成规范、可直接交付的结构化文档。
- **PPT 生成**（office-ppt）—— 汇报大纲、页级故事线、页面文案、图表建议与演讲备注。优势：从主题到完整故事线，配合 PPT 技能可直接产出 `.pptx`。
- **表格分析**（office-data）—— CSV / Excel 清洗、透视、趋势归因、图表建议。优势：把原始表格变成带结论的分析报告。
- **视觉设计**（office-design）—— 海报、封面、配图、品牌色板与视觉规范。优势：产出风格统一、符合品牌的视觉素材。
- **网页看板**（office-web）—— HTML 数据看板、项目追踪页、客户工具页与演示站点。优势：无需前端工程即可生成可用网页。
- **AI 会议**（office-meeting）—— 纪要、决议、行动项、负责人、截止时间与风险跟进。优势：把一场会议结构化为可执行清单。
- **AI 资料库**（office-knowledge）—— 资料摘要、多文档对比、知识索引与 FAQ。优势：沉淀可复用的项目知识并支持快速检索。
- **AI 任务**（office-task）—— 目标拆解、优先级、周计划、风险看板与依赖梳理。优势：把模糊目标转成可跟踪的执行节奏。
- **AI 沟通**（office-communication）—— 邮件、通知、商务表达、中英双语与语气改写。优势：快速产出得体、分寸到位的商务沟通文本。

### 运营

- **运营主 Agent**（pulse-orchestrator）—— 内容运营总控：分析用户意图，自动编排并协调子 Agent 分步完成运营任务。

此外还有 **general** / **explore** / **scout** 等内置子 Agent，供主 Agent 内部调用或用 `@` 唤起，负责复杂搜索、代码库探索与外部资料研究。

## 数据库管理

内置可视化数据库客户端（由 **dbx** 引擎驱动，集成在 Web UI 与桌面端中），让 AI 与你都能直接操作数据库：

- **多连接管理** —— 新增 / 移除 / 断开多个数据库连接，连接列表持久化保存。
- **树形浏览** —— 连接 → 数据库 → 表 → 字段逐级展开，查看列的类型、可空、默认值与注释。
- **SQL 查询** —— 直接编写并执行 SQL，结果以表格呈现。
- **多数据库类型** —— 支持 MySQL、PostgreSQL、SQLite、MariaDB、Doris、StarRocks 等。

可在命令面板用「打开数据库 / 关闭数据库」快速进入。

## 快速开始

1. 运行 `novaway`。
2. 选择模型并按提示填入对应服务商的 API Key（用国产模型直接选对应厂商即可）。
3. 在项目目录里开始对话：让它读代码、改代码、跑测试，或生成 PPT / 运营文案等。

## 更新

```bash
novaway upgrade              # 升级到最新版
novaway upgrade 0.1.5        # 升级到指定版本
```

它会自动识别你的安装方式（npm / pnpm / bun / yarn / brew / scoop / choco），底层执行等价的 `npm install -g xymt-novaway@<版本>`，并且**沿用你的 npm registry 配置** —— 设过淘宝镜像的话升级也走镜像。识别不准时用 `-m` 指定：`novaway upgrade -m npm`。

直接重装同样有效：

```bash
npm install -g xymt-novaway@latest --registry=https://registry.npmmirror.com
```

## 卸载

内置命令会一并清理配置、数据、缓存，并调用你的包管理器卸载程序本体：

```bash
novaway uninstall              # 列出将删除的内容并确认
novaway uninstall --dry-run    # 只预览，不实际删除
novaway uninstall -f           # 跳过确认
novaway uninstall -c -d        # 保留配置(-c)与会话数据(-d)，只卸载程序
```

只想卸载程序、不动任何数据，用包管理器原生命令即可：

```bash
npm uninstall -g xymt-novaway
# 或 pnpm uninstall -g xymt-novaway / yarn global remove xymt-novaway / bun remove -g xymt-novaway
```

用户数据目录（`novaway uninstall` 会清理，手动卸载不会动）：

| 用途 | Linux / macOS | Windows |
| --- | --- | --- |
| 配置 | `~/.config/novaway` | `C:\Users\<你>\.config\novaway` |
| 数据（会话 / 日志 / 快照） | `~/.local/share/novaway` | `C:\Users\<你>\.local\share\novaway` |
| 缓存 | `~/.cache/novaway` | `C:\Users\<你>\.cache\novaway` |
| 状态 | `~/.local/state/novaway` | `C:\Users\<你>\.local\state\novaway` |

## 安装故障排查

**`failed to install the right novaway CLI package` / `Try manually installing xymt-novaway-<os>-<arch>`**

180 MB 的平台二进制包没下完就超时了，npm 把它当 optional 静默跳过，postinstall 随即失败并回滚。换淘宝镜像重装即可（见上文「国内加速」）。也可以先把大包单独灌进 npm 缓存再装：

```bash
npm cache add xymt-novaway-windows-x64@latest --registry=https://registry.npmmirror.com
npm install -g xymt-novaway --registry=https://registry.npmmirror.com
```

**`postinstall script was not run`**

用了 `--ignore-scripts`，或用了默认不跑 postinstall 的包管理器。到全局安装目录手动补跑：`cd <全局 node_modules>/xymt-novaway && node postinstall.mjs`。

**安装卡住不动**

先看是不是在下那个 180 MB 的包（`--foreground-scripts` 能看到进度）。确认是官方源太慢就直接中断，换镜像重来；重装前先 `npm uninstall -g xymt-novaway` 清掉残留的半成品安装。

## 从源码构建

需要 [Bun](https://bun.sh)。

```bash
bun install
cd packages/novaway
bun run build --single   # 只构建当前平台（快速冒烟）
bun run build            # 交叉编译全部四个平台
```

产物位于 `packages/novaway/dist/<平台包>/bin/novaway`。

## 发布（维护者）

采用 **npm 原生二进制分发**：主包 `xymt-novaway` 通过 `optionalDependencies` 挂载各平台二进制包 `xymt-novaway-<os>-<arch>`，npm 按 `os` / `cpu` 只装匹配的那个，安装全程走 npm，无需 GitHub 下载。

在 GitHub Actions 手动触发 `publish-npm` 工作流，填写版本号即可一次发布 5 个包（主包 + 4 个平台包，稳在 npm 每小时新建 10 个包名的限流之内）。

包命名由工作流输入 `main_package`（对应环境变量 `NOVAWAY_MAIN_PACKAGE`）控制，默认 `xymt-novaway`。若要**备份发布到另一个 npm 账号**：先把仓库 Secret `NPM_TOKEN` 换成该账号的令牌，再把 `main_package` 填为 `novaway`，即可发布 `novaway` + `novaway-<os>-<arch>` 一套。二进制会内嵌自己的主包名，`novaway upgrade` 会自动升级对应的包。

## 致谢

- 基于 [opencode](https://github.com/anomalyco/opencode)（MIT License）二次开发。
- 感谢所有上游贡献者。

## License

[MIT](./LICENSE)
