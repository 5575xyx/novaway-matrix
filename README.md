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

---

NovaWay Matrix 基于开源项目 [opencode](https://github.com/anomalyco/opencode) 构建，是一款 AI 编程与办公自动化 Agent，提供**终端（TUI）**与 **Electron 桌面端**两种形态。在原版能力之上，针对国内用户做了深度改造：内置国产大模型专属提示词、全中文界面与 NovaWay 品牌图标，以及 PPT / 小红书 / 公众号等中文办公技能。命令行入口为 `novaway`。

> 声明：本项目基于 opencode（MIT）二次开发，与 opencode 官方团队无任何关联。

## 安装

```bash
npm i -g xymt-novaway
```

装完直接运行：

```bash
novaway
```

> **国内提速**：平台二进制直接随 npm 分发（不再从 GitHub 下载 100MB 文件）。把 registry 指向淘宝镜像即可高速安装：
>
> ```bash
> npm config set registry https://registry.npmmirror.com
> npm i -g xymt-novaway
> ```
>
> 同样支持 `pnpm` / `yarn` / `bun` 全局安装。

支持平台：**Windows x64**、**macOS**（Apple Silicon 与 Intel）、**Linux x64**。npm 会按你的系统自动只装匹配平台的二进制包，无需手动选择。

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
- **多 Agent 编排** —— Orchestrator 协调多个子 Agent 协作，配合 Workflow 编排复杂任务，并支持后台并行开关。
- **会话智能** —— 目标（goal）、检查点（checkpoint）、蒸馏（distill）等会话记忆与自我组织机制。
- **MCP 生态** —— 预置 context7（实时文档）、sequential-thinking、memory、browser、desktop-commander 等 MCP 服务。
- **数据库管理** —— 内置可视化数据库客户端：管理多个连接、树形浏览库/表/字段、直接执行 SQL 并查看结果。

## 内置 Agent

用 `Tab` 键在两个内置 Agent 间切换：

- **build** —— 默认全权限开发 Agent，负责读写代码、执行命令等实际工作。
- **plan** —— 只读分析 Agent，默认禁止改文件、执行命令前询问，适合探索陌生代码库或做方案规划。

另有 **general** 子 Agent 用于复杂搜索与多步任务，可在消息中用 `@general` 调用。

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
novaway upgrade
```

会拉取 `xymt-novaway` 的最新版本（含各平台二进制），全程走 npm。

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
