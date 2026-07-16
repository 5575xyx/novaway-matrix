# 运营主 Agent（pulse-orchestrator）设计文档

## 1. 背景与目标

### 1.1 问题

当前 Pulse 运营助手需要用户手动切换 Agent 来完成不同任务，操作繁琐且不直观。

### 1.2 目标

创建一个内置的「运营主 Agent」，自动分析用户意图并协调子 Agent 完成任务，用户无需手动切换。

## 2. 需求分析

### 2.1 核心需求

- **任务编排协调**：主 Agent 分析任务 → 拆分 → 分配给子 Agent
- **过程可见**：用户可以看到正在使用哪个子 Agent 处理
- **全系统调度**：可调用系统内所有 Agent（不限于运营类）

### 2.2 约束条件

- 不修改后端核心逻辑，完全利用现有 subagent 机制
- 最小改动原则，与现有系统兼容性最好

## 3. 架构设计

### 3.1 系统架构

```
用户消息
    ↓
PulseAssistant → 发送给 pulse-orchestrator
    ↓
pulse-orchestrator 分析意图，通过 task 工具调用子 Agent
    ↓
子 Agent 执行任务，返回结果
    ↓
pulse-orchestrator 汇总并返回给用户
```

### 3.2 核心原则

- 主 Agent 是一个普通的 primary agent，通过 `task` 工具调用子 agent
- 不修改后端核心逻辑，完全利用现有 subagent 机制
- UI 层面展示「正在使用 XX Agent 处理」的状态提示

## 4. 详细设计

### 4.1 Agent 定义

在 `packages/opencode/src/agent/agent.ts` 中新增：

```typescript
{
  name: "pulse-orchestrator",
  description: "运营主 Agent，分析用户意图并协调子 Agent 完成任务",
  mode: "primary",
  color: "#FF6B6B",
  prompt: `你是运营主 Agent，负责分析用户意图并协调子 Agent 完成任务。

## 核心职责
1. 分析用户消息，判断需要哪些子 Agent 协作
2. 通过 task 工具将任务分配给合适的子 Agent
3. 汇总子 Agent 的执行结果，返回给用户

## 可调度的子 Agent
- 小红书种草文案生成
- 抖音短视频脚本生成
- 公众号长文生成
- 多平台内容分发
- 日期计算和时间处理
- 代码开发和调试
- 文档写作和编辑
- 其他系统内置 Agent

## 输出格式
在调用子 Agent 前，先告知用户：
"正在使用 [Agent名称] 处理..."
执行完成后汇总结果。

## 注意事项
- 一次只处理一个主要任务
- 复杂任务可以拆分为多个步骤
- 始终用中文回复`,
}
```

### 4.2 UI 修改

#### PulseChatInput.tsx

- 默认选中 `pulse-orchestrator`（而非第一个 agent）
- Agent 下拉框中 `pulse-orchestrator` 排在最前面

#### PulseAssistant.tsx

- 在 `handleSend` 中，当检测到主 Agent 正在调用子 Agent 时，显示状态提示
- 使用 `onUpdate` 回调监听 session 更新，提取 `task` 工具调用信息

### 4.3 状态显示逻辑

```typescript
// 监听 session 更新，提取 task 工具调用
onUpdate((update) => {
  if (update.type === "message" && update.message.role === "assistant") {
    // 检查是否包含 task 工具调用
    const taskCalls = update.message.parts?.filter((p) => p.type === "tool-invocation" && p.toolName === "task")
    if (taskCalls?.length > 0) {
      // 显示状态："正在使用 [agentName] 处理..."
      setStatus(`正在使用 ${taskCalls[0].args.agent} 处理...`)
    }
  }
})
```

## 5. 文件变更清单

| 文件                                              | 变更内容                             |
| ------------------------------------------------- | ------------------------------------ |
| `packages/opencode/src/agent/agent.ts`            | 新增 `pulse-orchestrator` agent 定义 |
| `packages/app/src/pages/pulse/PulseChatInput.tsx` | 默认选中 `pulse-orchestrator`        |
| `packages/app/src/pages/pulse/PulseAssistant.tsx` | 新增状态显示逻辑                     |

## 6. 测试策略

### 6.1 功能测试

- 验证 `pulse-orchestrator` 出现在 Agent 列表中且默认选中
- 验证发送消息后，主 Agent 能正确调用子 Agent
- 验证状态提示正确显示「正在使用 XX Agent 处理...」

### 6.2 集成测试

- 验证与现有 subagent 机制的兼容性
- 验证子 Agent 的权限继承正确

## 7. 风险评估

| 风险                     | 影响 | 缓解措施                              |
| ------------------------ | ---- | ------------------------------------- |
| LLM 理解偏差导致路由错误 | 中   | 优化 prompt 描述，提供明确的路由规则  |
| 子 Agent 调用失败        | 低   | 利用现有错误处理机制                  |
| 性能影响                 | 低   | 主 Agent 只做路由决策，不执行实际任务 |

## 8. 后续迭代

- 支持并行调用多个子 Agent
- 支持任务进度实时显示
- 支持用户手动干预路由决策
