# 运营主 Agent（pulse-orchestrator）实现计划

> **对于代理工作者：** 必需的子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 来逐任务实现此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 创建一个内置的「运营主 Agent」，自动分析用户意图并协调子 Agent 完成任务

**架构：** 在 agent.ts 中新增一个 `pulse-orchestrator` primary agent，其 prompt 描述如何通过 task 工具调用子 Agent。PulseChatInput 默认选中此 orchestrator。子 Agent 的调度完全依赖 LLM + 现有 task 工具机制，不修改后端核心逻辑。

**技术栈：** TypeScript, Effect (agent.ts), SolidJS (PulseChatInput, PulseAssistant)

---

### 任务 1：新增 pulse-orchestrator agent 定义

**文件：**
- 修改：`packages/opencode/src/agent/agent.ts:450-451`（在 agents 对象末尾，`agencyAgents` 之前）

- [ ] **Step 1：在 agents 对象中添加 pulse-orchestrator**

在 `general` agent 定义之后，`compaction` 之前添加：

```typescript
"pulse-orchestrator": {
  name: "pulse-orchestrator",
  description: "运营主 Agent，分析用户意图并协调子 Agent 完成任务",
  mode: "primary",
  native: true,
  color: "#FF6B6B",
  prompt: `你是运营主 Agent，负责分析用户意图并协调子 Agent 完成任务。

## 核心职责
1. 分析用户消息，判断需要哪些子 Agent 协作
2. 通过 task 工具将任务分配给合适的子 Agent
3. 汇总子 Agent 的执行结果，返回给用户

## 可调度的子 Agent
你拥有对所有系统内置 Agent 的完全调度权限，包括：
- 小红书种草文案生成
- 抖音短视频脚本生成
- 公众号长文生成
- 多平台内容分发
- 代码开发和调试
- 文档写作和编辑
- 其他系统内置 Agent

## 输出格式
在调用子 Agent 前，明确告知用户当前正在使用的子 Agent 名称：
"正在使用 [Agent名称] 处理..."
执行完成后汇总所有结果。

## 注意事项
- 一次只处理一个主要任务
- 复杂任务可以拆分为多个步骤
- 始终用中文回复`,
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      "*": "allow",
    }),
    user,
  ),
  options: {
    category: "运营",
  },
},
```

- [ ] **Step 2：运行类型检查**

```bash
bun typecheck
```
预期：通过（仅 pre-existing error 在 opencode/test 中）

- [ ] **Step 3：提交**

```bash
git add packages/opencode/src/agent/agent.ts
git commit -m "feat: add pulse-orchestrator agent definition"
```

---

### 任务 2：默认选中 pulse-orchestrator

**文件：**
- 修改：`packages/app/src/pages/pulse/PulseChatInput.tsx:58-60`

- [ ] **Step 1：修改默认 agent 选择逻辑**

将 `onMount` 中的默认选择逻辑从选择第一个 agent 改为优先选择 `pulse-orchestrator`：

```typescript
onMount(() => {
  const orchestrator = agentList().find((a) => a.name === "pulse-orchestrator")
  if (orchestrator && !selectedAgent()) {
    setSelectedAgent(orchestrator.name)
  } else if (agentList().length > 0 && !selectedAgent()) {
    setSelectedAgent(agentList()[0].name)
  }
  // ... rest stays the same
})
```

- [ ] **Step 2：运行类型检查**

```bash
cd packages/app && bun typecheck
```
预期：通过

- [ ] **Step 3：提交**

```bash
git add packages/app/src/pages/pulse/PulseChatInput.tsx
git commit -m "feat: default pulse-chat-input to pulse-orchestrator agent"
```

---

### 任务 3：更新 PulseAssistant 建议指令使用 orchestrator

**文件：**
- 修改：`packages/app/src/pages/pulse/PulseAssistant.tsx:97`

- [ ] **Step 1：将 handleSuggestion 改为使用 pulse-orchestrator**

```typescript
const handleSuggestion = (text: string) => {
  if (sessionReady() && sessionID()) {
    handleSend(text, "pulse-orchestrator")
  }
}
```

- [ ] **Step 2：运行类型检查**

```bash
cd packages/app && bun typecheck
```
预期：通过

- [ ] **Step 3：提交**

```bash
git add packages/app/src/pages/pulse/PulseAssistant.tsx
git commit -m "feat: use pulse-orchestrator for pulse assistant suggestions"
```

---

### 验证

- [ ] **验证 1：全局类型检查**

```bash
bun typecheck
```
预期：opencode package 仅有 pre-existing test 错误，app package 通过

- [ ] **验证 2：确认所有提交**

```bash
git log --oneline -5
```
预期：
```
<new> feat: use pulse-orchestrator for pulse assistant suggestions
<new> feat: default pulse-chat-input to pulse-orchestrator agent
<new> feat: add pulse-orchestrator agent definition
...
```
