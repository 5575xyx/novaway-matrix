# 记忆召回与本地向量使用指南

NovaWay 的记忆召回默认开箱即用：即使没有 API Key、没有 Ollama、没有任何嵌入模型，也会使用本地关键词、SQLite FTS 与 n-gram 语义完成基础召回。

当检测到云端嵌入能力或本机 Ollama 嵌入模型时，`auto` 模式会自动升级为稠密向量召回。

## 1. 零配置使用

1. 打开 **设置 → 记忆与进化 → 智能召回**。
2. 保持 **自动（推荐）**。
3. 在对话中明确说“请记住……”“我的偏好是……”“从现在起……”。
4. 新建会话后提出相关问题，验证记忆是否被召回。

零配置路径包含：

- 关键词和范围过滤；
- SQLite FTS 全文检索；
- 本地 n-gram 语义相似度；
- 重要性、置信度、时效性和全局/项目范围加权。

## 2. 召回模式

| 模式       | 行为                                                    | 适用场景              |
| ---------- | ------------------------------------------------------- | --------------------- |
| `auto`     | 优先使用已有云端 Key，其次检测 Ollama，最后回退本地语义 | 推荐默认值            |
| `local`    | 只使用本地关键词、FTS 与 n-gram 语义                    | 完全离线、内网环境    |
| `provider` | 强制使用云端 embedding；不可用时回退本地语义            | 已配置 OpenAI API Key |
| `ollama`   | 强制使用本机 Ollama embedding；不可用时回退本地语义     | 本地高质量向量召回    |
| `off`      | 关闭语义增强，仅使用关键词与 FTS                        | 排查语义召回问题      |

任何稠密向量后端失败都不会阻断记忆读写，系统会自动回退到本地语义。

## 3. 一键启用 Ollama 本地向量

在 **智能召回** 区域点击 **一键启用本地向量**，系统会按顺序执行：

1. 检测 Ollama CLI；
2. 未安装时，在用户主动点击后尝试安装：
   - Windows：`winget install -e --id Ollama.Ollama`
   - macOS：`brew install ollama`
   - Linux：`curl -fsSL https://ollama.com/install.sh | sh`
3. Ollama 已安装但服务未运行时，尝试启动 `ollama serve`；
4. 未找到嵌入模型时，执行 `ollama pull nomic-embed-text`；
5. 成功后将召回模式切换到 `ollama`，并保存本地地址与模型名。

### 重要边界

- NovaWay 不会在启动时静默安装 Ollama；只有用户点击按钮后才会执行安装和拉取。
- 自动安装可能需要系统权限和网络。失败时界面会显示手动命令和下载地址。
- 安装、启动或拉取失败不影响基础记忆功能。

## 4. 手动启用 Ollama

如果一键流程受权限或网络限制，可手动执行：

```bash
ollama serve
ollama pull nomic-embed-text
```

也可以使用其他嵌入模型，例如 `mxbai-embed-large`、`bge-m3` 或 `all-minilm`。完成后刷新设置页状态，选择 **Ollama 本地向量**。

## 5. 云端向量

当前云端路径默认使用 OpenAI 兼容的 embedding：

1. 配置 `OPENAI_API_KEY`；
2. 保持 `embedding_mode: "auto"`，或选择 **云端向量**；
3. 默认模型为 `text-embedding-3-small`。

如果 Key 不可用或请求失败，NovaWay 会回退本地语义，并在当前后端状态中说明原因。

## 6. 配置示例

全局配置文件为 `novaway.json` 或 `novaway.jsonc`。

### 自动模式

```json
{
  "memory": {
    "embedding_mode": "auto"
  }
}
```

### Ollama 模式

```json
{
  "memory": {
    "embedding_mode": "ollama",
    "embedding_ollama_url": "http://localhost:11434",
    "embedding_ollama_model": "nomic-embed-text"
  }
}
```

### 完全离线模式

```json
{
  "memory": {
    "embedding_mode": "local"
  }
}
```

## 7. 状态说明

设置页会显示两类状态：

- **Ollama 准备状态**：未安装、未启动、缺少模型或已就绪；
- **当前后端**：本地语义、云端向量、Ollama 向量或已关闭语义增强。

`auto` 模式不等于必须安装 Ollama。显示“本地语义（无需模型，开箱即用）”时，记忆召回仍然正常工作。

## 8. 常见问题

### 点击模式按钮后提示服务器错误

模式切换会更新全局配置。正常实现不应要求全局路由提供项目实例上下文；可在日志中检查 `Config.updateGlobal` 是否出现 `InstanceRef not provided`。

### 已安装 Ollama，但状态显示服务未运行

打开 Ollama 应用，或执行：

```bash
ollama serve
```

然后点击 **刷新状态**。

### Ollama 已运行，但缺少嵌入模型

执行：

```bash
ollama pull nomic-embed-text
```

### 如何确认实际使用的后端

查看设置页 **当前后端**。例如：

- `本地语义（无需模型，开箱即用）`
- `云端向量（openai/text-embedding-3-small）`
- `本地 Ollama 向量（nomic-embed-text）`
