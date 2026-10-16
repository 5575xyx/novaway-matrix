# Agent 聊天区 UI 竞品调研（Qoder / Cursor / Trae）

> 2026-10-16。目的：为「聊天区的 AI 执行呈现」定标准。ZCode 仍是主参照，
> Qoder / Cursor 用来验证"我们的方向是不是行业共识"。

## 调研方式与可信度

| 来源 | 方式 | 可信度 |
| --- | --- | --- |
| Qoder | `docs.qoder.com/llms.txt` + 具体页面 `.md` | 高（官方文档全文） |
| Cursor | `cursor.com/llms.txt` + 具体页面 `.md` | 高（官方文档全文） |
| Trae | `trae.ai` / `docs.trae.ai` 抓取 | **低** —— 站点是纯客户端渲染，抓到的只有路由清单，没有内容。**未采信** |

## 一、工具调用怎么呈现

**Qoder**（`user-guide/chat/tools.md`）把工具分成五类，每类都有明确的可视化：

| 类别 | 工具 |
| --- | --- |
| 搜索 | 代码库 / 文件 / 代码片段 / 目录 / 网页 / 网页内容 |
| 编辑 | 修改文件、查看文件 |
| 执行命令 | 运行命令、取终端输出 |
| 查找问题 | 项目内代码问题（Problems 窗口） |
| 更新记忆 | 持久记忆 |

Diff 呈现规则（原文）：**新增绿、删除红、未改动的上下文用中性色保留**，
并且"每一步改动都要能 accept / edit / reject"。

**Cursor** 走的是另一条路 —— 不做逐工具的详细渲染，而是把「看改动」这件事
整个挪出聊天流（`agent/agents-window.md` 的 *new diffs view*、
`agent/agent-review.md` 的 Agent Review）。

**共同点**：聊天流里**不展开完整 diff**。流里只放"摘要 + 状态"，
真正的 diff 在专门的 review 面里看。

## 二、改动文件怎么呈现

Qoder 的 Review tab（`qoder/review-and-commit.md`）结构：

```
[change source 选择器]  ← Last turn / Uncommitted / Unstaged / Staged / Committed / Branch
[选中范围的 +N −M 总数]
[跳转文件] [折叠] [显示文件列表]
— 每个文件一张 diff 卡片，各自带操作（Stage / Revert）
[Commit or push]
```

**注意 `Last turn` 是第一个选项**：默认语义是"这一轮改了什么"，而不是"整个仓库改了什么"。

## 三、运行中的输入怎么处理

Qoder（`qoder/conversation-input.md`）在运行中区分两种输入：

| 方式 | 用途 | 行为 |
| --- | --- | --- |
| **Queue** | 排一个后续请求 | 留在待发队列里 |
| **Steer** | 修正方向 / 加约束 | **在安全边界投递，不直接中断当前运行** |

队列消息显示在输入框上方，可 Steer / 撤回编辑 / 删除 / 调整顺序。
`⌘+Enter` 触发 steer，默认行为在 Settings 里配。

## 四、子代理 / 并行

- **Qoder**：Extensions 提供专业 Agent（reviewer、test investigator），主 Agent 负责协调与汇总；结果是"先 review 再应用"。
- **Cursor**：Subagents + **cloud subagents**（`/in-cloud`）、worktrees 隔离 —— 每个任务独立文件与分支。

**共同点**：子代理是"派出去干活 + 回报"，**不是**把用户从主线拽走。

## 结论：哪些已经和行业一致，哪些还差

| 项 | 状态 |
| --- | --- |
| 工具行紧凑摘要（图标 + 动作词 + 目标） | ✅ 已对齐 |
| 动作词随状态换时态（编辑中 / 已编辑） | ✅ 已对齐 |
| 状态指示物与状态词分离（● 执行中） | ✅ 已对齐 |
| 失败不铺原始 JSON，挂状态词 + 可复制详情 | ✅ 已对齐 |
| 改动文件在摘要行列成 chips（含文件图标 + `+N`） | ✅ 已对齐 |
| 每个会话只播一次落位动画、跑完自动收起 | ✅ 已对齐（ZCode 口径） |
| 「看改动」有专门面板（change source + 总增删 + 每文件操作） | ✅ 已对齐 |
| 子代理在**侧栏面板**打开，不整页跳走 | ✅ 已对齐 |
| 侧边对话（并行小会话，不写主线历史） | ✅ 已对齐 |
| **一轮里的多个工具调用收进一张卡片** | ❌ **本轮要补** |
