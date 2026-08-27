import type { TuiPluginApi } from "@opencode/plugin/tui"
import { createMemo, For, type Accessor } from "solid-js"
import { DEFAULT_THEMES, useTheme } from "../../context/theme"
import { useCommandShortcut } from "../../keymap"

const themeCount = Object.keys(DEFAULT_THEMES).length

type TipPart = { text: string; highlight: boolean }
type TipShortcut = Accessor<string>
type Shortcuts = {
  agentCycle: TipShortcut
  childFirst: TipShortcut
  childNext: TipShortcut
  childPrevious: TipShortcut
  commandList: TipShortcut
  editorOpen: TipShortcut
  helpShow: TipShortcut
  inputClear: TipShortcut
  inputNewline: TipShortcut
  inputPaste: TipShortcut
  inputUndo: TipShortcut
  leader: TipShortcut
  messagesCopy: TipShortcut
  messagesFirst: TipShortcut
  messagesLast: TipShortcut
  messagesPageDown: TipShortcut
  messagesPageUp: TipShortcut
  messagesToggleConceal: TipShortcut
  modelCycleRecent: TipShortcut
  modelList: TipShortcut
  sessionExport: TipShortcut
  sessionInterrupt: TipShortcut
  sessionList: TipShortcut
  sessionNew: TipShortcut
  sessionParent: TipShortcut
  sessionPinToggle: TipShortcut
  sessionQuickSwitch1: TipShortcut
  sessionQuickSwitch9: TipShortcut
  sessionSidebarToggle: TipShortcut
  sessionTimeline: TipShortcut
  statusView: TipShortcut
  terminalSuspend: TipShortcut
  themeList: TipShortcut
}
type Tip = string | ((shortcuts: Shortcuts) => string | undefined)

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

const NO_MODELS_TIP = "运行 {highlight}/connect{/highlight} 添加 AI 提供商并开始编码"
const NO_MODELS_PARTS = parse(NO_MODELS_TIP)

function shortcutText(value: string) {
  return `{highlight}${value}{/highlight}`
}

function commandText(command: string, shortcut: string) {
  if (!shortcut) return shortcutText(command)
  return `${shortcutText(command)} 或 ${shortcutText(shortcut)}`
}

function press(shortcut: string, text: string) {
  if (!shortcut) return undefined
  return `按 ${shortcutText(shortcut)} ${text}`
}

function configShortcut(api: TuiPluginApi, command: string): TipShortcut {
  return () =>
    api.tuiConfig.keybinds
      .get(command)
      .map((binding) => api.keys.formatSequence(Array.from(api.keymap.parseKeySequence(binding.key))))
      .filter(Boolean)
      .join(", ")
}

export function Tips(props: { api: TuiPluginApi; connected?: boolean }) {
  const theme = useTheme().theme
  const tipOffset = Math.random()
  const shortcuts: Shortcuts = {
    agentCycle: useCommandShortcut("agent.cycle"),
    childFirst: configShortcut(props.api, "session.child.first"),
    childNext: configShortcut(props.api, "session.child.next"),
    childPrevious: configShortcut(props.api, "session.child.previous"),
    commandList: useCommandShortcut("command.palette.show"),
    editorOpen: useCommandShortcut("prompt.editor"),
    helpShow: useCommandShortcut("help.show"),
    inputClear: useCommandShortcut("prompt.clear"),
    inputNewline: useCommandShortcut("input.newline"),
    inputPaste: useCommandShortcut("prompt.paste"),
    inputUndo: useCommandShortcut("input.undo"),
    leader: configShortcut(props.api, "leader"),
    messagesCopy: configShortcut(props.api, "messages.copy"),
    messagesFirst: configShortcut(props.api, "session.first"),
    messagesLast: configShortcut(props.api, "session.last"),
    messagesPageDown: configShortcut(props.api, "session.page.down"),
    messagesPageUp: configShortcut(props.api, "session.page.up"),
    messagesToggleConceal: configShortcut(props.api, "session.toggle.conceal"),
    modelCycleRecent: useCommandShortcut("model.cycle_recent"),
    modelList: useCommandShortcut("model.list"),
    sessionExport: configShortcut(props.api, "session.export"),
    sessionInterrupt: configShortcut(props.api, "session.interrupt"),
    sessionList: useCommandShortcut("session.list"),
    sessionNew: useCommandShortcut("session.new"),
    sessionParent: configShortcut(props.api, "session.parent"),
    sessionPinToggle: configShortcut(props.api, "session.pin.toggle"),
    sessionQuickSwitch1: useCommandShortcut("session.quick_switch.1"),
    sessionQuickSwitch9: useCommandShortcut("session.quick_switch.9"),
    sessionSidebarToggle: configShortcut(props.api, "session.sidebar.toggle"),
    sessionTimeline: configShortcut(props.api, "session.timeline"),
    statusView: useCommandShortcut("NovaWay.status"),
    terminalSuspend: useCommandShortcut("terminal.suspend"),
    themeList: useCommandShortcut("theme.switch"),
  }
  const tip = createMemo(() => {
    if (props.connected === false) return NO_MODELS_TIP
    const tips = [...TIPS, process.platform !== "win32" ? TERMINAL_SUSPEND_TIP : INPUT_UNDO_TIP].flatMap((item) => {
      const value = typeof item === "string" ? item : item(shortcuts)
      return value ? [value] : []
    })
    return tips[Math.floor(tipOffset * tips.length)] ?? NO_MODELS_TIP
  }, NO_MODELS_TIP)
  // Solid can expose a memo's initial value while a pure computation is pending.
  const parts = createMemo(() => {
    const value = tip()
    if (typeof value === "string") return parse(value)
    return NO_MODELS_PARTS
  }, NO_MODELS_PARTS)

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ● 提示{" "}
      </text>
      <text flexShrink={1} wrapMode="word">
        <For each={parts()}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}

const TIPS: Tip[] = [
  "输入 {highlight}@{/highlight} 后跟文件名以模糊搜索和附加文件",
  "以 {highlight}!{/highlight} 开始消息以运行 shell 命令（例如 {highlight}!ls -la{/highlight}）",
  (shortcuts) => press(shortcuts.agentCycle(), "在构建和计划代理之间切换"),
  "使用 {highlight}/undo{/highlight} 撤销上一条消息和文件变更",
  "使用 {highlight}/redo{/highlight} 恢复之前撤销的消息和文件变更",
  "运行 {highlight}/share{/highlight} 创建公共 NovaWay.ai 链接",
  "将图片或 PDF 拖放到终端中作为上下文",
  (shortcuts) => press(shortcuts.inputPaste(), "从剪贴板粘贴图片到提示中"),
  (shortcuts) => `使用 ${commandText("/editor", shortcuts.editorOpen())} 在外部编辑器中编写消息`,
  "运行 {highlight}/init{/highlight} 根据代码库自动生成项目规则",
  (shortcuts) => `使用 ${commandText("/models", shortcuts.modelList())} 在可用的 AI 模型之间切换`,
  (shortcuts) => `使用 ${commandText("/themes", shortcuts.themeList())} 在 ${themeCount} 个内置主题之间切换`,
  (shortcuts) => `使用 ${commandText("/new", shortcuts.sessionNew())} 开始新的对话会话`,
  (shortcuts) => `使用 ${commandText("/sessions", shortcuts.sessionList())} 列出、置顶和继续会话`,
  (shortcuts) => press(shortcuts.sessionPinToggle(), "在会话列表中置顶"),
  (shortcuts) =>
    shortcuts.sessionQuickSwitch1() && shortcuts.sessionQuickSwitch9()
      ? `使用 ${shortcutText(shortcuts.sessionQuickSwitch1())} 到 ${shortcutText(shortcuts.sessionQuickSwitch9())} 切换置顶会话`
      : undefined,
  "运行 {highlight}/compact{/highlight} 在接近上下文限制时总结长会话",
  (shortcuts) => `使用 ${commandText("/export", shortcuts.sessionExport())} 将对话保存为 Markdown`,
  (shortcuts) => press(shortcuts.messagesCopy(), "复制助手的最后一条消息到剪贴板"),
  (shortcuts) => press(shortcuts.commandList(), "查看所有可用的操作和命令"),
  "运行 {highlight}/connect{/highlight} 为 75+ 支持的 LLM 提供商添加 API 密钥",
  (shortcuts) => `领导者键是 ${shortcutText(shortcuts.leader())}；与其他键组合以快速操作`,
  (shortcuts) => press(shortcuts.modelCycleRecent(), "在最近使用的模型之间快速切换"),
  (shortcuts) => press(shortcuts.sessionSidebarToggle(), "在会话中显示或隐藏侧边栏面板"),
  (shortcuts) =>
    shortcuts.messagesPageUp() && shortcuts.messagesPageDown()
      ? `使用 ${shortcutText(shortcuts.messagesPageUp())}/${shortcutText(shortcuts.messagesPageDown())} 浏览对话历史`
      : undefined,
  (shortcuts) => press(shortcuts.messagesFirst(), "跳转到对话开头"),
  (shortcuts) => press(shortcuts.messagesLast(), "跳转到最新消息"),
  (shortcuts) => press(shortcuts.inputNewline(), "在提示中添加换行"),
  (shortcuts) => press(shortcuts.inputClear(), "输入时清除输入字段"),
  (shortcuts) => press(shortcuts.sessionInterrupt(), "在 AI 响应中停止"),
  "切换到 {highlight}Plan{/highlight} 代理以获取建议而不做更改",
  "在提示中使用 {highlight}@agent-name{/highlight} 调用专用子代理",
  (shortcuts) => {
    const items = [
      shortcuts.sessionParent(),
      shortcuts.childFirst(),
      shortcuts.childPrevious(),
      shortcuts.childNext(),
    ].filter(Boolean)
    if (!items.length) return undefined
    return `使用 ${items.map(shortcutText).join(" / ")} 用于父/子会话`
  },
  "创建 {highlight}NovaWay.json{/highlight} 用于服务器设置，{highlight}tui.json{/highlight} 用于 TUI",
  "将 TUI 设置放在 {highlight}~/.config/NovaWay/tui.json{/highlight} 中作为全局配置",
  "在配置中添加 {highlight}$schema{/highlight} 以在编辑器中获得自动完成",
  "在配置中设置 {highlight}model{/highlight} 以设置默认模型",
  "通过 {highlight}keybinds{/highlight} 部分覆盖 {highlight}tui.json{/highlight} 中的任何快捷键",
  "将任何快捷键设置为 {highlight}none{/highlight} 以完全禁用",
  "在 {highlight}mcp{/highlight} 配置部分配置本地或远程 MCP 服务器",
  "将 {highlight}.md{/highlight} 文件添加到 {highlight}.NovaWay/commands/{/highlight} 以创建可复用的提示",
  "在自定义命令中使用 {highlight}$ARGUMENTS{/highlight}、{highlight}$1{/highlight}、{highlight}$2{/highlight} 进行动态输入",
  "使用反引号注入 shell 输出（例如 {highlight}`git status`{/highlight}）",
  "将 {highlight}.md{/highlight} 文件添加到 {highlight}.NovaWay/agents/{/highlight} 以创建专用 AI 角色",
  "为 {highlight}edit{/highlight}、{highlight}bash{/highlight} 和 {highlight}webfetch{/highlight} 工具配置每个代理的权限",
  '使用类似 {highlight}"git *": "allow"{/highlight} 的模式进行细粒度 bash 权限控制',
  '设置 {highlight}"rm -rf *": "deny"{/highlight} 以阻止破坏性命令',
  '配置 {highlight}"git push": "ask"{/highlight} 以在推送前要求批准',
  '设置 {highlight}"formatter": true{/highlight} 以启用内置格式化器',
  '设置 {highlight}"formatter": false{/highlight} 以禁用继承的格式化器',
  "在配置中定义带有文件扩展名的自定义格式化器命令",
  '设置 {highlight}"lsp": true{/highlight} 以启用内置 LSP 代码分析',
  "在 {highlight}.NovaWay/tools/{/highlight} 中创建 {highlight}.ts{/highlight} 文件以定义新的 LLM 工具",
  "工具定义可以调用用 Python、Go 等编写的脚本",
  "将 {highlight}.ts{/highlight} 文件添加到 {highlight}.NovaWay/plugins/{/highlight} 以创建事件钩子",
  "使用插件在会话完成时发送操作系统通知",
  "创建插件以阻止 NovaWay 读取敏感文件",
  "使用 {highlight}NovaWay run{/highlight} 进行非交互式脚本编写",
  "使用 {highlight}NovaWay --continue{/highlight} 恢复上一个会话",
  "使用 {highlight}NovaWay run -f file.ts{/highlight} 通过 CLI 附加文件",
  "使用 {highlight}--format json{/highlight} 在脚本中获取机器可读的输出",
  "运行 {highlight}NovaWay serve{/highlight} 获取 NovaWay 的无头 API 访问",
  "使用 {highlight}NovaWay run --attach{/highlight} 连接到正在运行的服务器",
  "运行 {highlight}NovaWay upgrade{/highlight} 更新到最新版本",
  "运行 {highlight}NovaWay auth list{/highlight} 查看所有已配置的提供商",
  "运行 {highlight}NovaWay agent create{/highlight} 进行引导式代理创建",
  "在 GitHub issues/PRs 中使用 {highlight}/NovaWay{/highlight} 触发 AI 操作",
  "运行 {highlight}NovaWay github install{/highlight} 设置 GitHub 工作流",
  "在 issues 上评论 {highlight}/NovaWay fix this{/highlight} 以自动创建 PRs",
  "在 PR 代码行上评论 {highlight}/oc{/highlight} 进行有针对性的代码审查",
  '使用 {highlight}"theme": "system"{/highlight} 匹配终端的颜色',
  "在 {highlight}.NovaWay/themes/{/highlight} 目录中创建 JSON 主题文件",
  "主题支持两种模式的深色/浅色变体",
  "在自定义主题 JSON 中使用数字 xterm 颜色代码 0-255",
  "在配置中使用 {highlight}{env:VAR_NAME}{/highlight} 引用环境变量",
  "使用 {highlight}{file:path}{/highlight} 在配置值中包含文件内容",
  "在配置中使用 {highlight}instructions{/highlight} 加载额外的规则文件",
  "设置代理 {highlight}temperature{/highlight} 从 0.0（专注）到 1.0（创意）",
  "配置 {highlight}steps{/highlight} 以限制每个请求的代理迭代次数",
  '设置 {highlight}"tools": {"bash": false}{/highlight} 以禁用特定工具',
  '设置 {highlight}"mcp_*": false{/highlight} 以禁用 MCP 服务器的所有工具',
  "按代理配置覆盖全局工具设置",
  '设置 {highlight}"share": "auto"{/highlight} 以自动共享所有会话',
  '设置 {highlight}"share": "disabled"{/highlight} 以阻止任何会话共享',
  "运行 {highlight}/unshare{/highlight} 从公共访问中移除会话",
  "权限 {highlight}doom_loop{/highlight} 防止无限工具调用循环",
  "权限 {highlight}external_directory{/highlight} 保护项目外的文件",
  "运行 {highlight}NovaWay debug config{/highlight} 排查配置问题",
  "使用 {highlight}--print-logs{/highlight} 标志在 stderr 中查看详细日志",
  (shortcuts) => `使用 ${commandText("/timeline", shortcuts.sessionTimeline())} 跳转到特定消息`,
  (shortcuts) => press(shortcuts.messagesToggleConceal(), "切换消息中代码块的可见性"),
  (shortcuts) => `使用 ${commandText("/status", shortcuts.statusView())} 查看系统状态信息`,
  "在 {highlight}tui.json{/highlight} 中启用 {highlight}scroll_acceleration{/highlight} 以实现平滑滚动",
  (shortcuts) =>
    shortcuts.commandList()
      ? `通过命令面板 (${shortcutText(shortcuts.commandList())}) 切换聊天中用户名的显示`
      : "通过命令面板切换聊天中用户名的显示",
  "运行 {highlight}docker run -it --rm ghcr.io/anomalyco/NovaWay{/highlight} 在容器中运行",
  "使用 {highlight}/connect{/highlight} 配合 NovaWay Zen 获取精选的、经过测试的模型",
  "将项目的 {highlight}AGENTS.md{/highlight} 文件提交到 Git 以进行团队共享",
  "使用 {highlight}/review{/highlight} 审查未提交的更改、分支或 PRs",
  (shortcuts) => `使用 ${commandText("/help", shortcuts.helpShow())} 显示帮助对话框`,
  "使用 {highlight}/rename{/highlight} 重命名当前会话",
]

const INPUT_UNDO_TIP: Tip = (shortcuts) => press(shortcuts.inputUndo(), "撤销提示中的更改")
const TERMINAL_SUSPEND_TIP: Tip = (shortcuts) =>
  press(shortcuts.terminalSuspend(), "挂起终端并返回 shell")
