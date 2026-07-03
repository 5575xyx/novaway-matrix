# PowersNexus

PowersNexus 是一套完整的编码代理（coding agent）软件开发方法论，基于一组可组合的技能（skills）和初始指令构建而成，确保你的代理能够正确地使用它们。

## 核心特性

- **零命令依赖**：所有功能（包含 OpenSpec 规范驱动开发）已集成到技能中，无需额外执行任何 CLI 命令
- **多平台支持**：兼容 Claude Code、Cursor、OpenCode、Kimi Code、Copilot CLI 等主流编码代理
- **统一文档管理**：所有工作流文档统一存储在 `.powersnexus/` 目录下
- **增量规格（Delta Specs）**：支持 ADDED/MODIFIED/REMOVED 三种变更类型，适合增量开发和 brownfield 项目
- **自动归档**：开发完成后自动合并 Delta Specs 到主规格，并归档变更记录

## 快速开始

为你的编码代理安装 PowersNexus：[Claude Code](#claude-code) · [Antigravity](#antigravity) · [Codex App](#codex-app) · [Codex CLI](#codex-cli) · [Cursor](#cursor) · [Factory Droid](#factory-droid) · [Gemini CLI](#gemini-cli) · [GitHub Copilot CLI](#github-copilot-cli) · [Kimi Code](#kimi-code) · [OpenCode](#opencode) · [Pi](#pi)

## 工作原理

当你启动编码代理时，PowersNexus 会在第一时间介入。一旦它发现你正在构建某些东西，并不会立即着手写代码，而是会后退一步，先弄清楚你真正想要实现的目标。

在对话中梳理出规格后，它会分小段呈现给你审阅，每段都足够简短、易于消化。

设计获得批准后，代理会制定一份实施计划，清晰到一位热情但缺乏品味、缺乏判断力、不了解项目背景且不情愿测试的初级工程师都能照着执行。计划强调严格的 red/green TDD、YAGNI（你不会需要它）和 DRY 原则。

接下来，一旦你说"开始"，它会启动**subagent-driven-development** 流程，让代理逐项处理每个工程任务、检查并审查它们的工作，然后继续推进。代理通常能够连续自主工作数小时而不偏离你制定好的计划。

还有很多细节，但这就是整个系统的核心。由于技能会自动触发，你无需任何额外操作 —— 你的编码代理已经具备了 PowersNexus 能力。

## 目录结构

所有工作流产生的文档统一存储在项目根目录的 `.powersnexus/` 目录下：

```
.powersnexus/
├── specs/                        # 主规格（单一事实来源，完整规格文档）
│   └── <domain>/
│       └── spec.md
└── changes/
    ├── <change-name>/            # 活动变更
    │   ├── proposal.md           # 提议文档
    │   ├── design.md             # 设计文档
    │   ├── tasks.md              # 任务清单
    │   ├── progress.md           # 进度记录
    │   └── delta-specs/          # 增量规格（相对于主规格的变更）
    │       └── <domain>/
    │           └── spec.md
    └── archive/                  # 已完成变更归档
        └── YYYY-MM-DD-<name>/
```

## 安装方式

不同编码代理的安装方式各不相同。如果你使用多个代理，请分别为每个代理安装 PowersNexus。

### Claude Code

PowersNexus 已上架 [Claude 官方插件市场](https://claude.com/plugins/PowersNexus)。

**官方市场安装：**

```bash
/plugin install PowersNexus@claude-plugins-official
```

### Cursor

- 在 Cursor Agent 聊天中通过市场安装：

```text
/add-plugin PowersNexus
```

- 或者在插件市场中搜索 "PowersNexus"。

### OpenCode

OpenCode 使用自己的插件安装机制；即使你已经在其他代理中使用过，也需要单独安装。

- 告诉 OpenCode：

```
抓取并按照 https://raw.githubusercontent.com/obra/PowersNexus/refs/heads/main/.opencode/INSTALL.md 中的说明操作
```

### Kimi Code

PowersNexus 已上架 Kimi Code 的插件市场。

- 打开 Kimi Code 的插件管理器：

```text
/plugins
```

- 进入 `Marketplace` > `PowersNexus` 并安装它。

- 或者直接从此仓库安装：

```text
/plugins install https://github.com/obra/PowersNexus
```

- 详细文档：[docs/README.kimi.md](docs/README.kimi.md)

### GitHub Copilot CLI

```bash
copilot plugin marketplace add obra/PowersNexus-marketplace
copilot plugin install PowersNexus@PowersNexus-marketplace
```

### Gemini CLI

```bash
gemini extensions install https://github.com/obra/PowersNexus
gemini extensions update PowersNexus
```

### Factory Droid

```bash
droid plugin marketplace add https://github.com/obra/PowersNexus
droid plugin install PowersNexus@PowersNexus
```

### Antigravity

```bash
agy plugin install https://github.com/obra/PowersNexus
```

### Codex App

- 在 Codex 应用中，点击侧边栏的 Plugins。
- 你将在 Coding 部分看到 `PowersNexus`。
- 点击 PowersNexus 旁边的 `+`，按提示操作。

### Codex CLI

```bash
/plugins
PowersNexus
```

然后选择 `Install Plugin`。

### Pi

从此仓库作为 Pi 包安装：

```bash
pi install git:github.com/obra/PowersNexus
```

本地开发时，可将当前仓库作为临时包加载运行 Pi：

```bash
pi -e /path/to/PowersNexus
```

## 基本工作流程

1. **brainstorming**（头脑风暴） — 在写代码前自动激活。通过提问打磨初步想法、探索替代方案、分段呈现设计以供确认。生成设计文档。
2. **openspec**（OpenSpec 集成） — 设计批准后激活。生成提议（proposal）、增量规格（delta specs）、设计（design）和任务（tasks）文档，统一存储到 `.powersnexus/changes/<name>/` 目录。
3. **using-git-worktrees**（使用 Git Worktree） — 设计批准后激活。在新分支上创建隔离工作区，运行项目设置，验证测试基线干净。
4. **writing-plans**（制定计划） — 设计获批后激活。将工作拆分为 2-5 分钟的可执行任务。每个任务都包含精确的文件路径、完整代码、验证步骤。
5. **subagent-driven-development**（子代理驱动开发）或 **executing-plans**（执行计划） — 计划就绪后激活。为每个任务调度全新的子代理，并进行两阶段审查（规格合规性 + 代码质量），或者分批执行并设置人工检查点。
6. **test-driven-development**（测试驱动开发） — 实施过程中激活。强制执行 RED-GREEN-REFACTOR：先写失败测试 → 看着它失败 → 写最小代码 → 看着它通过 → 提交。删除先于测试写出的代码。
7. **requesting-code-review**（请求代码审查） — 任务间激活。对照计划审查，按严重程度报告问题。关键问题会阻塞进度。
8. **finishing-a-development-branch**（完成开发分支） — 任务完成后激活。验证测试、呈现选项（合并/PR/保留/丢弃）、清理 worktree。归档 OpenSpec 变更并将 Delta Specs 合并到主规格。

**代理会在任何任务之前检查相关技能。** 这是强制性的工作流，而非建议。

## 技能库

### 规划与设计

- **brainstorming** — 苏格拉底式设计精炼
- **openspec** — 管理产物生成、增量规格与变更生命周期，统一管理 `.powersnexus/` 下的所有文档
- **writing-plans** — 详细的实施计划

### 开发

- **subagent-driven-development** — 通过两阶段审查（规格合规性、代码质量）快速迭代
- **executing-plans** — 带检查点的批量执行
- **dispatching-parallel-agents** — 并发子代理工作流
- **test-driven-development** — RED-GREEN-REFACTOR 循环（包含反模式参考）
- **using-git-worktrees** — 并行开发分支

### 质量与审查

- **requesting-code-review** — 审查前检查清单
- **receiving-code-review** — 响应反馈
- **systematic-debugging** — 4 阶段根因分析流程
- **verification-before-completion** — 确认问题真正解决
- **finishing-a-development-branch** — 合并/PR 决策工作流

### 元技能

- **writing-skills** — 遵循最佳实践创建新技能（包含测试方法论）
- **using-powersnexus** — 技能系统入门

## 设计哲学

- **测试驱动开发** — 始终先写测试
- **系统化优于临时应对** — 流程优于猜测
- **降低复杂度** — 以简洁为首要目标
- **证据优于断言** — 在宣告成功前先验证

## 贡献

PowersNexus 的一般贡献流程如下。请注意，我们通常不接受新技能的贡献，且任何技能更新都必须在所有支持的编码代理上正常工作。

1. Fork 仓库
2. 切换到 `dev` 分支
3. 为你的工作创建一个分支
4. 遵循 `writing-skills` 技能创建和测试新技能或修改现有技能
5. 提交 PR，确保填写了 Pull Request 模板

技能行为测试使用 [PowersNexus-evals](https://github.com/prime-radiant-inc/PowersNexus-evals/) 中的 drill eval harness，需克隆到 `evals/` 目录 —— 设置说明见 `evals/README.md`。插件基础设施测试位于 `tests/`，通过相关 `run-*.sh` 或 `npm test` 运行。

完整指南请参阅 `skills/writing-skills/SKILL.md`。

## 更新

PowersNexus 的更新在某种程度上依赖编码代理，但通常是自动的。

## 许可证

MIT 许可证 —— 详见 LICENSE 文件。

## 社区

PowersNexus 由 [Jesse Vincent](https://blog.fsck.com) 及 [Prime Radiant](https://primeradiant.com) 团队构建。

- **Discord**：[加入我们](https://discord.gg/35wsABTejz) 获取社区支持、提问与分享你正在使用 PowersNexus 构建的项目
- **Issues**：https://github.com/obra/PowersNexus/issues
- **发布公告**：[订阅](https://primeradiant.com/PowersNexus/) 以获取新版本通知