# PowersNexus for OpenCode

PowersNexus 与 [OpenCode.ai](https://opencode.ai) 的完整集成指南。

## 安装

在 `opencode.json`（全局或项目级别）的 `plugin` 数组中添加 PowersNexus：

```json
{
  "plugin": ["PowersNexus@git+https://gitee.com/nova-way/powersnexus.git"]
}
```

重启 OpenCode。插件会通过 OpenCode 的插件管理器安装，并自动注册所有技能。

**验证安装**：问 agent "告诉我你的 powersnexus 是什么"

OpenCode 使用独立的插件安装机制。如果你同时使用 Claude Code、Codex 或其他平台，需要分别安装 PowersNexus。

## 内置 ripgrep（无需额外安装）

PowersNexus 插件已内置 ripgrep（`rg.exe`），**无需单独安装或从 GitHub 下载**。

这个改进专门解决了国内用户常见的网络问题：
- OpenCode 的 `skill` 工具依赖 ripgrep 搜索技能文件
- 首次使用时会尝试从 GitHub Releases 下载 ripgrep
- 国内网络访问 GitHub 经常超时或失败
- 现在插件启动时会自动将内置的 `rg.exe` 添加到 PATH 环境变量

**无需任何额外操作**，插件会自动处理。

### 从旧的 symlink 安装方式迁移

如果你之前使用 `git clone` 和 symlink 方式安装，请先清理旧配置：

```bash
# 删除旧的 symlink
rm -f ~/.config/opencode/plugins/PowersNexus.js
rm -rf ~/.config/opencode/skills/PowersNexus

# 可选：删除克隆的仓库
rm -rf ~/.config/opencode/PowersNexus

# 如果在 opencode.json 中添加了 skills.paths，请删除
```

然后按照上面的安装步骤操作。

## 使用方式

### 查找技能

使用 OpenCode 原生的 `skill` 工具列出所有可用技能：

```
使用 skill 工具列出所有技能
```

### 加载技能

```
使用 skill 工具加载 brainstorming
```

### 自动触发技能

直接描述需求，让 agent 自动判断并调用技能：

```
让我们用 react 做一个 todo list
```

如果 PowersNexus 正常工作，`brainstorming` 技能会自动触发。

### 个人技能

在 `~/.config/opencode/skills/` 中创建自己的技能：

```bash
mkdir -p ~/.config/opencode/skills/my-skill
```

创建 `~/.config/opencode/skills/my-skill/SKILL.md`：

```markdown
---
name: my-skill
description: Use when [condition] - [what it does]
---

# My Skill

[Your skill content here]
```

### 项目技能

在项目的 `.opencode/skills/` 目录中创建项目特定技能。

**技能优先级**：项目技能 > 个人技能 > PowersNexus 技能

## 更新

OpenCode 通过 git-backed 包规范安装 PowersNexus。某些 OpenCode 和 Bun 版本会将解析的 git 依赖固定在 lockfile 或缓存中，重启可能不会获取最新的提交。如果更新未生效，请清除 OpenCode 的包缓存或重新安装插件。

固定特定版本：

```json
{
  "plugin": ["PowersNexus@git+https://gitee.com/nova-way/powersnexus.git#v6.0.3"]
}
```

## 工作原理

插件做了三件事：

1. **注入 bootstrap 上下文**：通过 `experimental.chat.messages.transform` hook，将 PowersNexus 意识注入每个对话的第一条用户消息
2. **注册技能目录**：通过 `config` hook，让 OpenCode 自动发现所有 PowersNexus 技能，无需 symlink 或手动配置
3. **设置 ripgrep PATH**：插件启动时自动将内置的 `rg.exe` 添加到 PATH 环境变量

### 工具映射

技能使用动作描述而非特定平台的工具名。在 OpenCode 中对应：

| 技能动作 | OpenCode 工具 |
|---------|--------------|
| 创建/更新 todo | `todowrite` |
| 分发子代理 | `task`（`subagent_type: "general"`） |
| 调用技能 | `skill`（OpenCode 原生） |
| 读取文件 | `read` |
| 编辑文件 | `apply_patch` |
| 运行命令 | `bash` |
| 搜索内容 | `grep` / `glob` |
| 抓取 URL | `webfetch` |

## 故障排查

### 插件未加载

1. 检查 OpenCode 日志：`opencode run --print-logs "hello" 2>&1 | grep -i PowersNexus`
2. 验证 `opencode.json` 中的 plugin 配置是否正确
3. 确保运行的是较新版本的 OpenCode

### Windows 安装问题

某些 Windows OpenCode 版本存在上游安装器问题，包括 `git+https` URL 的缓存路径和 Bun 无法找到 `git.exe`。如果 OpenCode 无法安装插件，请使用系统 npm 安装并指向本地包：

```powershell
npm install PowersNexus@git+https://gitee.com/nova-way/powersnexus.git --prefix "$HOME\.config\opencode"
```

然后在 `opencode.json` 中使用安装的包路径：

```json
{
  "plugin": ["~/.config/opencode/node_modules/PowersNexus"]
}
```

### 技能未发现

1. 使用 `skill` 工具列出已发现的技能
2. 检查插件是否加载（见上方）
3. 每个技能需要有包含有效 YAML frontmatter 的 `SKILL.md` 文件

### Bootstrap 未出现

1. 检查 OpenCode 版本是否支持 `experimental.chat.messages.transform` hook
2. 重启 OpenCode 使配置生效

### ripgrep 仍然报错

如果内置的 ripgrep 仍然无法工作：

1. 手动安装 ripgrep：`winget install BurntSushi.ripgrep.MSVC` 或 `scoop install ripgrep`
2. 验证安装：`rg --version`
3. 重启 OpenCode

## 获取帮助

- 问题反馈：https://gitee.com/nova-way/powersnexus/issues
- 完整文档：https://gitee.com/nova-way/powersnexus
- OpenCode 文档：https://opencode.ai/docs/