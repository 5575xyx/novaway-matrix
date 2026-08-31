<p align="center">
  <img src="packages/desktop/icons/novaway-icon.svg" alt="NovaWay Matrix" width="120">
</p>

<h1 align="center">NovaWay Matrix</h1>

<p align="center"><b>一句话，让 AI 替你写代码、做 PPT、发小红书。</b></p>

<p align="center">终端里的 AI 编程与办公自动化 Agent —— 为国产大模型与中文场景而生。</p>

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

## 一条命令，两个世界

```bash
npm install -g xymt-novaway
novaway
```

回车之后，你得到的不只是"一个能聊天的终端"：

- **写代码**：它读你的项目、改你的文件、跑你的测试，从需求到提交一条龙。
- **做办公**：一句话生成 PPT、写周报、分析表格、出运营文案。
- **管项目**：Git 暂存提交、分支管理、数据库查询，全在同一个界面里。
- **懂中文**：DeepSeek、通义千问、智谱 GLM、Kimi 开箱即用，界面全中文。

同一套内核，还有 **Electron 桌面端** 和 **悬浮桌宠** 两种形态（见下文）。

> 支持 **Windows x64** / **macOS**（Apple Silicon 与 Intel）/ **Linux x64**，需要 Node.js ≥ 18。npm 会自动只装匹配你平台的二进制，无需手动选择。

### 国内加速（强烈建议）

平台二进制随 npm 分发，单个平台包约 **180 MB**。官方源在国内实测只有几十 KB/s，很容易超时；而平台包挂在 `optionalDependencies` 下，**下载失败时 npm 会静默跳过它**，紧接着报 `Try manually installing xymt-novaway-<os>-<arch>` 并回滚整个安装 —— 看着像包坏了，其实只是网慢。所以国内请走淘宝镜像：

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

装完 `novaway --version` 确认版本号，然后 `novaway` 进入终端。

## 终端 TUI：一整个工作台，不止是聊天框

运行 `novaway`，你会看到一块自适应宽度的侧边面板 —— **五个标签页**，把开发的整条流水线装进了终端：

**文件** —— 项目树就在手边，点开即看、看完即改：带行号的编辑器、自动保存，改完文件顺手就让 Agent 接着干。

**信息** —— 这轮对话花了多少 token、多少预算、缓存命中率多少，一目了然；MCP 和 LSP 的连接状态实时可见；消息列表里点一条，聊天区立刻跳回那一刻。

**Git** —— 传说中的"终端里也能爽快用 Git"：

- 改了什么、暂存了什么，两组清清楚楚；逐文件暂存、一键全部暂存并提交。
- 提交说明直接写在面板里，回车即提交；手滑了？撤销上次提交，改动原样退回。
- 推送、拉取、切换分支、新建分支、贮藏现场，点一下的事。
- 维护多个远程仓库？把 GitHub 和 Gitee 都挂上，点谁推谁。
- 每一笔提交点开就是作者、时间和改动清单；点变更文件名，语法高亮的逐行差异立刻展开。

**数据** —— 内置可视化数据库客户端：弹窗填几个框就连上了 MySQL / PostgreSQL / SQLite / Redis 等八种数据库，树形浏览到每一列的类型和注释，点开一张表直接看前 100 行，SQL 写完回车出结果。你和 AI 用的是同一套连接。

**智能中枢** —— Agent 的"自我管理"面板：持久记忆、自我进化、检查点、目标、工作流、多 Agent 编排，自动刷新、分区折叠，像仪表盘一样看着它自己组织工作。

聊天区支持**多标签**（聊天 / 文件 / 改动差异并排切换）；`ctrl+p` 呼出命令面板，`ctrl+alt+k` 看全部快捷键，`f2` 在最近用过的模型间秒切。

## 桌面端（Desktop）

不喜欢终端？NovaWay 还有一套 **Electron 桌面应用**（并非简单套壳），以 Sidecar 方式驱动同一个 `novaway` 内核，中文界面、16 种语言、自动更新：

**① 工作台窗口** —— 完整的主窗口，承载 AI 编程与办公对话；支持自定义服务地址、深链唤起、Windows 下的 WSL 配置。

**② 悬浮桌宠** —— 常驻桌面的 AI 精灵，可跟随光标、随时唤起：

- **两种形态**：完整 / 极简一键切换。
- **展开即见**：任务监控（Agent 正在干什么、进展到哪）+ 通知中心。
- **能换肤**：内置多款桌宠皮肤，还支持自定义颜色。

### 多平台账号与一键发布

桌面端内置国内主流内容平台的**登录态管理与自动化发布**，与内置技能打通，形成「生成内容 → 发布运营」的完整闭环：

> 小红书、抖音、快手（含签名）、B 站、微信公众号、微信视频号、闲鱼

- **扫码/网页登录**并自动捕获、校验会话，登录态失效自动检测，支持批量检查。
- **账号分组管理**：新增 / 编辑 / 删除分组，账号跨组移动。
- **一键发布**内容到任意已登录账号 —— 写完文案，发布只差一次点击。

## 为什么选 NovaWay

- **国产大模型开箱即用** —— DeepSeek、通义千问（Qwen）、智谱 GLM、Kimi、MiniMax、小米 MiMo 各有专属系统提示词，选厂商、填 Key、就能干活；Claude、GPT、Gemini 同样兼容。
- **全中文，处处中文** —— 终端、桌面端、命令面板、报错提示，全部中文化，配 NovaWay 品牌图标。
- **一句话的办公技能** —— PPT（office-ppt）、小红书运营、公众号运营，外加文档 / 数据 / 会议 / 设计 / 网页全套 Office 技能，说人话就能驱动。
- **多 Agent 编排** —— Orchestrator 会把大任务拆成带依赖关系的计划，按拓扑顺序并发派子 Agent 干活、再把结果串起来；pulse-orchestrator 运营总控主动调度它完成多步运营任务。
- **会话智能** —— 目标、检查点、蒸馏：Agent 记得住、回得去、还能自我复盘。
- **Git 集成** —— 暂存、提交、分支、贮藏、远程同步、差异查看，终端里全套齐活。
- **数据库管理** —— 多连接、树形浏览、SQL 查询，终端 / 桌面端 / Web 三端可用。
- **MCP 生态** —— context7（实时文档）、sequential-thinking、memory、browser、desktop-commander 开箱预置。

## 内置 Agent：一个团队，各司其职

按 `Tab` 切换主 Agent，就像在给团队派单：

### 开发

- **build** —— 默认主力：读写文件、跑命令、跑测试，端到端交付，从实现到验证不撒手。
- **plan** —— 只读军师：先探索、先出方案，动手前先问你，杜绝误改。

### 办公模式（Office）

一组各有所长的"同事"，把日常办公拆成专业岗位：

- **文档整理** —— 周报月报、方案报告，零散素材进去、规范文档出来。
- **PPT 生成** —— 从主题到页级故事线，配合 PPT 技能直出 `.pptx`。
- **表格分析** —— CSV / Excel 清洗透视、趋势归因，原始表格变成带结论的报告。
- **视觉设计** —— 海报、封面、配图与品牌色板，风格统一。
- **网页看板** —— 不写前端也能得到能用的 HTML 看板与演示站点。
- **AI 会议** —— 纪要、决议、行动项、负责人，一场会议变成可执行清单。
- **AI 资料库** —— 摘要、对比、知识索引与 FAQ，项目知识越攒越厚。
- **AI 任务** —— 目标拆解、优先级、周计划与风险看板，模糊目标变节奏。
- **AI 沟通** —— 邮件、通知、商务表达，语气分寸拿捏到位。

### 运营

- **运营主 Agent**（pulse-orchestrator）—— 内容运营总控：读懂你的意图，自动编排子 Agent 分步完成整个运营任务。

另有 **general** / **explore** / **scout** 等内置子 Agent，供主 Agent 内部调用或用 `@` 唤起，专攻复杂搜索、代码库探索与外部资料研究。

## 快速开始

1. `novaway`
2. 选模型、填 Key（国产模型直接选厂商）。
3. 开聊：让它读代码、修 bug、写 PPT、排运营计划 —— 剩下的交给它。

## 更新

```bash
novaway upgrade              # 升级到最新版
novaway upgrade 0.1.5        # 升级到指定版本
```

自动识别安装方式（npm / pnpm / bun / yarn / brew / scoop / choco），**沿用你的 npm registry 配置** —— 设过镜像的话升级也走镜像。识别不准时用 `-m` 指定：`novaway upgrade -m npm`。

直接重装同样有效：

```bash
npm install -g xymt-novaway@latest --registry=https://registry.npmmirror.com
```

## 卸载

```bash
novaway uninstall              # 列出将删除的内容并确认
novaway uninstall --dry-run    # 只预览，不实际删除
novaway uninstall -f           # 跳过确认
novaway uninstall -c -d        # 保留配置(-c)与会话数据(-d)，只卸载程序
```

只想卸载程序、不动数据，用包管理器原生命令即可：

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

180 MB 的平台包没下完就超时，npm 把它当 optional 静默跳过，postinstall 随即失败并回滚。换淘宝镜像重装即可（见上文「国内加速」）。也可以先把大包单独灌进 npm 缓存再装：

```bash
npm cache add xymt-novaway-windows-x64@latest --registry=https://registry.npmmirror.com
npm install -g xymt-novaway --registry=https://registry.npmmirror.com
```

**`postinstall script was not run`**

用了 `--ignore-scripts`，或用了默认不跑 postinstall 的包管理器。到全局安装目录手动补跑：`cd <全局 node_modules>/xymt-novaway && node postinstall.mjs`。

**安装卡住不动**

先看是不是在下那个 180 MB 的包（`--foreground-scripts` 能看到进度）。确认是官方源太慢就直接中断，换镜像重来；重装前先 `npm uninstall -g xymt-novaway` 清掉残留。

## 从源码构建

需要 [Bun](https://bun.sh)。

```bash
bun install
cd packages/novaway
bun run build --single   # 只构建当前平台（快速冒烟）
bun run build            # 交叉编译全部平台
```

产物位于 `packages/novaway/dist/<平台包>/bin/novaway`。

## License

[MIT](./LICENSE)
