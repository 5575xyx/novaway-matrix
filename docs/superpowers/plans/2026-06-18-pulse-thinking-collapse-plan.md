# Pulse 思考过程折叠功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现助手回复中思考过程的折叠/展开功能，提升用户体验

**Architecture:** 修改PulseAssistant.tsx中的消息渲染逻辑，检测并渲染ReasoningPart为可折叠的Accordion组件

**Tech Stack:** SolidJS, Accordion组件, createSignal状态管理

---

## 文件结构

- **修改:** `packages/app/src/pages/pulse/PulseAssistant.tsx` - 主要实现文件
- **测试:** 无（UI功能测试）

## 任务分解

### Task 1: 添加折叠状态管理

**Files:**

- Modify: `packages/app/src/pages/pulse/PulseAssistant.tsx:24-33`

- [ ] **Step 1: 添加createSignal管理折叠状态**

```typescript
// 在PulseAssistant组件开头添加状态管理
const [expandedThinking, setExpandedThinking] = createSignal<Set<string>>(new Set())
```

- [ ] **Step 2: 添加切换折叠状态的函数**

```typescript
const toggleThinking = (messageId: string) => {
  setExpandedThinking((prev) => {
    const newSet = new Set(prev)
    if (newSet.has(messageId)) {
      newSet.delete(messageId)
    } else {
      newSet.add(messageId)
    }
    return newSet
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/pages/pulse/PulseAssistant.tsx
git commit -m "feat(pulse): add thinking collapse state management"
```

### Task 2: 修改消息渲染逻辑

**Files:**

- Modify: `packages/app/src/pages/pulse/PulseAssistant.tsx:240-254`

- [ ] **Step 1: 添加导入Accordion组件**

```typescript
import { Accordion } from "@opencode-ai/ui/accordion"
```

- [ ] **Step 2: 修改消息渲染逻辑，检查parts**

```typescript
<For each={messages()}>
  {(msg) => (
    <div class={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        class={`max-w-[85%] rounded-2xl px-4 py-3 text-13-regular leading-relaxed whitespace-pre-wrap ${
          msg.role === "user"
            ? "text-white rounded-br-md"
            : "bg-background-weak text-text-strong rounded-bl-md border border-border-weak-base"
        }`}
        style={msg.role === "user" ? { "background": "linear-gradient(135deg, var(--novaway-mode-color, #FF6B6B), #e05555)" } : undefined}
      >
        {msg.role === "assistant" && msg.parts?.some(p => p.type === "reasoning") ? (
          <div class="space-y-2">
            <Accordion multiple>
              <Accordion.Item value={`thinking-${msg.timestamp}`}>
                <Accordion.Trigger class="w-full text-left">
                  <div class="flex items-center gap-2 text-text-weak text-12-medium">
                    <span>思考过程</span>
                    <svg
                      class={`size-3 transition-transform ${expandedThinking().has(String(msg.timestamp)) ? "rotate-90" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </div>
                </Accordion.Trigger>
                <Accordion.Content>
                  <div class="text-12-regular text-text-weak mt-2 p-2 bg-background-base rounded border border-border-weak-base">
                    {msg.parts?.filter(p => p.type === "reasoning").map(p => (p as any).text).join("\n")}
                  </div>
                </Accordion.Content>
              </Accordion.Item>
            </Accordion>
            <div class="text-13-regular leading-relaxed whitespace-pre-wrap">
              {msg.parts?.filter(p => p.type === "text").map(p => (p as any).text).join("\n") || msg.content}
            </div>
          </div>
        ) : (
          msg.content
        )}
      </div>
    </div>
  )}
</For>
```

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/pages/pulse/PulseAssistant.tsx
git commit -m "feat(pulse): implement thinking process collapse UI"
```

### Task 3: 测试和验证

**Files:**

- 无

- [ ] **Step 1: 运行类型检查**

```bash
bun typecheck
```

- [ ] **Step 2: 启动开发服务器测试**

```bash
bun dev
```

- [ ] **Step 3: 测试功能**
  1. 进入Pulse模式
  2. 发送消息触发助手回复
  3. 验证思考过程显示为可折叠区域
  4. 点击展开/折叠按钮测试交互
  5. 验证最终答案正常显示

- [ ] **Step 4: Commit（如果需要调整）**

```bash
git add .
git commit -m "fix(pulse): adjust thinking collapse UI based on testing"
```

## 验证标准

1. ✅ 思考过程默认折叠
2. ✅ 点击可展开/折叠思考过程
3. ✅ 最终答案正常显示
4. ✅ 类型检查通过
5. ✅ 无UI错误或崩溃

## 回滚方案

如果实现有问题，可以：

1. 回滚到上一个commit
2. 或者注释掉Accordion相关代码，恢复原始渲染逻辑

## 注意事项

1. 确保Accordion组件已正确导入
2. 考虑大段思考过程的性能影响
3. 保持现有消息格式兼容性
4. 测试不同屏幕尺寸下的显示效果
