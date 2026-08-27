# NovaWay 新功能操作手册

面向 5 项 MiMoCode 能力:目标驱动自主循环、组合工作流、子代理编排、检查点、dream/distill 自我蒸馏。

> 三种入口:**① 配置文件开开关**、**② 对话里让 agent 调工具**、**③ TUI 面板 / HTTP API**。
> 默认全部关闭,涉及后台 LLM 调用的功能需显式打开。

---

## 0. 启动

```bash
# 仓库根目录
bun run dev
# 或直接跑 novaway 包
cd packages/novaway && bun run dev
```

配置文件:全局 `~/.config/novaway/novaway.json`(Windows 为 `%USERPROFILE%\.config\novaway\novaway.json`),或项目根目录 `novaway.json` / `novaway.jsonc`。改配置后重启会话生效。

---

## 1. 配置总览(novaway.json)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  "goal": {
    "enabled": false,          // 目标驱动自主循环总开关
    "max_iterations": 8,       // 单目标最大自动追加轮次(硬上限,防跑飞)
    "judge_model": "anthropic/claude-opus-4-8"  // 可选:裁判模型;省略则复用当轮模型
  },

  "checkpoint": {
    "auto_enabled": false,     // 自动检查点总开关
    "auto_interval": 5         // 每 N 个 assistant 回合自动存一次
  },

  "dream": {
    "enabled": false,          // dream/distill 自我蒸馏总开关
    "interval": 8              // 每 N 轮反思一次会话并蒸馏进长期记忆
  }
}
```

---

## 2. 目标驱动自主循环

**作用**:给 agent 设定带成功标准的目标;每轮结束后用裁判模型判断是否达成,未达成自动追加一轮,直到达成或触及 `max_iterations`。

**开启**:`novaway.json` 里 `"goal": { "enabled": true }`。

**建目标**(对话里说即可,agent 会调 `goal` 工具):
- “创建目标:重构 auth 模块;成功标准:所有测试通过、无 any 类型。”
- `goal` 工具 action:`create` / `update` / `list` / `get` / `progress` / `decompose`(把大目标 LLM 拆成子目标)。

**运行时行为**:
- 裁判判定 `goalMet=false` → 用它给出的 `nextAction` 顺序追加一轮(不并发),`iterations++`。
- `goalMet=true` → 把活动目标标记为 `completed` 并停止。
- 触及 `max_iterations` → 强制停止(防跑飞)。

**安全**:默认关闭;有硬性轮次上限;每轮仍受会话权限约束。

---

## 3. 组合工作流

**作用**:按预定义步骤图跑多阶段任务,每步派生子会话真实产出;后台执行,状态靠轮询。

**4 个内置模板**:`compose`(规划→执行→评审→综合)、`deep-research`、`fact-check`、`research-experiment`。

**用法 A — 对话**:
- “用 deep-research 模板建一个关于 X 的工作流并启动。”
- `workflow` 工具 action:`create` / `create_from_template` / `list` / `get` / `start` / `status` / `pause` / `resume` / `templates`。

**用法 B — HTTP**:
```
GET  /session/:sessionId/workflow-templates          # 列模板
POST /session/:sessionId/workflows/from-template     # body: { templateId }
POST /session/:sessionId/workflows/:workflowId/start  # 启动(后台执行)
GET  /session/:sessionId/workflows/:workflowId/runs   # 轮询运行状态
```

**用法 C — TUI**:工作流面板 → “从模板创建” → 选模板 → 启动;面板显示 `currentStep` 推进到 `completed`。

**步骤类型**:`agent` / `tool` / `skill` / `condition`(真值分支)/ `parallel`(并发扇出)。`{{stepId}}` 可在后续步骤 prompt 里插值引用上游输出。

---

## 4. 子代理编排

**作用**:建含依赖的多任务计划,按依赖拓扑排序执行,无冲突的任务并发跑,结果写回。

**用法 — 对话**(agent 调 `orchestrator` 工具):
- “建编排计划:任务A 调研现状;任务B 基于A 出方案(依赖A);任务C 评审B(依赖B);然后执行。”
- action:`create_plan` / `add_task`(可带 `dependencies`)/ `execute` / `status` / `list`。

**用法 — HTTP**:
```
GET    /session/:sessionId/orchestrator/plans
POST   /session/:sessionId/orchestrator/plans/:planId/execute
GET    /session/:sessionId/orchestrator/plans/:planId    # 查状态/结果
DELETE /session/:sessionId/orchestrator/plans/:planId
```

**行为**:某任务失败 → 整个 plan 标 `failed` 但不崩溃,已完成的任务结果保留。`{{taskId}}` 可插值引用上游任务输出。

---

## 5. 检查点

**作用**:保存会话消息 + 文件快照,可回滚。**恢复是破坏性的:原地覆盖当前会话消息并回滚文件到检查点态。**

**自动**:`"checkpoint": { "auto_enabled": true, "auto_interval": 5 }` — 每 5 个 assistant 回合自动存一次。

**手动**:
- 对话:“存一个检查点” / “恢复到检查点 X”。
- HTTP:
  ```
  GET    /session/:sessionId/checkpoints
  POST   /session/:sessionId/checkpoints                       # 建
  POST   /session/:sessionId/checkpoints/:checkpointId/restore  # 恢复(破坏性)
  DELETE /session/:sessionId/checkpoints/:checkpointId
  ```
- TUI:检查点面板,恢复前有“当前会话状态将被覆盖”确认。

---

## 6. dream/distill 自我蒸馏

**作用**:每 `interval` 轮用 LLM 反思整段会话,提炼经验(patterns/insights/suggestions)并蒸馏进长期记忆 `.novaway/memory`。

**开启**:`"dream": { "enabled": true, "interval": 8 }`。开启后随会话钩子自动跑,无需手动触发;会产生额外 LLM 调用。

---

## 7. LLM 用什么模型

- **目标裁判**:优先 `goal.judge_model`(格式 `providerID/modelID`),否则复用当轮 assistant 模型。
- **dream/distill**:用当轮循环的模型,不可单独配置。
- **工作流 / 编排子代理**:默认取会话内最近一条 assistant 消息的模型;没有则回退 provider 默认模型;每个 step/task 可在 config 里覆盖。

除 `goal.judge_model` 外,其余功能不带独立模型配置,均继承当前会话模型。

---

## 8. 验证与排查

- **表未建**:server 启动会自动 apply 迁移(`goal` / `workflow` / `orchestrator` / `checkpoint` 四张新表);若报表不存在,检查 `.novaway` 下 sqlite 与启动迁移日志。
- **目标循环不触发**:确认 `goal.enabled:true`、`max_iterations>0`、存在 `in_progress`/`pending` 的活动目标、且当轮 assistant 消息无 error。
- **工作流卡在 step0**:确认是走 `start`(会后台执行)而非只 `create`;用 `runs`/`status` 轮询。
- **自测**:`cd packages/novaway && bun test test/workflow/executor.test.ts test/orchestrator/service.test.ts test/session/checkpoint.test.ts`(应 9 pass)。

