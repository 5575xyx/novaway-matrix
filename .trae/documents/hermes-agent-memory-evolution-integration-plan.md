# Hermes Agent 持久记忆与自我进化功能集成计划

## 一、概述

本文档详细描述了将开源项目 Hermes Agent 的核心能力——**持久记忆**（Persistent Memory）和**自我进化**（Self-Evolution）——集成到 NovaWay 项目中的完整技术方案。

### 1.1 目标

* 为 NovaWay 桌面端 Agent 添加跨会话的持久记忆能力，使 Agent 能够记住用户偏好、历史决策和上下文信息

* 实现技能的自我进化机制，让 Agent 能够自动审查、合并和归档自身创建的知识技能

* 在桌面端 UI 中提供专门的可视化面板，让用户直观查看记忆状态和进化过程

* 保持与 NovaWay 现有架构的一致性，遵循 Effect/Layer 依赖注入模式和 Drizzle ORM 数据层

### 1.2 适用范围

* **仅扩展桌面端**：所有 UI 新增和修改均在 `packages/app/`（SolidJS Web UI）和 `packages/opencode/`（后端核心）中实现

* 桌面端通过 Electron（`packages/desktop/`）内嵌 Web UI，IPC 通信自动可用

### 1.3 参考项目

* Hermes Agent 源码：`e:\AImoney\NovaWay-Matrix\novaway-coder\hermes-agent-main\`

* NovaWay 后端：`e:\AImoney\NovaWay-Matrix\novaway-coder\packages\opencode\`

* NovaWay 桌面端 UI：`e:\AImoney\NovaWay-Matrix\novaway-coder\packages\app\`

***

## 二、Hermes Agent 核心机制分析

### 2.1 持久记忆机制

Hermes Agent 的持久记忆由 **MemoryManager** 编排，通过 **MemoryProvider** 抽象基类实现可插拔的记忆后端。系统始终包含一个内建的 `builtin` provider（管理本地 MEMORY.md/USER.md 文件），最多允许一个外部 provider 并行运行。

#### 核心组件

| 组件                         | 文件位置                          | 源码行数     | 职责                            |
| -------------------------- | ----------------------------- | -------- | ----------------------------- |
| `MemoryManager`            | `agent/memory_manager.py`     | \~640 行  | 编排多个 provider，管理工具路由，暴露生命周期钩子 |
| `MemoryProvider`           | `agent/memory_provider.py`    | \~290 行  | 抽象基类，定义记忆后端的标准接口              |
| `ContextCompressor`        | `agent/context_compressor.py` | \~2080 行 | 上下文窗口压缩，保护头部/尾部，摘要中间轮次        |
| `StreamingContextScrubber` | `agent/memory_manager.py`     | \~170 行  | 流式输出中过滤 `<memory-context>` 标签 |

#### 生命周期流程（源码级对应）

以下流程直接展示 `agent/conversation_loop.py` 中 `run_conversation()` 函数的实际调用链，标注具体行号：

```
┌──────────────────────────────────────────────────────────────────────┐
│ run_conversation(agent, user_message, system_message,               │
│                  conversation_history, task_id, stream_callback...)  │
└──────────────────────────────────────────────────────────────────────┘
                                    │
    [1] 每轮对话入口 (conversation_loop.py:351-360)
    │
    ├── 重建系统提示词（仅首次或压缩后，line 582）
    │   └── _restore_or_build_system_prompt(agent, system_message, conversation_history)
    │        ├── agent._build_system_prompt(system_message)  ← line 288
    │        │   ├── 静态层 (stable): MEMORY.md / USER.md 内容
    │        │   │   └── agent._memory_store.format_for_system_prompt("memory")
    │        │   │   └── agent._memory_store.format_for_system_prompt("user")
    │        │   ├── 上下文层 (context): 任务描述 + 会话上下文
    │        │   └── 易变层 (volatile): MemoryManager.build_system_prompt()
    │        │       └── 遍历所有 provider.system_prompt_block()
    │        └── 缓存到 agent._cached_system_prompt ← 供后续轮次复用
    │
    ├── 恢复 _turns_since_memory 计数器（line 513-523）
    │   └── 从 conversation_history 中统计上次用户轮次数
    │   └── agent._turns_since_memory = prior_user_turns % agent._memory_nudge_interval
    │
    ├── 递增用户轮次计数器 agent._user_turn_count += 1  ← line 532
    │
    ├── 跟踪记忆审查触发器（line 549-559）
    │   └── _should_review_memory = False
    │   └── agent._turns_since_memory += 1
    │   └── if _turns_since_memory >= _memory_nudge_interval:
    │       └── _should_review_memory = True; _turns_since_memory = 0
    │
    ├── 发送用户消息到 messages[] ← line 562-564
    │   └── user_msg = {"role": "user", "content": user_message}
    │
    ├── 通知 provider 新一轮开始（line 762-766）
    │   └── agent._memory_manager.on_turn_start(agent._user_turn_count, msg)
    │
    ├── 外部记忆预取（line 769-780）★★★★★ 核心注入点
    │   └── _ext_prefetch_cache = agent._memory_manager.prefetch_all(query)
    │
    ├── [可选] 预检上下文压缩 ← line 588-667
    │
    ├── ── 主循环：每次 LLM 迭代 ──  ← line 697-950
    │   │
    │   ├── 构建 API 请求消息（line 940-958）★★★★★ 记忆注入点
    │   │   └── for idx, msg in enumerate(api_messages):
    │   │       └── if idx == current_turn_user_idx and msg.role == "user":
    │   │           ├── _fenced = build_memory_context_block(_ext_prefetch_cache)
    │   │           └── api_msg.content = _base + "\n\n" + _fenced  ← 注入到当前用户消息
    │   │
    │   ├── LLM 调用 (stream/non-stream)
    │   │
    │   ├── 执行工具调用（line 4376）
    │   │   └── 跟踪技能审查计数器（line 853-855）
    │   │       └── if "skill_manage" in valid_tool_names:
    │   │           └── agent._iters_since_skill += 1
    │   │
    │   └── 迭代直到 stop/finish 或达到 max_iterations
    │
    ├── ── 轮次后处理 ── ← line 4649-4703
    │   │
    │   ├── 检查技能审查触发器（line 4653-4658）
    │   │   └── _should_review_skills = False
    │   │   └── if _iters_since_skill >= _skill_nudge_interval:
    │   │       └── _should_review_skills = True; _iters_since_skill = 0
    │   │
    │   ├── 记忆同步 + 预热（line 4660-4666）★★★★★ 持久化核心
    │   │   └── agent._sync_external_memory_for_turn(
    │   │           original_user_message, final_response, interrupted, messages)
    │   │       ├── if interrupted: return ← 中断轮次不同步
    │   │       ├── memory_manager.sync_all(user, assistant, messages) ← 持久化
    │   │       └── memory_manager.queue_prefetch_all(user) ← 预热下一轮
    │   │
    │   ├── 后台审查（line 4670-4678）★★★★★ 自我进化触发
    │   │   └── if final_response and not interrupted and
    │   │          (_should_review_memory or _should_review_skills):
    │   │       └── agent._spawn_background_review(
    │   │              messages, review_memory, review_skills) ← 启动守护线程
    │   │
    │   └── 插件钩子 on_session_end（line 4688-4701）
    │       └── invoke_hook("on_session_end", ...)
    │
    └── 返回 result ← line 4703

    ── 会话生命周期（非每轮执行）──
    ├── shutdown_memory_provider(messages)  ← 显式关闭时
    │   ├── memory_manager.on_session_end(messages or [])
    │   └── memory_manager.shutdown_all()  ← 反向顺序关闭 provider
    ├── commit_memory_session(messages)  ← 会话切换时
    │   ├── memory_manager.on_session_end(messages or [])
    │   └── (不调用 shutdown_all，provider 保持运行)
    └── on_session_switch(new_session_id)  ← /resume、/branch、压缩时
        └── memory_manager.on_session_switch(new_session_id, ...)
```

**关键源码行号对照：**

| 序号 | 调用点                                     | conversation\_loop.py | run\_agent.py |
| -- | --------------------------------------- | --------------------- | ------------- |
| 1  | `run_conversation` 入口                   | L351-360              | -             |
| 2  | `_restore_or_build_system_prompt`       | L218-288              | -             |
| 3  | 恢复 `_turns_since_memory` 计数器            | L513-523              | -             |
| 4  | 递增 `_user_turn_count`                   | L532                  | -             |
| 5  | 跟踪 `_should_review_memory`              | L552-559              | -             |
| 6  | `on_turn_start` 通知                      | L762-766              | -             |
| 7  | `prefetch_all` 预取记忆                     | L774-780              | -             |
| 8  | 记忆上下文注入 (build\_memory\_context\_block) | L940-958              | -             |
| 9  | 跟踪 `_iters_since_skill`                 | L853-855              | -             |
| 10 | 检查 `_should_review_skills`              | L4653-4658            | -             |
| 11 | `_sync_external_memory_for_turn`        | L4660-4666            | L2403-2455    |
| 12 | `_spawn_background_review`              | L4670-4678            | L1336-1358    |
| 13 | `shutdown_memory_provider`              | -                     | L2457+        |
| 14 | `on_session_switch` 分发                  | -                     | L488-521      |

#### 关键设计细节

**仅允许一个外部 provider：**

```python
class MemoryManager:
    def add_provider(self, provider: MemoryProvider) -> None:
        is_builtin = provider.name == "builtin"
        if not is_builtin:
            if self._has_external:
                logger.warning("Rejected memory provider '%s' — "
                    "external provider '%s' is already registered...",
                    provider.name, existing)
                return
            self._has_external = True
        self._providers.append(provider)
        # 自动索引工具名 → provider
        for schema in provider.get_tool_schemas():
            tool_name = schema.get("name", "")
            if tool_name and tool_name not in self._tool_to_provider:
                self._tool_to_provider[tool_name] = provider
```

**sync\_turn 自动适配 messages 参数：**

```python
@staticmethod
def _provider_sync_accepts_messages(provider: MemoryProvider) -> bool:
    try:
        signature = inspect.signature(provider.sync_turn)
    except (TypeError, ValueError):
        return True
    params = list(signature.parameters.values())
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params):
        return True
    return "messages" in signature.parameters
```

#### 记忆上下文注入格式

Hermes Agent 使用 `<memory-context>` 标签对记忆上下文进行**围栏隔离**（context fencing）。重要的是，记忆上下文**并非注入到系统提示词中**，而是在每次 LLM API 调用时**注入到当轮用户消息前**。

##### 实际注入点代码（conversation\_loop.py:940-958）

```python
# ── 构建 API 请求消息时注入 ──────────────────────────
# _ext_prefetch_cache 在 prefetch_all() 阶段填充（line 774-780）
api_msg = msg.copy()

# 注入点：当轮用户消息（current_turn_user_idx 标记了第一轮用户消息的位置）
if idx == current_turn_user_idx and msg.get("role") == "user":
    _injections = []

    # 记忆上下文注入 ★★★★★ 核心逻辑
    if _ext_prefetch_cache:
        _fenced = build_memory_context_block(_ext_prefetch_cache)  # ← 包装围栏标签
        if _fenced:
            _injections.append(_fenced)

    # 插件上下文注入
    if _plugin_user_context:
        _injections.append(_plugin_user_context)

    # 拼接：原始用户内容 + 记忆上下文 + 插件上下文
    if _injections:
        _base = api_msg.get("content", "")
        api_msg["content"] = _base + "\n\n" + "\n\n".join(_injections)
```

关键设计要点：

* **仅注入到当轮用户消息**，不污染历史消息或系统提示词

* **缓存复用**：`_ext_prefetch_cache` 在主循环前预取一次，所有迭代复用同一缓存，避免重复调用 provider

* **layer 隔离**：`api_msg` 是 msg 的副本，原始 `messages[]` 不会被修改，确保不泄漏到会话持久化

##### 围栏标签格式

```xml
<memory-context>
[System note: The following is recalled memory context, 
NOT new user input. Treat as authoritative reference data — 
this is the agent's persistent memory and should inform all responses.]

{实际记忆内容}
</memory-context>
```

##### 标签清理工具链（memory\_manager.py:54-241）

1. **sanitize\_context()** — 在构建上下文块之前，清理可能存在的嵌套注入：

```python
_FENCE_TAG_RE = re.compile(r'</?\s*memory-context\s*>', re.IGNORECASE)
_INTERNAL_CONTEXT_RE = re.compile(
    r'<\s*memory-context\s*>[\s\S]*?</\s*memory-context\s*>', re.IGNORECASE)
_INTERNAL_NOTE_RE = re.compile(
    r'\[System note:\s*The following is recalled memory context,\s*NOT new user input\.\s*...', re.IGNORECASE)

def sanitize_context(text: str) -> str:
    text = _INTERNAL_CONTEXT_RE.sub('', text)   # 剥离内嵌记忆上下文块
    text = _INTERNAL_NOTE_RE.sub('', text)       # 剥离系统注记
    text = _FENCE_TAG_RE.sub('', text)           # 剥离游离标签
    return text
```

1. **build\_memory\_context\_block()** — 统一构建上下文块（内存模块后的实际调用）：

```python
def build_memory_context_block(raw_context: str) -> str:
    if not raw_context or not raw_context.strip():
        return ""
    clean = sanitize_context(raw_context)
    if clean != raw_context:
        logger.warning("memory provider returned pre-wrapped context; stripped")
    return (
        "<memory-context>\n"
        "[System note: The following is recalled memory context, "
        "NOT new user input. Treat as authoritative reference data — "
        "this is the agent's persistent memory and should inform all responses.]\n\n"
        f"{clean}\n"
        "</memory-context>"
    )
```

1. **StreamingContextScrubber** — 流式输出状态机，跨 chunk 边界过滤 `memory-context` 标签，防止标签泄漏到用户可见输出：

```python
class StreamingContextScrubber:
    _OPEN_TAG = "<memory-context>"
    _CLOSE_TAG = "</memory-context>"

    def __init__(self):
        self._in_span: bool = False    # 当前是否在 memory-context 标签对内
        self._buf: str = ""            # 缓存可能跨越 chunk 边界的部分标签
        self._at_block_boundary: bool = True  # 防止中间行匹配

    def feed(self, text: str) -> str:
        """返回清洗后的可见文本。
        
        状态机行为：
        - 在 span 外：追加到 out，检测可能的 <memory-context> 开放
        - 在 span 内：丢弃所有内容直到 </memory-context> 关闭
        - 部分标签（如 chunk 边界上 <memory-con）缓存在 _buf 中
        """
        ...  # 完整实现见 memory_manager.py:62-225

    def flush(self) -> str:
        """流结束时：
        - 未闭合 span → 丢弃缓存（泄漏部分记忆比截断回答更糟糕）
        - 非 span → 输出缓存的尾部标签文本
        """
        if self._in_span:
            self._buf = ""
            self._in_span = False
            return ""
        tail = self._buf
        self._buf = ""
        return tail
```

**完整数据流**（从 prefetch 到 UI 输出）：

```
prefetch_all(query)  ← conversation_loop.py:774-780
  └── 遍历所有 provider.prefetch(query, session_id)
  └── 返回合并上下文文本

build_memory_context_block(raw_context)  ← memory_manager.py:227-241
  ├── sanitize_context(raw_context)      ← 清理嵌套标签
  └── 包装 <memory-context> 围栏标签

inject to api_msg.content  ← conversation_loop.py:940-958
  └── 注入到当轮用户消息前，仅供 LLM 调用
  └── 原始 messages[] 不修改

LLM 输出流 → StreamingContextScrubber.feed(delta)  ← 过滤输出
  └── 跨 chunk 追踪 <memory-context> 状态
  └── 输出给用户的文本中完全不可见
```

#### MemoryProvider 接口（Hermes 原始定义 + NovaWay TypeScript 等价接口）

##### Hermes Agent Python 抽象基类（memory\_provider.py）

```python
class MemoryProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        """标识符，如 'builtin'、'honcho'、'hindsight'"""

    # ── 核心生命周期（必须实现） ──────────────────────────

    @abstractmethod
    def is_available(self) -> bool:
        """检查配置和凭据是否完备。不做网络调用。"""

    @abstractmethod
    def initialize(self, session_id: str, **kwargs) -> None:
        """Agent 启动时调用。
        kwargs 始终包含: hermes_home, platform
        kwargs 可能包含: agent_context, agent_identity, user_id 等"""

    def system_prompt_block(self) -> str:
        """返回静态系统提示词块。空字符串 = 跳过。"""

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """预取记忆上下文供本轮使用。返回格式化文本，空串表示无相关内容。"""

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        """为下一轮异步预热记忆检索。默认 no-op。"""

    def sync_turn(self, user_content: str, assistant_content: str, *,
                  session_id: str = "",
                  messages: Optional[List[Dict[str, Any]]] = None) -> None:
        """持久化本轮对话。应非阻塞。"""

    @abstractmethod
    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """返回 OpenAI 格式的工具定义列表。无工具时返回空列表。"""

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        """处理此 provider 注册的工具调用。返回 JSON 字符串。"""

    def shutdown(self) -> None:
        """清理 — 刷新队列、关闭连接。"""

    # ── 可选生命周期钩子 ──────────────────────────────

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        """每轮开始时调用。kwargs 可能包含: remaining_tokens, model, platform, tool_count"""

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """会话结束时调用（CLI 退出、/reset、gateway 会话过期）。"""

    def on_session_switch(self, new_session_id: str, *,
                          parent_session_id: str = "",
                          reset: bool = False, **kwargs) -> None:
        """会话 ID 在中途切换时调用（/resume、/branch、/reset、压缩）。"""

    def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
        """上下文压缩前调用。返回要注入到压缩提示词中的关键信息。"""

    def on_memory_write(self, action: str, target: str, content: str,
                        metadata: Optional[Dict[str, Any]] = None) -> None:
        """内置 memory 工具写入时调用。用于镜像写入外部后端。"""

    def on_delegation(self, task: str, result: str, *,
                      child_session_id: str = "", **kwargs) -> None:
        """子 agent 完成委托时在父 agent 上调用。"""

    def get_config_schema(self) -> List[Dict[str, Any]]:
        """返回配置字段定义，用于交互式配置向导。"""
        return []

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        """写入非秘密配置到 provider 的原生位置。"""
```

##### NovaWay TypeScript MemoryProvider 接口（provider.ts）

```typescript
// ── MemoryProvider 抽象接口 ──────────────────────────
// 对应 Hermes Agent 的 MemoryProvider ABC，适配 NovaWay 的 Effect 生态

export interface MemoryProvider {
  /** 唯一标识符，如 "sqlite"、"honcho"、"mem0" */
  readonly name: string

  // ── 核心生命周期 ────────────────────────────────

  /** 检查配置是否完备，不做网络调用 */
  readonly isAvailable: Effect.Effect<boolean>

  /** Agent 启动初始化 */
  readonly initialize: (input: {
    sessionID: string
    projectID: ProjectID
  }) => Effect.Effect<void>

  /** 返回静态系统提示词块，空则跳过 */
  readonly systemPromptBlock?: Effect.Effect<string>

  /** 预取记忆上下文供本轮使用 */
  readonly prefetch: (input: {
    query: string
    sessionID: string
  }) => Effect.Effect<string>

  /** 为下一轮异步预热（默认 no-op） */
  readonly queuePrefetch?: (input: {
    query: string
    sessionID: string
  }) => Effect.Effect<void>

  /** 持久化本轮对话 */
  readonly syncTurn: (input: {
    userContent: string
    assistantContent: string
    sessionID: string
    messages?: MessageV2.WithParts[]
  }) => Effect.Effect<void>

  /** 返回工具定义列表 */
  readonly getToolSchemas: () => Tool.Def[]

  /** 处理此 provider 注册的工具调用 */
  readonly handleToolCall: (input: {
    toolName: string
    args: Record<string, unknown>
  }) => Effect.Effect<string>

  /** 清理 — 刷新队列、关闭连接 */
  readonly shutdown?: Effect.Effect<void>

  // ── 可选生命周期钩子 ────────────────────────────

  readonly onTurnStart?: (input: {
    turnNumber: number
    message: string
  }) => Effect.Effect<void>

  readonly onSessionEnd?: (input: {
    messages: MessageV2.WithParts[]
  }) => Effect.Effect<void>

  readonly onSessionSwitch?: (input: {
    newSessionID: string
    parentSessionID?: string
    reset?: boolean
  }) => Effect.Effect<void>

  readonly onPreCompress?: (input: {
    messages: MessageV2.WithParts[]
  }) => Effect.Effect<string>

  readonly onMemoryWrite?: (input: {
    action: string
    target: string
    content: string
    metadata?: Record<string, unknown>
  }) => Effect.Effect<void>

  readonly onDelegation?: (input: {
    task: string
    result: string
    childSessionID?: string
  }) => Effect.Effect<void>
}

// ── SQLiteMemoryProvider 默认实现 ─────────────────
// 内建 provider，持久化到 Drizzle ORM + SQLite

export const SQLiteMemoryProvider: MemoryProvider = {
  name: "sqlite",
  isAvailable: Effect.succeed(true),

  initialize: ({ sessionID, projectID }) =>
    Effect.gen(function* () {
      // 无需额外初始化，由 Effect Layer 自动管理
    }),

  prefetch: ({ query, sessionID }) =>
    Effect.gen(function* () {
      const service = yield* MemoryService
      const entries = yield* service.search({ query, limit: 5 })
      if (entries.length === 0) return ""
      return entries
        .map((e) => `[${e.type}] ${e.content} (importance: ${e.importance})`)
        .join("\n---\n")
    }),

  syncTurn: ({ userContent, assistantContent, sessionID }) =>
    Effect.gen(function* () {
      const service = yield* MemoryService
      // 自动提取关键信息（实现见 Phase 2）
    }),

  getToolSchemas: () => [],

  handleToolCall: ({ toolName, args }) =>
    Effect.succeed(JSON.stringify({ success: false, message: "no tools" })),
}

// ── MemoryProvider Layer ─────────────────────────
// 允许多个 provider 注册，但只有 provider 列表中的第一个作为外部 provider

export const MemoryProviderLayer = Layer.effect(
  MemoryProviderService,
  Effect.gen(function* () {
    const providers: MemoryProvider[] = []
    // 默认注册 SQLiteMemoryProvider
    providers.push(SQLiteMemoryProvider)
    // 可通过配置注册外部 provider
    // if config.honcho.enabled: providers.push(HonchoMemoryProvider)
    return { providers }
  }),
)
```

### 2.2 自我进化机制

Hermes Agent 的自我进化由 **Curator** 实现，它是一个后台技能维护调度器，不需要 cron 守护进程，而是基于空闲检测触发。

#### 核心组件

| 组件             | 文件位置                          | 源码行数     | 职责                  |
| -------------- | ----------------------------- | -------- | ------------------- |
| `curator.py`   | `agent/curator.py`            | \~500+ 行 | 调度器、状态转换、审查流程编排     |
| `skill_usage`  | `tools/skill_usage.py`        | 待定       | 技能使用统计、agent 创建判定   |
| `skill_manage` | `tools/skill_manager_tool.py` | \~900 行  | 技能管理工具（创建、编辑、归档、合并） |

#### 技能生命周期状态机

##### 状态定义与转换图

```
                  ┌──────────┐
                  │  ACTIVE  │ ← 技能创建时默认
                  └────┬─────┘
                       │ 30 天（默认）无活动
                       ▼
                  ┌──────────┐
                  │  STALE   │ ── 有新活动 ──→ ACTIVE（自动恢复）
                  └────┬─────┘
                       │ 90 天（默认）无活动
                       ▼
                  ┌──────────┐
                  │ ARCHIVED │ ← 可恢复（移到 .archive/），永不删除
                  └──────────┘

  特殊标记：PINNED ── 跳过所有自动转换，但不阻止内容更新
  保护规则：BUNDLED / HUB_INSTALLED ── 跳过自动转换 + curator 合并/归档
```

##### 触发时机：每轮对话末尾检查（conversation\_loop.py:4652-4658）

Hermes Agent 使用**两个独立的计数器**来触发记忆和技能审查：

```python
# ── 每轮对话入口处（line 549-559）──
# _should_review_memory 记忆审查触发器（基于用户轮次数）
_should_review_memory = False
if (agent._memory_nudge_interval > 0
        and "memory" in agent.valid_tool_names
        and agent._memory_store):
    agent._turns_since_memory += 1
    if agent._turns_since_memory >= agent._memory_nudge_interval:
        _should_review_memory = True
        agent._turns_since_memory = 0  # 重置计数器

# ── 工具迭代过程中（line 853-855）──
# _iters_since_skill 技能审查计数器（基于工具调用迭代次数）
if (agent._skill_nudge_interval > 0
        and "skill_manage" in agent.valid_tool_names):
    agent._iters_since_skill += 1

# ── 每轮对话末尾（line 4653-4658）──
# _should_review_skills 技能审查触发器
_should_review_skills = False
if (agent._skill_nudge_interval > 0
        and agent._iters_since_skill >= agent._skill_nudge_interval
        and "skill_manage" in agent.valid_tool_names):
    _should_review_skills = True
    agent._iters_since_skill = 0  # 重置计数器
```

**关键设计点：**

* `_turns_since_memory` 以用户轮次为单位，每轮对话 +1

* `_iters_since_skill` 以工具迭代为单位，每次 tool call +1

* 计数器在 `AIAgent.__init__` 中初始化为 0，跨轮次持久化

* gateway 模式创建新 AIAgent 时从 `conversation_history` 恢复计数器（line 513-523）

##### 后台审查流程（background\_review\.py:327-560 + conversation\_loop.py:4670-4678）

当 `_should_review_memory` 或 `_should_review_skills` 为 True 时，触发 `_spawn_background_review`，启动独立守护线程执行审查：

```python
# conversation_loop.py:4670-4678
if final_response and not interrupted and (_should_review_memory or _should_review_skills):
    try:
        agent._spawn_background_review(
            messages_snapshot=list(messages),
            review_memory=_should_review_memory,
            review_skills=_should_review_skills,
        )
    except Exception:
        pass  # 后台审查最佳失败，不影响主流程
```

后台审查的架构（background\_review\.py:327-560）：

1. **fork AIAgent**：克隆父 agent 的 runtime（provider、model、credentials、缓存系统提示词）
2. **工具白名单**：仅允许 memory 和 skill 管理工具，其他工具在运行时被拒绝
3. **选择提示词**：根据触发类型选择 `_MEMORY_REVIEW_PROMPT`、`_SKILL_REVIEW_PROMPT` 或 `_COMBINED_REVIEW_PROMPT`
4. **运行审查**：将当前轮次的 `messages_snapshot` 作为对话历史，审查提示词作为用户消息
5. **收集结果**：扫描审查 agent 的 tool call 结果，去重（跳过已经在 history 中的工具消息）
6. **用户摘要**：通过 `agent._safe_print` 输出 `💾 Self-improvement review: ...`，包含成功的工具操作摘要

##### 状态自动转换（curator.py:apply\_automatic\_transitions）

```python
DEFAULT_STALE_AFTER_DAYS = 30
DEFAULT_ARCHIVE_AFTER_DAYS = 90

def apply_automatic_transitions(now=None) -> Dict[str, int]:
    stale_cutoff = now - timedelta(days=get_stale_after_days())
    archive_cutoff = now - timedelta(days=get_archive_after_days())

    counts = {"marked_stale": 0, "archived": 0, "reactivated": 0, "checked": 0}

    for row in agent_created_report():        # 仅处理 agent 创建的技能
        counts["checked"] += 1
        name = row["name"]
        if row.get("pinned"):                 # 钉选技能跳过
            continue
        if is_bundled_or_hub_installed(name): # 保护技能跳过
            continue

        last_activity = parse_iso(row.get("last_activity_at"))
        anchor = last_activity or parse_iso(row.get("created_at")) or now
        current = row.get("state", STATE_ACTIVE)

        if anchor <= archive_cutoff and current != STATE_ARCHIVED:
            archive_skill(name)               # 90 天无活动 → 归档
            counts["archived"] += 1
        elif anchor <= stale_cutoff and current == STATE_ACTIVE:
            set_state(name, STATE_STALE)      # 30 天无活动 → 标记为 stale
            counts["marked_stale"] += 1
        elif anchor > stale_cutoff and current == STATE_STALE:
            set_state(name, STATE_ACTIVE)     # 重新活动 → 恢复为 active
            counts["reactivated"] += 1

    return counts
```

#### Curator 触发条件（完整源码逻辑）

Curator 的触发机制分为三个层次：**配置加载** → **间隔检查** → **对话循环触发**。

##### 层次 1：配置加载（curator.py）

```python
DEFAULT_INTERVAL_HOURS = 24 * 7     # 7 天
DEFAULT_MIN_IDLE_HOURS = 2          # 2 小时

def is_enabled() -> bool:
    cfg = _load_config()              # 从 config.yaml 读取 curator.*
    return bool(cfg.get("enabled", True))  # 默认启用

def get_stale_after_days() -> int:   # 默认 30
def get_archive_after_days() -> int:  # 默认 90
def get_interval_hours() -> int:     # 默认 168
def get_min_idle_hours() -> float:   # 默认 2
```

##### 层次 2：间隔检查（curator.py:should\_run\_now）

```python
def should_run_now(now=None) -> bool:
    """三个门控条件：
       1. curator.enabled == True
       2. not paused
       3. last_run_at 存在且距今 >= interval_hours
    """
    if not is_enabled():
        return False
    if is_paused():
        return False

    state = load_state()          # 从 .curator_state 文件读取
    last = parse_iso(state.get("last_run_at"))
    if last is None:
        # 首次运行：初始化 last_run_at = now，等待一个完整间隔
        state["last_run_at"] = now.isoformat()
        save_state(state)
        return False              # 首次不执行

    interval = timedelta(hours=get_interval_hours())
    return (now - last) >= interval
```

##### 层次 3：对话循环触发（conversation\_loop.py:4652-4658）

这是 Curator 在每轮对话末尾的实际触发点，与 `_sync_external_memory_for_turn` 在同一位位置：

```python
# ── 对话末尾后处理 ─────────────────────────────
# (conversation_loop.py:4649-4703)

# 检查技能审查触发器
_should_review_skills = False
if (agent._skill_nudge_interval > 0
        and agent._iters_since_skill >= agent._skill_nudge_interval
        and "skill_manage" in agent.valid_tool_names):
    _should_review_skills = True
    agent._iters_since_skill = 0

# 外部记忆同步
agent._sync_external_memory_for_turn(
    original_user_message=original_user_message,
    final_response=final_response,
    interrupted=interrupted,
    messages=messages,
)

# 后台记忆/技能审查 — 在响应交付后执行，
# 确保不会与用户任务竞争模型的注意力。
if final_response and not interrupted and (_should_review_memory or _should_review_skills):
    try:
        agent._spawn_background_review(
            messages_snapshot=list(messages),
            review_memory=_should_review_memory,
            review_skills=_should_review_skills,
        )
    except Exception:
        pass  # 后台审查是最佳失败操作
```

**完整的 3 级触发链总结：**

```
┌─ 层次 1: 配置加载 ──────────────────────┐
│ curator.enabled = True                   │
│ curator.min_idle_hours = 2               │
│ curator.stale_after_days = 30            │
│ curator.archive_after_days = 90          │
└──────────────────────────────────────────┘
        │
        ▼
┌─ 层次 2: 间隔检查 (should_run_now) ──────┐
│ 1. is_enabled() = True                   │
│ 2. is_paused() = False                   │
│ 3. 距离上次运行 >= interval_hours        │
│ 4. 首次运行跳过（仅初始化时间戳）         │
│ 全部通过 → 返回 True                      │
└──────────────────────────────────────────┘
        │
        ▼
┌─ 层次 3: 对话循环触发 (每轮末尾) ─────────┐
│ run_conversation() 结尾 (L4649-4678):    │
│                                           │
│ [1] _should_review_memory?                │
│     ← _turns_since_memory >= nudge_interval
│ [2] _should_review_skills?                │
│     ← _iters_since_skill >= nudge_interval │
│ [3] 任一为 True → _spawn_background_review│
│     ├── fork AIAgent (runtime 继承)       │
│     ├── 工具白名单 (仅 memory/skills)     │
│     └── 守护线程执行审查                    │
└──────────────────────────────────────────┘
```

#### Curator 审查流程（CURATOR\_REVIEW\_PROMPT 完整结构）

审查流程使用辅助模型 fork 一个独立的 AIAgent，通过 `CURATOR_REVIEW_PROMPT`（约 450 行的提示词）指导审查：

1. **扫描候选列表**：遍历所有 agent 创建的技能，识别**前缀聚类**（prefix clusters），即共享首个词或领域关键词的技能（如 `react-*`、`python-*`、`gateway-*` 等），预期发现 10-25 个聚类

2. **三种合并策略**：

   * **合并到已有伞形技能**（Merge into existing umbrella）：聚类中已有一个足够宽泛的技能作为父级 → 贴标签补丁 + 归档兄弟技能

   * **创建新伞形技能**（Create new umbrella）：聚类中没有合适的父级 → 用 `skill_manage action=create` 新建类级 SKILL.md + 归档窄技能

   * **降级到引用/模板/脚本**（Demote to references/templates/scripts）：窄技能中有价值但过于具体的会话级内容 → 移到伞形技能的支持目录

3. **硬性规则**：

   * 不碰绑定或 hub 安装的技能

   * 不删除任何技能（最大破坏是移到 `.archive/`）

   * 不碰钉选技能

   * 每次审查至少归档 10 个技能

4. **输出格式**（结构化的 YAML 摘要）：

```yaml
consolidations:
  - from: <old-skill-name>
    into: <umbrella-skill-name>
    reason: <合并理由>
prunings:
  - name: <skill-name>
    reason: <修剪理由>
```

#### 持久化状态（.curator\_state 文件）

```python
_state_file() -> Path:
    return get_hermes_home() / "skills" / ".curator_state"

_default_state():
    return {
        "last_run_at": None,                     # 上次运行时间
        "last_run_duration_seconds": None,       # 耗时（秒）
        "last_run_summary": None,                # 运行摘要
        "last_run_summary_shown_at": None,       # 摘要呈现时间
        "last_report_path": None,                # 报告文件路径
        "paused": False,                         # 暂停标记
        "run_count": 0,                          # 运行次数
    }
```

***

## 三、NovaWay 现有架构分析

### 3.1 可复用的基础设施

| 模块         | 文件位置                                    | 可复用能力                |
| ---------- | --------------------------------------- | -------------------- |
| Session 管理 | `session/session.ts`                    | 会话 CRUD、消息存储、状态跟踪    |
| LLM 集成     | `session/llm.ts`                        | 流式 LLM 交互封装          |
| 上下文压缩      | `session/compaction.ts`                 | 已有的摘要模板和自动压缩机制       |
| Agent 系统   | `agent/agent.ts`                        | 多 Agent 注册、生命周期管理    |
| Skill 系统   | `skill/index.ts`                        | 技能发现、加载、注册           |
| 工具系统       | `tool/tool.ts`、`tool/registry.ts`       | 工具定义和注册              |
| 数据库        | `storage/db.ts`、`storage/schema.sql.ts` | Drizzle ORM + SQLite |
| 系统提示词      | `session/prompt.ts`                     | 系统提示词构建流程            |
| 依赖注入       | Effect/Layer                            | 标准化的服务层模式            |

### 3.2 数据库表结构（现有）

```
SessionTable (session)
  ├── id, project_id, parent_id, slug, directory, title
  ├── cost, tokens (input/output/reasoning/cache)
  ├── agent, model, permission, revert
  ├── time_compacting, time_archived
  └── ...Timestamps

MessageTable (message)
  ├── id, session_id, data (JSON)
  └── ...Timestamps

PartTable (part)
  ├── id, message_id, session_id, data (JSON)
  └── ...Timestamps

Skill 系统 (非数据库，JSON 文件)
  ├── Info: name, description, location, content
  └── 从多个来源发现：内置、项目、全局、外部
```

### 3.3 桌面端 UI 架构分析

NovaWay 桌面端基于 Electron + SolidJS 架构：

```
packages/desktop/           # Electron 桌面壳
  └── src/main/             # 主进程（IPC、窗口管理、菜单）
  └── src/preload/          # 预加载脚本
  └── src/renderer/         # 渲染进程入口

packages/app/               # SolidJS Web UI（被桌面端内嵌）
  └── src/
      ├── pages/
      │   ├── session.tsx           # 会话主页面（核心）
      │   ├── session/
      │   │   ├── session-side-panel.tsx  # 侧边面板（文件树、审查、上下文标签）
      │   │   ├── message-timeline.tsx    # 消息时间线
      │   │   └── composer/              # 输入编辑器
      │   └── layout.tsx            # 整体布局
      ├── components/
      │   ├── session-context-usage.tsx   # 上下文使用量指示器（进度圈）
      │   ├── session-header.tsx          # 会话头部
      │   └── session/                    # 会话相关子组件
      └── context/                        # 全局状态管理
```

**关键 UI 集成点**：

| 集成位置      | 文件                          | 可视化方式                 |
| --------- | --------------------------- | --------------------- |
| 会话头部状态指示器 | `session-header.tsx`        | 在现有上下文使用量旁边添加记忆/进化指示器 |
| 侧边面板新标签页  | `session-side-panel.tsx`    | 添加"记忆与进化"标签页，展示完整面板   |
| 会话上下文使用量  | `session-context-usage.tsx` | 扩展进度圈，增加记忆状态图标        |

**现有 UI 模式参考**：

* `session-context-usage.tsx` 使用 `ProgressCircle` 组件展示 token 使用量，可作为记忆状态指示器的参考

* `session-side-panel.tsx` 使用 `Tabs` 组件管理多个标签页（文件树、审查、上下文），可新增标签

* 所有 UI 组件使用 `@opencode-ai/ui` 组件库和 SolidJS 响应式状态

### 3.4 集成点分析

| 集成点       | 文件                                     | 集成方式                 |
| --------- | -------------------------------------- | -------------------- |
| 系统提示词构建   | `session/prompt.ts`                    | 注入记忆上下文块             |
| LLM 调用前后  | `session/llm.ts`                       | 添加 prefetch/sync 钩子  |
| 会话生命周期    | `session/session.ts`                   | 触发 on\_session\_end  |
| 上下文压缩     | `session/compaction.ts`                | 触发 on\_pre\_compress |
| 技能系统      | `skill/index.ts`                       | 扩展状态跟踪               |
| Agent 状态  | `agent/agent.ts`                       | 检测 agent 空闲状态        |
| 桌面端 UI 面板 | `pages/session/session-side-panel.tsx` | 新增"记忆与进化"标签页         |
| 桌面端状态指示器  | `components/session-header.tsx`        | 新增记忆/进化状态图标          |

***

## 四、技术方案设计

### 4.1 架构概览

```
┌─────────────────────────────────────────────────────┐
│                    NovaWay Agent                      │
├─────────────────────────────────────────────────────┤
│  session/prompt.ts  ← 注入记忆上下文                  │
│  session/llm.ts     ← prefetch/sync 钩子              │
│  session/session.ts ← 生命周期钩子                     │
│  session/compaction.ts ← on_pre_compress 钩子          │
├─────────────────────────────────────────────────────┤
│                    Memory 模块                        │
│  ┌─────────────────────────────────────────────┐    │
│  │  MemoryManager                              │    │
│  │  ├── prefetchAll(query) → 记忆上下文         │    │
│  │  ├── syncAll(user, assistant) → 持久化       │    │
│  │  ├── buildMemoryContextBlock() → 格式化       │    │
│  │  └── 生命周期钩子                            │    │
│  └──────────────┬──────────────────────────────┘    │
│  ┌──────────────▼──────────────────────────────┐    │
│  │  MemoryProvider (抽象)                       │    │
│  │  └── SQLiteMemoryProvider (默认实现)          │    │
│  └──────────────┬──────────────────────────────┘    │
│  ┌──────────────▼──────────────────────────────┐    │
│  │  MemoryService                              │    │
│  │  ├── CRUD 操作                               │    │
│  │  ├── 语义检索（关键词匹配）                    │    │
│  │  └── 重要性衰减算法                           │    │
│  └─────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────┤
│                   Evolution 模块                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  CuratorService                             │    │
│  │  ├── shouldRun() → 触发条件检查               │    │
│  │  ├── applyAutoTransitions() → 状态转换        │    │
│  │  └── runReview() → LLM 驱动审查               │    │
│  └──────────────┬──────────────────────────────┘    │
│  ┌──────────────▼──────────────────────────────┐    │
│  │  SkillEvolutionService                      │    │
│  │  ├── trackUsage(skillName) → 使用统计         │    │
│  │  ├── setState(name, state) → 状态管理         │    │
│  │  └── getEvolutionReport() → 进化报告          │    │
│  └─────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────┤
│                    数据层                             │
│  Drizzle ORM + SQLite                                │
│  ├── MemoryEntryTable                                │
│  ├── SkillEvolutionTable                             │
│  └── CuratorStateTable                               │
└─────────────────────────────────────────────────────┘
```

### 4.2 数据模型设计

#### MemoryEntryTable

```typescript
// packages/opencode/src/memory/memory.sql.ts
export const MemoryEntryTable = sqliteTable("memory_entry", {
  id: text().primaryKey(),
  session_id: text().$type<SessionID>().notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  project_id: text().$type<ProjectID>().notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  type: text().notNull(),        // "memory" | "user_preference" | "fact" | "decision"
  content: text().notNull(),     // 记忆内容
  importance: integer().notNull().default(5),  // 重要程度 0-10
  access_count: integer().notNull().default(0),
  last_accessed_at: integer(),
  ...Timestamps,
}, (table) => [
  index("memory_entry_session_idx").on(table.session_id),
  index("memory_entry_project_idx").on(table.project_id),
  index("memory_entry_type_idx").on(table.type),
  index("memory_entry_importance_idx").on(table.importance),
])
```

#### SkillEvolutionTable

```typescript
// packages/opencode/src/evolution/evolution.sql.ts
export const SkillEvolutionTable = sqliteTable("skill_evolution", {
  skill_name: text().primaryKey(),
  state: text().notNull().default("active"),  // "active" | "stale" | "archived"
  last_activity_at: integer(),
  use_count: integer().notNull().default(0),
  pinned: integer().notNull().default(0),     // 0 | 1
  parent_skill: text(),                       // 伞形技能的父技能名
  consolidated_from: text({ mode: "json" }).$type<string[]>(),  // 被合并的技能名列表
  ...Timestamps,
})
```

#### CuratorStateTable

```typescript
// packages/opencode/src/evolution/evolution.sql.ts
export const CuratorStateTable = sqliteTable("curator_state", {
  id: integer().primaryKey().default(1),
  last_run_at: integer(),
  last_run_duration: integer(),
  last_run_summary: text(),
  paused: integer().notNull().default(0),     // 0 | 1
  run_count: integer().notNull().default(0),
  ...Timestamps,
})
```

### 4.3 服务接口设计

#### MemoryService

```typescript
// packages/opencode/src/memory/service.ts
export interface MemoryInterface {
  readonly add: (input: {
    sessionID: SessionID
    projectID: ProjectID
    type: string
    content: string
    importance?: number
  }) => Effect.Effect<MemoryEntry>

  readonly search: (input: {
    query: string
    projectID: ProjectID
    limit?: number
  }) => Effect.Effect<MemoryEntry[]>

  readonly get: (id: string) => Effect.Effect<MemoryEntry>

  readonly update: (id: string, input: Partial<{
    content: string
    importance: number
  }>) => Effect.Effect<MemoryEntry>

  readonly delete: (id: string) => Effect.Effect<void>

  readonly recordAccess: (id: string) => Effect.Effect<void>
}
```

#### MemoryManager

```typescript
// packages/opencode/src/memory/manager.ts
export interface MemoryManagerInterface {
  readonly prefetch: (input: {
    query: string
    sessionID: string
    projectID: ProjectID
  }) => Effect.Effect<string>

  readonly sync: (input: {
    userContent: string
    assistantContent: string
    sessionID: string
    projectID: ProjectID
  }) => Effect.Effect<void>

  readonly buildMemoryContextBlock: (context: string) => string

  readonly onSessionEnd: (input: {
    messages: MessageV2.WithParts[]
    sessionID: string
    projectID: ProjectID
  }) => Effect.Effect<void>

  readonly onPreCompress: (input: {
    messages: MessageV2.WithParts[]
    sessionID: string
  }) => Effect.Effect<string>
}
```

#### CuratorService

```typescript
// packages/opencode/src/evolution/curator.ts
export interface CuratorInterface {
  readonly shouldRun: (input: {
    agentIdleSince?: number
  }) => Effect.Effect<boolean>

  readonly applyAutoTransitions: () => Effect.Effect<{
    markedStale: number
    archived: number
    reactivated: number
    checked: number
  }>

  readonly runReview: (input: {
    dryRun?: boolean
  }) => Effect.Effect<CuratorReport>

  readonly pause: () => Effect.Effect<void>
  readonly resume: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<CuratorState>
}
```

***

## 五、桌面端 UI 面板设计

### 5.1 面板布局概览

在 Session 侧边面板中新增"记忆与进化"标签页，与现有的"文件树"、"审查"、"上下文"标签并列：

```
┌──────────────────────────────────────────────────────┐
│  SessionHeader                                       │
│  [模型选择] [Agent选择] [🔵上下文70%] [🧠记忆12条]    │
│  [🔄Curator: 就绪]                                   │
├────────────────┬─────────────────────────────────────┤
│  SidePanel     │  MessageTimeline                    │
│                │                                     │
│  [文件树]      │  User: 帮我写一个...                 │
│  [审查]        │  Agent: 好的，我来...                 │
│  [上下文]      │                                     │
│  [🧠记忆与进化] │  [记忆上下文] 用户偏好：使用中文...  │
│  ◄ 选中        │                                     │
│                │                                     │
│  ┌──────────┐  │                                     │
│  │ 记忆面板  │  │                                     │
│  │          │  │                                     │
│  │ 进化面板  │  │                                     │
│  └──────────┘  │                                     │
├────────────────┴─────────────────────────────────────┤
│  SessionComposer                                     │
└──────────────────────────────────────────────────────┘
```

### 5.2 记忆面板组件设计

#### 组件：`MemoryPanel` (`packages/app/src/components/memory/memory-panel.tsx`)

**功能区域**：

```
┌─────────────────────────────────┐
│ 🧠 持久记忆            [12条]   │  ← 标题栏 + 总数
├─────────────────────────────────┤
│ 🔍 [搜索记忆...              ]  │  ← 搜索框
├─────────────────────────────────┤
│ 类型筛选：[全部][偏好][事实][决策]│  ← 类型筛选按钮
├─────────────────────────────────┤
│                                 │
│ 📌 用户偏好：使用简体中文交流    │  ← 记忆条目卡片
│    类型: 偏好 | 重要度: ★★★★☆  │
│    上次访问: 2小时前             │
│                                 │
│ 📌 项目使用 React + TypeScript  │
│    类型: 事实 | 重要度: ★★★☆☆  │
│    上次访问: 1天前               │
│                                 │
│ ...更多条目...                   │
│                                 │
├─────────────────────────────────┤
│ [+ 添加记忆]                    │  ← 底部操作按钮
└─────────────────────────────────┘
```

**记忆条目卡片设计**：

每个记忆条目卡片显示：

* **内容摘要**：记忆内容的前 80 个字符

* **类型标签**：彩色标签（偏好=蓝色、事实=绿色、决策=橙色）

* **重要度星级**：1-5 星可视化

* **最近访问时间**：相对时间显示

* **操作按钮**：编辑、删除（hover 时显示）

**交互功能**：

* 点击卡片展开完整内容

* 支持内联编辑

* 实时搜索过滤

#### 状态指示器：`MemoryIndicator` (`packages/app/src/components/session-header.tsx` 内扩展)

在会话头部与现有的上下文使用量指示器并列：

```
┌──────────────────────────────────────────────────┐
│ [Logo] 项目名 > 会话标题        [模型] [Agent]   │
│                                    [🔵70%] [🧠12] │ ← 新增
└──────────────────────────────────────────────────┘
```

* **图标**：🧠 大脑图标 + 记忆条数

* **颜色**：绿色=正常、黄色=记忆较多、红色=需要清理

* **Tooltip**：hover 显示"持久记忆：12条 | 最近检索：3条匹配"

* **点击**：打开侧边面板的记忆标签页

### 5.3 进化面板组件设计

#### 组件：`EvolutionPanel` (`packages/app/src/components/evolution/evolution-panel.tsx`)

**功能区域**：

```
┌─────────────────────────────────┐
│ 🔄 技能进化                     │  ← 标题栏
├─────────────────────────────────┤
│ Curator 状态                    │
│ ┌─────────────────────────────┐ │
│ │ 状态：● 就绪（空闲中）       │ │  ← 状态指示器
│ │ 上次运行：3天前              │ │
│ │ 下次计划：4天后              │ │
│ │ 运行次数：12次               │ │
│ │ [手动运行] [暂停/恢复]       │ │  ← 操作按钮
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ 技能状态分布                    │
│ ┌─────────────────────────────┐ │
│ │ ● Active   ████████░░  8个  │ │  ← 状态分布条
│ │ ● Stale    ██░░░░░░░░  2个  │ │
│ │ ● Archived ███░░░░░░░  3个  │ │
│ │ 📌 Pinned  █░░░░░░░░░  1个  │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ 技能列表              [筛选▾]   │
│ ┌─────────────────────────────┐ │
│ │ ● react-patterns    ACTIVE  │ │  ← 技能条目
│ │   使用12次 | 最后活动: 1天前 │ │
│ │   [📌钉选] [📦归档]          │ │
│ │                             │ │
│ │ ● typescript-utils  STALE   │ │
│ │   使用3次 | 最后活动: 35天前 │ │
│ │   [📌钉选] [📦归档]          │ │
│ │                             │ │
│ │ ● old-python-scripts ARCHIVED│ │
│ │   使用1次 | 最后活动: 95天前 │ │
│ │   [📌钉选] [🔄恢复]          │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ 最近进化记录                    │
│ ┌─────────────────────────────┐ │
│ │ 3天前: 合并了3个技能为      │ │  ← 进化日志
│ │ "react-patterns"            │ │
│ │ 10天前: 归档了              │ │
│ │ "old-python-scripts"        │ │
│ │ 17天前: 标记了2个技能为     │ │
│ │ stale                       │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

**Curator 状态指示器**：

* **● 绿色**：就绪（空闲中，等待下次触发）

* **● 黄色**：运行中（正在审查技能）

* **● 红色**：暂停/错误

* **● 灰色**：未启用

**技能条目颜色编码**：

* **ACTIVE**：绿色圆点

* **STALE**：黄色圆点

* **ARCHIVED**：灰色圆点

* **PINNED**：蓝色圆点 + 📌 图标

#### 状态指示器：`CuratorIndicator` (`packages/app/src/components/session-header.tsx` 内扩展)

```
[🔵70%] [🧠12] [🔄●]  ← 新增 curator 状态点
```

* **图标**：🔄 循环图标 + 彩色状态点

* **Tooltip**：hover 显示"Curator: 就绪 | 上次运行: 3天前 | 下次: 4天后"

* **点击**：打开侧边面板的进化标签页

### 5.4 数据流设计

```
┌─────────────────────┐     IPC/WebSocket     ┌──────────────────────┐
│   SolidJS UI        │ ◄──────────────────► │   opencode Backend   │
│   (packages/app)    │                       │   (packages/opencode)│
├─────────────────────┤                       ├──────────────────────┤
│ MemoryPanel         │  queryMemoryEntries() │ MemoryService        │
│ EvolutionPanel      │  getCuratorStatus()   │ CuratorService       │
│ MemoryIndicator     │  getMemoryStats()     │ SkillEvolutionService│
│ CuratorIndicator    │  triggerCuratorRun()  │                      │
└─────────────────────┘                       └──────────────────────┘
```

**通信方式**：

* 复用现有的 `@opencode-ai/sdk` 客户端进行数据查询

* 响应式更新通过 SolidJS 的 `createResource` + `@tanstack/solid-query` 实现

* 实时状态通过现有的 WebSocket 或轮询机制更新

### 5.5 组件文件清单

```
packages/app/src/components/memory/
  ├── memory-panel.tsx          # 记忆面板主组件
  ├── memory-entry-card.tsx     # 记忆条目卡片
  ├── memory-search.tsx         # 记忆搜索框
  └── memory-indicator.tsx      # 会话头部记忆指示器

packages/app/src/components/evolution/
  ├── evolution-panel.tsx       # 进化面板主组件
  ├── curator-status.tsx        # Curator 状态卡片
  ├── skill-state-distribution.tsx # 技能状态分布图
  ├── skill-evolution-list.tsx  # 技能进化列表
  └── curator-indicator.tsx     # 会话头部 curator 指示器
```

***

## 六、详细实施步骤

### 阶段一：基础设施层（P0 - 核心记忆）

#### 步骤 1：创建记忆模块目录结构

```
packages/opencode/src/memory/
  ├── index.ts              # 模块导出
  ├── memory.sql.ts         # 数据库表定义
  ├── schema.ts             # 类型和 Schema 定义
  ├── service.ts            # MemoryService 实现
  ├── provider.ts           # MemoryProvider 抽象和默认实现
  └── manager.ts            # MemoryManager 编排器
```

#### 步骤 2：实现数据库表定义

**文件**：`packages/opencode/src/memory/memory.sql.ts`

* 定义 `MemoryEntryTable` 表结构

* 添加索引：`session_id`、`project_id`、`type`、`importance`

* 遵循项目现有 schema 命名约定（snake\_case 字段名）

#### 步骤 3：实现 Schema 定义

**文件**：`packages/opencode/src/memory/schema.ts`

* 定义 `MemoryEntry` 类型（使用 `Schema.Struct`）

* 定义 `MemoryProvider` 接口

* 定义 `MemoryItem` 类型（用于检索结果）

#### 步骤 4：实现 MemoryService

**文件**：`packages/opencode/src/memory/service.ts`

* 遵循 Effect/Layer 依赖注入模式

* 实现 CRUD 操作

* 实现关键词匹配检索（`search` 方法）

  * 初期使用 SQL LIKE 进行关键词匹配

  * 按重要性 + 最近访问时间排序

  * 限制返回数量（默认 Top-5）

* 实现重要性衰减算法

  * `access_count` 递增每次访问

  * `importance` 可用 `access_count` 和 `last_accessed_at` 衰减

```typescript
// 参考检索逻辑
const search = Effect.fn("Memory.search")(function* (input: {
  query: string
  projectID: ProjectID
  limit?: number
}) {
  const db = yield* Database.Service
  const limit = input.limit ?? 5
  const keywords = input.query.split(/\s+/).filter(Boolean)

  // 构建 LIKE 条件
  const conditions = keywords.map(kw => like(MemoryEntryTable.content, `%${kw}%`))

  return yield* db
    .select()
    .from(MemoryEntryTable)
    .where(and(
      eq(MemoryEntryTable.project_id, input.projectID),
      or(...conditions)
    ))
    .orderBy(desc(MemoryEntryTable.importance), desc(MemoryEntryTable.last_accessed_at))
    .limit(limit)
})
```

#### 步骤 5：实现 MemoryProvider 抽象

**文件**：`packages/opencode/src/memory/provider.ts`

* 定义抽象接口，对应 Hermes 的 `MemoryProvider` 关键方法

* 实现默认的 `SQLiteMemoryProvider`，使用 `MemoryService`

#### 步骤 6：实现 MemoryManager

**文件**：`packages/opencode/src/memory/manager.ts`

* 实现 `prefetch` 方法（检索相关记忆，构建上下文块）

* 实现 `sync` 方法（从对话中提取关键信息，写入记忆）

* 实现 `buildMemoryContextBlock` 方法（格式化记忆上下文为 `<memory-context>` 标签）

* 实现生命周期钩子

#### 步骤 7：创建配置模块

**文件**：`packages/opencode/src/config/memory.ts`

```typescript
export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "启用持久记忆功能"
  }),
  prefetch_limit: Schema.optional(Schema.Finite).annotate({
    description: "每轮预取记忆数量上限"
  }),
  auto_extract: Schema.optional(Schema.Boolean).annotate({
    description: "自动从对话中提取关键信息"
  }),
})
```

### 阶段二：集成到现有流程（P0 - 核心记忆）

#### 步骤 8：集成到系统提示词构建

**文件**：`packages/opencode/src/session/prompt.ts`

修改位置：在 `runLoop` 函数的 LLM 调用循环中，注入记忆上下文到当轮用户消息。

核心参考：Hermes Agent 的 `conversation_loop.py:940-958` 模式 — 记忆上下文**不注入到系统提示词数组**，而是**注入到每次 LLM API 调用的用户消息副本中**。

```typescript
// 在 runLoop → while(true) 循环中 (prompt.ts:1651)

// 初始化两个缓存变量（在 while 循环之外或每次循环开始时）
let extPrefetchCache = ""
let memoryManager: MemoryManagerInterface

// 在 yield* handle.process() 之前，注入记忆上下文
const runLoop: (sessionID: SessionID) => Effect.Effect<MessageV2.WithParts> =
  Effect.fn("SessionPrompt.run")(function* (sessionID: SessionID) {
    // ... 已有初始化代码 ...

    while (true) {
      // ... 已有状态设置代码 ...

      // [1] 外部记忆预取 + 预热（仅在 LLM 调用循环的开头执行一次）
      const lastUser = yield* lastUserMessage(sessionID)
      if (step === 0 && lastUser) {
        memoryManager = yield* MemoryManagerService
        extPrefetchCache = yield* memoryManager.prefetch({
          query: lastUser.textContent ?? "",
          sessionID,
          projectID: ctx.projectID,
        })
      }

      // ... 已有消息处理代码 ...

      // [2] 构建系统提示词数组
      const system = [...env, ...instructions, ...(skills ? [skills] : [])]

      // [3] 构建 API 消息 ★★★★★ 注入记忆上下文
      // 参考 Hermes conversation_loop.py:940-958 模式：
      // 记忆上下文注入到当轮用户消息副本，而非系统提示词中
      const apiMessages = modelMsgs.map((msg, idx) => {
        if (idx !== currentTurnUserIdx || msg.role !== "user") return msg
        const injections: string[] = []
        if (extPrefetchCache) {
          const fenced = buildMemoryContextBlock(extPrefetchCache)
          if (fenced) injections.push(fenced)
        }
        if (injections.length === 0) return msg
        const base = typeof msg.content === "string" ? msg.content : ""
        return { ...msg, content: base + "\n\n" + injections.join("\n\n") }
      })

      // [4] 调用 LLM
      const result = yield* handle.process({
        user: lastUser,
        agent,
        permission: session.permission,
        sessionID,
        parentSessionID: session.parentID,
        system,
        messages: apiMessages,  // ← 使用注入后的消息
        tools,
        model,
        toolChoice: format.type === "json_schema" ? "required" : undefined,
      })

      // [5] 处理工具迭代（跟踪 _iters_since_skill）
      if (result === "tool-calls") {
        step++  // 跟踪迭代次数
      }

      // [6] 对话完成 → 同步记忆 + 审查触发器
      if (result === "stop" || finished) {
        yield* memoryManager.sync({
          userContent: lastUser.textContent ?? "",
          assistantContent: handle.message.content ?? "",
          sessionID,
          projectID: ctx.projectID,
        })
        // 触发 curator 审查（如果轮次或迭代次数达到阈值）
        yield* curatorService.maybeTriggerReview({
          sessionID,
          turnCount: step,
          messages: modelMsgs,
        })
        return "break" as const
      }
    }
  })
```

#### 步骤 9：集成到 LLM 调用流程

**文件**：`packages/opencode/src/session/llm.ts`

修改位置：在 LLM 流式调用前后添加记忆钩子。

```typescript
// 在 stream 方法中
// 调用前：prefetch 已在 prompt.ts 中处理
// 调用后：需要 sync_turn

// 在流式响应完成后
yield* memoryManager.sync({
  userContent: input.user.content,
  assistantContent: assistantResponse,
  sessionID: input.sessionID,
  projectID: projectID,
})
```

#### 步骤 10：集成到会话生命周期

**文件**：`packages/opencode/src/session/session.ts`

修改位置：在会话删除或归档时触发 `onSessionEnd`。

```typescript
// 在会话结束/删除时
yield* memoryManager.onSessionEnd({
  messages: fullMessages,
  sessionID: sessionID,
  projectID: projectID,
})
```

#### 步骤 11：集成到上下文压缩

**文件**：`packages/opencode/src/session/compaction.ts`

修改位置：在压缩执行前触发 `onPreCompress`，将记忆提取结果注入到压缩提示词中。

```typescript
// 在 processCompaction 方法中
const memoryExtract = yield* memoryManager.onPreCompress({
  messages: selected.head,
  sessionID: input.sessionID,
})
if (memoryExtract) {
  compacting.context.push(memoryExtract)
}
```

### 阶段三：自我进化系统（P1）

#### 步骤 12：创建进化模块目录结构

```
packages/opencode/src/evolution/
  ├── index.ts              # 模块导出
  ├── evolution.sql.ts      # 数据库表定义
  ├── schema.ts             # 类型和 Schema 定义
  ├── skill-evolution.ts    # SkillEvolutionService
  └── curator.ts            # CuratorService
```

#### 步骤 13：实现数据库表定义

**文件**：`packages/opencode/src/evolution/evolution.sql.ts`

* 定义 `SkillEvolutionTable`

* 定义 `CuratorStateTable`

#### 步骤 14：实现 SkillEvolutionService

**文件**：`packages/opencode/src/evolution/skill-evolution.ts`

* 扩展 Skill 系统，添加状态跟踪

* `trackUsage(skillName)`：记录技能使用

* `setState(name, state)`：更新技能状态

* `getAgentCreatedSkills()`：获取 agent 创建的技能列表

* `getEvolutionReport()`：生成进化报告

#### 步骤 15：实现 CuratorService

**文件**：`packages/opencode/src/evolution/curator.ts`

* `shouldRun()`：检查触发条件（间隔时间 + agent 空闲状态）

* `applyAutoTransitions()`：自动状态转换（active → stale → archived）

```typescript
const applyAutoTransitions = Effect.fn("Curator.applyAutoTransitions")(function* () {
  const now = Date.now()
  const staleCutoff = now - 30 * 24 * 60 * 60 * 1000  // 30天
  const archiveCutoff = now - 90 * 24 * 60 * 60 * 1000 // 90天

  const skills = yield* skillEvolution.all()
  let counts = { markedStale: 0, archived: 0, reactivated: 0, checked: 0 }

  for (const skill of skills) {
    counts.checked++
    if (skill.pinned) continue

    const anchor = skill.last_activity_at ?? skill.time_created
    if (anchor <= archiveCutoff && skill.state !== "archived") {
      yield* skillEvolution.setState(skill.skill_name, "archived")
      counts.archived++
    } else if (anchor <= staleCutoff && skill.state === "active") {
      yield* skillEvolution.setState(skill.skill_name, "stale")
      counts.markedStale++
    } else if (anchor > staleCutoff && skill.state === "stale") {
      yield* skillEvolution.setState(skill.skill_name, "active")
      counts.reactivated++
    }
  }

  return counts
})
```

* `runReview()`：启动 LLM 驱动的技能审查

```typescript
const runReview = Effect.fn("Curator.runReview")(function* (input: { dryRun?: boolean }) {
  // 1. 获取 agent 创建的技能列表
  const skills = yield* skillEvolution.getAgentCreatedSkills()

  // 2. 构建审查提示词（参考 Hermes 的 CURATOR_REVIEW_PROMPT）
  const reviewPrompt = buildReviewPrompt(skills)

  // 3. 使用辅助模型运行审查
  const agent = yield* Agent.Service.get("curator") // 或使用 compaction agent
  const model = yield* Provider.Service.getModel(...)

  // 4. 处理审查结果，应用合并/归档策略
  // ...
})
```

#### 步骤 16：集成到 Skill 系统

**文件**：`packages/opencode/src/skill/index.ts`

修改位置：在技能加载时注册进化状态，在技能使用时记录活动。

```typescript
// 在技能加载流程中添加
yield* skillEvolution.ensureTracked(skill.name, skill.location)

// 在 SkillTool 执行时
yield* skillEvolution.trackUsage(params.name)
```

#### 步骤 17：创建配置模块

**文件**：`packages/opencode/src/config/evolution.ts`

```typescript
export const Info = Schema.Struct({
  curator: Schema.optional(Schema.Struct({
    enabled: Schema.Boolean,
    interval_hours: Schema.Finite,     // 默认 168 (7天)
    min_idle_hours: Schema.Finite,     // 默认 2
    stale_after_days: Schema.Finite,   // 默认 30
    archive_after_days: Schema.Finite, // 默认 90
  })),
})
```

### 阶段四：桌面端 UI 面板（P0 - 与核心记忆同步）

#### 步骤 18：实现记忆面板组件

**文件**：`packages/app/src/components/memory/memory-panel.tsx`

* 使用 SolidJS 和 `@opencode-ai/ui` 组件库

* 实现记忆条目列表、搜索框、类型筛选

* 实现记忆条目卡片（内容摘要、类型标签、重要度星级、操作按钮）

* 通过 `@tanstack/solid-query` 从后端获取数据

**文件**：`packages/app/src/components/memory/memory-entry-card.tsx`

* 记忆条目卡片组件

* 支持展开/折叠、内联编辑、删除确认

**文件**：`packages/app/src/components/memory/memory-search.tsx`

* 搜索输入框组件

* 实时过滤（防抖 300ms）

#### 步骤 19：实现进化面板组件

**文件**：`packages/app/src/components/evolution/evolution-panel.tsx`

* Curator 状态卡片（状态指示器、运行信息、操作按钮）

* 技能状态分布条（active/stale/archived/pinned 数量可视化）

* 技能进化列表（按状态分组的技能条目）

* 最近进化记录时间线

**文件**：`packages/app/src/components/evolution/curator-status.tsx`

* Curator 状态卡片组件

* 状态指示器（绿/黄/红/灰）

* 手动触发、暂停/恢复按钮

**文件**：`packages/app/src/components/evolution/skill-state-distribution.tsx`

* 技能状态分布可视化组件

* 彩色进度条显示各状态占比

**文件**：`packages/app/src/components/evolution/skill-evolution-list.tsx`

* 技能进化列表组件

* 支持钉选、归档、恢复操作

#### 步骤 20：实现会话头部状态指示器

**文件**：`packages/app/src/components/memory/memory-indicator.tsx`

* 在 SessionHeader 中显示记忆条数指示器

* 参考 `session-context-usage.tsx` 的实现模式

* 点击跳转到记忆面板

**文件**：`packages/app/src/components/evolution/curator-indicator.tsx`

* 在 SessionHeader 中显示 Curator 状态点

* 彩色圆点指示状态（绿/黄/红/灰）

* 点击跳转到进化面板

#### 步骤 21：集成到 SessionSidePanel

**文件**：`packages/app/src/pages/session/session-side-panel.tsx`

* 在 Tabs 组件中添加"记忆与进化"标签页

* 标签页内包含 MemoryPanel 和 EvolutionPanel（上下排列或左右分栏）

* 遵循现有标签页的实现模式（参考 `SessionContextTab`）

**文件**：`packages/app/src/components/session-header.tsx`

* 在头部状态区域添加 MemoryIndicator 和 CuratorIndicator

* 与现有的 SessionContextUsage 并列放置

### 阶段五：CLI 命令与工具（P2）

#### 步骤 22：添加记忆管理 CLI 命令

**文件**：`packages/opencode/src/cli/cmd/memory.ts`

```
novaway memory list    # 列出记忆条目
novaway memory add     # 手动添加记忆
novaway memory search  # 搜索记忆
novaway memory delete  # 删除记忆
```

#### 步骤 23：添加 Curator CLI 命令

**文件**：`packages/opencode/src/cli/cmd/curator.ts`

```
novaway curator run      # 手动触发 curator
novaway curator status   # 查看 curator 状态
novaway curator pause    # 暂停 curator
novaway curator resume   # 恢复 curator
```

***

## 七、关键技术决策

### 7.1 差异分析与适配

| 特性         | Hermes Agent 做法                   | NovaWay 适配方案                           |
| ---------- | --------------------------------- | -------------------------------------- |
| 记忆存储       | 文件系统(JSON/Markdown) + 外部 provider | Drizzle ORM + SQLite（统一数据层）            |
| 记忆检索       | 外部 provider 接管                    | 内置关键词匹配（阶段一），后续可扩展向量搜索                 |
| 技能系统       | 独立文件目录 + SKILL.md                 | 扩展现有 Skill 系统（`skill/index.ts`），添加状态字段 |
| Curator 触发 | 基于 `should_run_now()` + 空闲检测      | 利用 Effect 的定时器 + Agent 状态检测            |
| 上下文压缩      | 独立 ContextCompressor 类            | 扩展现有 SessionCompaction，添加钩子            |
| Agent 循环   | 同步 while 循环                       | 流式 Stream 处理                           |
| 依赖注入       | 无                                 | Effect/Layer 模式                        |

### 7.2 记忆检索策略

* **阶段一**：基于 SQLite LIKE 的关键词匹配（简单高效）

* **阶段二（可选）**：引入嵌入向量搜索（如 sqlite-vss 或外部向量数据库）

* **Top-K 限制**：默认 5 条，可配置，避免 token 消耗过大

### 7.3 记忆提取策略

从对话中自动提取关键信息用于持久记忆：

1. **显式记忆命令**：用户通过工具调用显式添加记忆
2. **自动提取**：每轮对话后，使用小型模型提取关键决策和偏好
3. **重要性评分**：基于提及频率和用户显式标记

### 7.4 安全保障

* 记忆内容在注入前进行清理（参考 Hermes 的 `sanitize_context`）

* 流式输出中过滤 `<memory-context>` 标签

* 记忆上下文明确标注为"参考数据，非用户输入"

### 7.5 UI 技术选型

* **UI 框架**：SolidJS（与现有桌面端 UI 一致）

* **组件库**：`@opencode-ai/ui`（项目自有组件库）

* **数据获取**：`@tanstack/solid-query`（与现有模式一致）

* **状态管理**：SolidJS reactive store + context

* **样式**：遵循现有的 Tailwind CSS / CSS-in-JS 模式

* **通信**：复用 `@opencode-ai/sdk` 客户端

***

## 八、风险与缓解措施

| 风险              | 影响            | 缓解措施                                  |
| --------------- | ------------- | ------------------------------------- |
| Token 消耗增加      | 每轮 LLM 调用成本上升 | Top-K 限制（默认 5 条），按重要性排序               |
| 数据库性能           | 大量记忆条目查询变慢    | 建立适当索引，定期清理低重要性记忆                     |
| 记忆污染            | 错误或过时信息影响决策   | 重要性衰减算法，时间衰减                          |
| Curator 无限循环    | 无效压缩反复重试      | Anti-thrashing 保护，最大重试次数限制            |
| 与 Compaction 冲突 | 记忆上下文被压缩丢失    | 在 compaction 前触发 on\_pre\_compress 提取 |
| 自动提取不准确         | 提取无关信息        | 使用专门的小型模型，用户可手动修正                     |
| UI 性能           | 面板数据量大导致卡顿    | 分页加载、虚拟滚动、按需查询                        |

***

## 九、验证策略

### 9.1 单元测试

* `MemoryService`：CRUD 操作的准确性

* `MemoryService.search`：检索准确率（关键词匹配）

* `CuratorService.applyAutoTransitions`：状态转换逻辑正确性

* `SkillEvolutionService`：使用统计和状态管理

### 9.2 集成测试

* `MemoryManager` 与 `MemoryService` 的交互

* `MemoryManager.prefetch` 在 LLM 调用前返回正确上下文

* `MemoryManager.sync` 正确提取和持久化对话信息

* Curator 审查流程的端到端测试

* UI 面板与后端 API 的数据交互

### 9.3 E2E 测试

* 完整对话流程：用户输入 → 记忆检索 → LLM 响应 → 记忆持久化

* 跨会话记忆：一个会话中存储的记忆在另一个会话中可检索

* 技能进化：长时间运行后技能自动状态转换和合并

* UI 面板：记忆面板正确显示记忆列表，进化面板正确显示 curator 状态

### 9.4 UI 组件测试

* `MemoryPanel`：搜索过滤、类型筛选、CRUD 操作

* `EvolutionPanel`：状态显示、手动触发、暂停/恢复

* `MemoryIndicator`：状态颜色变化、tooltip 内容、点击跳转

* `CuratorIndicator`：状态点颜色、tooltip 内容、点击跳转

***

## 十、实施优先级

### P0：核心记忆 + UI 面板（预计工作量大）

* 步骤 1-7：后端基础设施（数据库表、MemoryService、MemoryManager）

* 步骤 8-11：集成到现有流程（prompt、llm、session、compaction）

* 步骤 18-21：桌面端 UI 面板（记忆面板、状态指示器、侧边面板集成）

### P1：自我进化 + UI 面板（预计工作量中）

* 步骤 12-17：SkillEvolutionService、CuratorService、集成到 Skill 系统

* 步骤 19 中的进化面板组件

### P2：配置与工具（预计工作量小）

* 步骤 22-23：CLI 命令和配置

***

## 十一、文件变更清单

### 新增文件

**后端（packages/opencode/src/）**：

```
memory/
  ├── index.ts
  ├── memory.sql.ts
  ├── schema.ts
  ├── service.ts
  ├── provider.ts
  └── manager.ts

evolution/
  ├── index.ts
  ├── evolution.sql.ts
  ├── schema.ts
  ├── skill-evolution.ts
  └── curator.ts

config/
  ├── memory.ts
  └── evolution.ts

cli/cmd/
  ├── memory.ts
  └── curator.ts
```

**前端（packages/app/src/components/）**：

```
memory/
  ├── memory-panel.tsx
  ├── memory-entry-card.tsx
  ├── memory-search.tsx
  └── memory-indicator.tsx

evolution/
  ├── evolution-panel.tsx
  ├── curator-status.tsx
  ├── skill-state-distribution.tsx
  ├── skill-evolution-list.tsx
  └── curator-indicator.tsx
```

### 修改文件

**后端**：

```
packages/opencode/src/session/prompt.ts        # 注入记忆上下文
packages/opencode/src/session/llm.ts           # prefetch/sync 钩子
packages/opencode/src/session/session.ts       # 生命周期钩子
packages/opencode/src/session/compaction.ts    # on_pre_compress 钩子
packages/opencode/src/skill/index.ts           # 技能进化集成
packages/opencode/src/tool/registry.ts         # 注册记忆工具
packages/opencode/src/config/config.ts         # 导出新配置模块
```

**前端**：

```
packages/app/src/pages/session/session-side-panel.tsx  # 新增记忆与进化标签页
packages/app/src/components/session-header.tsx          # 添加状态指示器
```

