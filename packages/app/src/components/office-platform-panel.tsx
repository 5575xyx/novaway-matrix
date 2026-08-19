import { createResource, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { writeClipboard } from "@opencode-ai/ui/util/clipboard"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { FeishuAppSetupGuide } from "./feishu-app-setup-guide"

type PanelWorkflow = {
  id: string
  title: string
  scene: string
  prompt: string
  connectors: string[]
  browser: {
    enabled: boolean
    url?: string
  }
  notificationUrl?: string
}

function officePromptInputKeys(prompt: string) {
  return Array.from(new Set(Array.from(prompt.matchAll(/\{([a-zA-Z0-9_]+)\}/g), (match) => match[1])))
}

function officeInputLabel(name: string) {
  const labels: Record<string, string> = {
    source_path: "数据文件路径",
    output_dir: "输出目录",
    target_urls: "竞品网址",
    source_dir: "待处理目录",
    notification_url: "通知地址",
    report_title: "报告标题",
    report_name: "报告名称",
    input: "输入内容",
    url: "网址",
  }
  if (labels[name]) return labels[name]
  return name.replace(/_/g, " ")
}

function officeScheduleTriggerLabel(trigger: {
  type: string
  minutes?: number
  time?: string
  dayOfWeek?: number
  dayOfMonth?: number
  everyDays?: number
}) {
  if (trigger.type === "daily") return `每天 ${trigger.time}`
  if (trigger.type === "weekly") {
    const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    return `每周${days[(trigger.dayOfWeek ?? 1) - 1] ?? "周一"} ${trigger.time}`
  }
  if (trigger.type === "monthly") return `每月 ${trigger.dayOfMonth} 号 ${trigger.time}`
  if (trigger.type === "days") return `每隔 ${trigger.everyDays} 天 ${trigger.time}`
  return `每 ${trigger.minutes ?? 60} 分钟`
}

function officeConnectorHelp(id: string) {
  if (id === "feishu") {
    return "手机端暂不支持创建自定义机器人，请用飞书电脑端或 Web 端操作：群右上角「...」进入群设置，找到“群机器人/机器人”，添加“自定义机器人”。关键词可自定义，默认 NovaWay，需要和机器人安全设置里填的完全一致；不要选“加签”。"
  }
  if (id === "feishu-app") {
    return "打开飞书开放平台，创建「企业自建应用」。创建后进入「凭证与基础信息」，复制 App ID 和 App Secret。随后在「添加应用能力」中添加机器人，申请 im:message.p2p_msg:readonly、im:message:send_as_bot 权限，并在事件订阅中订阅 im.message.receive_v1，事件订阅方式选择长连接。"
  }
  if (id === "tencent-docs") {
    return "OpenClaw 页面把同一个腾讯文档官方 MCP 封装成了 Skill；NovaWay 已内置该官方 MCP，无需安装 OpenClaw。请访问 https://docs.qq.com/open/auth/mcp.html 获取 MCP Token 后填写。"
  }
  return "该连接器已内置，配置后即可在办公工作流中使用。"
}

function officeConnectorLink(id: string) {
  if (id === "feishu-app") return "https://open.feishu.cn/app"
  if (id === "tencent-docs") return "https://docs.qq.com/open/auth/mcp.html"
  return ""
}

function ConnectorHelpTip(props: { id: string }) {
  const platform = usePlatform()
  const [open, setOpen] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const link = () => officeConnectorLink(props.id)

  function copyLink() {
    const value = link()
    if (!value) return
    const copy = async () => {
      if (platform.writeTextToClipboard) {
        try {
          const copied = await platform.writeTextToClipboard(value)
          if (copied) return true
        } catch {
          // 继续使用页面级复制兜底
        }
      }
      if (await writeClipboard(value)) return true
      return false
    }
    void copy().then((copied) => {
      if (!copied) {
        showToast({ title: "复制失败", description: "请手动复制链接。" })
        return
      }
      setCopied(true)
      showToast({ title: "链接已复制", description: value })
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <span class="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span
        tabIndex={0}
        role="button"
        aria-label="配置帮助"
        class="shrink-0 cursor-help text-text-muted outline-none transition-colors hover:text-emerald-200 focus-visible:text-emerald-200"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Icon name="help" size="small" />
      </span>
      <Show when={open()}>
        <span aria-hidden="true" class="absolute left-0 top-full h-2 w-72" />
        <span class="absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-[8px] border border-border-strong-base bg-surface-raised-stronger-non-alpha p-3 text-left shadow-[0_18px_44px_rgba(0,0,0,0.20)]">
          <span class="block text-11-regular leading-relaxed text-text-weak">{officeConnectorHelp(props.id)}</span>
          <Show when={link()}>
            <span class="mt-2 flex items-center gap-2 rounded-[7px] border border-border-weak-base bg-background-base p-2">
              <code class="min-w-0 flex-1 truncate text-11-regular text-text-strong">{link()}</code>
              <button
                type="button"
                class="h-7 shrink-0 rounded-[6px] border border-emerald-300/40 bg-emerald-300/10 px-2 text-10-medium text-emerald-100 transition-all duration-150 hover:-translate-y-px hover:bg-emerald-300/20 hover:shadow-[0_6px_14px_rgba(16,185,129,0.16)] active:translate-y-0 active:scale-95"
                onClick={() => copyLink()}
              >
                <span class="flex items-center gap-1">
                  {copied() ? <Icon name="circle-check" size="small" /> : null}
                  {copied() ? "已复制" : "复制"}
                </span>
              </button>
            </span>
          </Show>
          <Show when={copied()}>
            <span
              class="mt-2 flex items-center gap-1.5 rounded-[7px] border border-emerald-300/40 bg-emerald-300/10 px-2 py-1.5 text-11-medium text-emerald-100"
              aria-live="polite"
            >
              <Icon name="circle-check" size="small" />
              已复制到剪贴板
            </span>
          </Show>
        </span>
      </Show>
    </span>
  )
}

export function OfficePlatformPanel() {
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const dialog = useDialog()
  const [status, { refetch: refetchStatus }] = createResource(() =>
    globalSDK.client.office.platform.status().then((result) => result.data),
  )
  const [schedules, { refetch: refetchSchedules }] = createResource(() =>
    globalSDK.client.office.platform.schedule.list().then((result) => result.data ?? []),
  )
  const [runs, { refetch: refetchRuns }] = createResource(() =>
    globalSDK.client.office.platform.run.list().then((result) => result.data ?? []),
  )
  const [workflows, { refetch: refetchWorkflows }] = createResource(() =>
    globalSDK.client.office.platform.workflow.list().then((result) => result.data ?? []),
  )
  const [connectors, { refetch: refetchConnectors }] = createResource(() =>
    globalSDK.client.office.platform.connector.list().then((result) => result.data ?? []),
  )
  const [connectorConfig, { refetch: refetchConnectorConfig }] = createResource(() =>
    globalSDK.client.office.platform.connector.config.get().then((result) => result.data),
  )
  const [artifacts, { refetch: refetchArtifacts }] = createResource(() =>
    globalSDK.client.office.platform.artifact.list().then((result) => result.data ?? []),
  )
  const [browserStatus, { refetch: refetchBrowser }] = createResource(() =>
    globalSDK.client.office.platform.browser.status().then((result) => result.data),
  )

  const [sessionUrl, setSessionUrl] = createSignal("")
  const [feishuMessage, setFeishuMessage] = createSignal("")
  const [feishuKeywordDraft, setFeishuKeywordDraft] = createSignal("NovaWay")
  const [feishuTestState, setFeishuTestState] = createSignal<"idle" | "testing" | "success" | "failed">("idle")
  const [editDraft, setEditDraft] = createStore({
    id: "",
    title: "",
    scene: "",
    prompt: "",
    connectors: "",
    browser: false,
    browserUrl: "",
    notificationUrl: "",
  })
  const [scheduleDraft, setScheduleDraft] = createStore({
    id: "",
    title: "",
    scene: "office-data",
    prompt: "",
    triggerType: "daily" as "interval" | "daily" | "weekly" | "monthly" | "days",
    minutes: 60,
    time: "09:00",
    dayOfWeek: 1,
    dayOfMonth: 1,
    everyDays: 2,
    notificationUrl: "",
    browser: false,
    browserUrl: "",
    inputValues: {} as Record<string, string>,
  })
  const [runDraft, setRunDraft] = createStore<Record<string, string>>({})
  const [runningId, setRunningId] = createSignal("")
  const [runningKeys, setRunningKeys] = createSignal<string[]>([])
  const [activeTab, setActiveTab] = createSignal<
    "workflows" | "schedules" | "connectors" | "automation" | "history" | undefined
  >(undefined)
  const [feishuWebhookDraft, setFeishuWebhookDraft] = createSignal("")
  const [feishuAppIdDraft, setFeishuAppIdDraft] = createSignal("")
  const [feishuAppSecretDraft, setFeishuAppSecretDraft] = createSignal("")
  const [tencentTokenDraft, setTencentTokenDraft] = createSignal("")
  const [connectorGuideError, setConnectorGuideError] = createSignal("")

  async function browseWorkflowInput(key: string, setValue: (value: string) => void) {
    const title = officeInputLabel(key)
    if (key === "source_path" && platform.openFilePickerDialog) {
      const result = await platform.openFilePickerDialog({ title, multiple: false })
      const value = Array.isArray(result) ? result[0] : result
      if (value) setValue(value)
      return
    }
    if (platform.openDirectoryPickerDialog) {
      const result = await platform.openDirectoryPickerDialog({ title, multiple: false })
      const value = Array.isArray(result) ? result[0] : result
      if (value) setValue(value)
    }
  }

  function isWorkflowPathInput(key: string) {
    return ["source_path", "source_dir", "output_dir"].includes(key) || /path|dir/i.test(key)
  }

  async function runSchedule(id: string) {
    await globalSDK.client.office.platform.schedule.run({ id })
    void refetchRuns()
  }

  async function toggleSchedule(id: string, next: "active" | "paused") {
    if (next === "paused" && typeof confirm !== "undefined" && !confirm("确定暂停这个定时任务吗？")) return
    await globalSDK.client.office.platform.schedule.update({ id, status: next })
    void refetchSchedules()
  }

  async function deleteSchedule(id: string) {
    await globalSDK.client.office.platform.schedule.delete({ id })
    void refetchSchedules()
  }

  async function runWorkflow(workflow: PanelWorkflow) {
    const keys = officePromptInputKeys(workflow.prompt)
    if (keys.length > 0) {
      openRunDialog(workflow, keys)
      return
    }
    await globalSDK.client.office.platform.workflow.run({ id: workflow.id })
    void refetchRuns()
  }

  function openRunDialog(workflow: PanelWorkflow, keys: string[]) {
    setRunningId(workflow.id)
    setRunningKeys(keys)
    setRunDraft(Object.fromEntries(keys.map((key) => [key, ""])))
    dialog.show(
      () => (
        <Dialog title={`运行工作流：${workflow.title}`} class="w-full max-w-[560px] mx-auto">
          <div class="flex flex-col gap-3 px-6 pb-5">
            <For each={keys}>
              {(key) => (
                <label class="flex flex-col gap-1">
                  <span class="text-11-medium text-text-weak">{officeInputLabel(key)}</span>
                  <div class="flex items-center gap-2">
                    <input
                      value={runDraft[key] ?? ""}
                      onInput={(event) => setRunDraft(key, event.currentTarget.value)}
                      placeholder={`请输入 ${officeInputLabel(key)}`}
                      class="h-9 min-w-0 flex-1 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                    />
                    <Show when={isWorkflowPathInput(key)}>
                      <button
                        type="button"
                        class="grid h-9 shrink-0 place-items-center rounded-[7px] border border-border-weak-base px-3 text-11-medium text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100"
                        onClick={() => void browseWorkflowInput(key, (value) => setRunDraft(key, value))}
                      >
                        选择
                      </button>
                    </Show>
                  </div>
                </label>
              )}
            </For>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="h-9 rounded-[7px] border border-border-weak-base px-4 text-12-medium text-text-weak"
                onClick={() => dialog.close()}
              >
                取消
              </button>
              <button
                type="button"
                class="h-9 rounded-[7px] border border-emerald-300/45 bg-emerald-300/10 px-4 text-12-medium text-emerald-100"
                onClick={() => void executeRunDialog()}
              >
                开始运行
              </button>
            </div>
          </div>
        </Dialog>
      ),
      () => dialog.close(),
    )
  }

  async function executeRunDialog() {
    if (!runningId()) return
    const inputValues = Object.fromEntries(
      runningKeys()
        .map((key) => [key, runDraft[key]?.trim() ?? ""])
        .filter((entry) => Boolean(entry[1])),
    )
    await globalSDK.client.office.platform.workflow.run({ id: runningId(), inputValues })
    void refetchRuns()
    dialog.close()
  }

  function openWorkflowDialog(workflow?: PanelWorkflow) {
    setEditDraft({
      id: workflow?.id ?? "",
      title: workflow?.title ?? "",
      scene: workflow?.scene ?? "office-document",
      prompt: workflow?.prompt ?? "",
      connectors: workflow?.connectors.join(",") ?? "",
      browser: workflow?.browser.enabled ?? false,
      browserUrl: workflow?.browser.url ?? "",
      notificationUrl: workflow?.notificationUrl ?? "",
    })
    dialog.show(
      () => (
        <Dialog title={workflow ? "编辑工作流" : "新建工作流"} class="w-full max-w-[680px] mx-auto">
          <div class="flex flex-col gap-3 px-6 pb-5">
            <input
              value={editDraft.title}
              onInput={(event) => setEditDraft("title", event.currentTarget.value)}
              placeholder="工作流名称"
              class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
            />
            <input
              value={editDraft.scene}
              onInput={(event) => setEditDraft("scene", event.currentTarget.value)}
              placeholder="场景标识"
              class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
            />
            <textarea
              value={editDraft.prompt}
              onInput={(event) => setEditDraft("prompt", event.currentTarget.value)}
              placeholder="工作流提示词"
              class="min-h-28 resize-none rounded-[7px] border border-border-weak-base bg-background-base px-3 py-2 text-12-regular leading-relaxed text-text-strong outline-none"
            />
            <div class="flex flex-wrap gap-2">
              <For each={connectors() ?? []}>
                {(connector) => {
                  const selected = editDraft.connectors
                    .split(",")
                    .map((item) => item.trim())
                    .includes(connector.id)
                  const connected = connector.status === "connected"
                  return (
                    <label
                      class="flex h-8 items-center gap-1.5 rounded-[7px] border px-2.5 text-11-medium transition-all duration-150"
                      classList={{
                        "border-emerald-300/50 bg-emerald-300/10 text-emerald-100": selected,
                        "border-border-weak-base bg-background-base text-text-weak": !selected,
                        "cursor-pointer": connected,
                        "cursor-not-allowed opacity-50": !connected,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!connected}
                        onChange={() => toggleWorkflowConnector(connector.id)}
                        class="size-3.5 accent-emerald-400"
                      />
                      {connector.name}
                      <Show when={!connected}>
                        <span class="text-10-medium text-text-muted">未连接</span>
                      </Show>
                    </label>
                  )
                }}
              </For>
            </div>
            <input
              value={editDraft.notificationUrl}
              onInput={(event) => setEditDraft("notificationUrl", event.currentTarget.value)}
              placeholder="失败通知 Webhook URL"
              class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
            />
            <label class="flex items-center gap-2 text-12-regular text-text-weak">
              <input
                type="checkbox"
                checked={editDraft.browser}
                onChange={(event) => setEditDraft("browser", event.currentTarget.checked)}
              />
              启用浏览器
            </label>
            <Show when={editDraft.browser}>
              <input
                value={editDraft.browserUrl}
                onInput={(event) => setEditDraft("browserUrl", event.currentTarget.value)}
                placeholder="浏览器起始 URL"
                class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
              />
            </Show>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="h-9 rounded-[7px] border border-border-weak-base px-4 text-12-medium text-text-weak"
                onClick={() => dialog.close()}
              >
                取消
              </button>
              <button
                type="button"
                class="h-9 rounded-[7px] border border-emerald-300/45 bg-emerald-300/10 px-4 text-12-medium text-emerald-100"
                onClick={() => void saveWorkflowEditor()}
              >
                保存
              </button>
            </div>
          </div>
        </Dialog>
      ),
      () => dialog.close(),
    )
  }

  function openWorkflowEditor(workflow: PanelWorkflow) {
    openWorkflowDialog(workflow)
  }

  function toggleWorkflowConnector(id: string) {
    const current = editDraft.connectors
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    setEditDraft("connectors", next.join(","))
  }

  function openCreateWorkflow() {
    openWorkflowDialog()
  }

  async function saveWorkflowEditor() {
    if (!editDraft.title.trim() || !editDraft.prompt.trim()) return
    const payload = {
      title: editDraft.title,
      scene: editDraft.scene,
      prompt: editDraft.prompt,
      connectors: editDraft.connectors
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      browser: {
        enabled: editDraft.browser,
        url: editDraft.browserUrl.trim() || undefined,
      },
      notificationUrl: editDraft.notificationUrl.trim() || undefined,
    }
    if (editDraft.id) {
      await globalSDK.client.office.platform.workflow.update({ id: editDraft.id, ...payload })
    } else {
      await globalSDK.client.office.platform.workflow.create(payload)
    }
    void refetchWorkflows()
    dialog.close()
  }

  function openScheduleDialog(workflow?: PanelWorkflow) {
    const keys = workflow ? officePromptInputKeys(workflow.prompt) : []
    setScheduleDraft({
      id: workflow?.id ?? "",
      title: workflow?.title ?? "每周销售周报",
      scene: workflow?.scene ?? "office-data",
      prompt: workflow?.prompt ?? "每周一分析上一周销售数据，生成周报并列出行动建议。",
      triggerType: "daily" as const,
      minutes: 60,
      time: "09:00",
      dayOfWeek: 1,
      dayOfMonth: 1,
      everyDays: 2,
      notificationUrl: workflow?.notificationUrl ?? "",
      browser: workflow?.browser.enabled ?? false,
      browserUrl: workflow?.browser.url ?? "",
      inputValues: Object.fromEntries(keys.map((key) => [key, ""])),
    })
    dialog.show(
      () => (
        <Dialog title={workflow ? "转为定时任务" : "新建定时任务"} class="w-full max-w-[560px] mx-auto">
          <div class="flex flex-col gap-3 px-6 pb-5">
            <Show when={!workflow}>
              <input
                value={scheduleDraft.title}
                onInput={(event) => setScheduleDraft("title", event.currentTarget.value)}
                placeholder="任务名称"
                class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
              />
              <input
                value={scheduleDraft.scene}
                onInput={(event) => setScheduleDraft("scene", event.currentTarget.value)}
                placeholder="场景标识"
                class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
              />
              <textarea
                value={scheduleDraft.prompt}
                onInput={(event) => setScheduleDraft("prompt", event.currentTarget.value)}
                placeholder="任务提示词"
                class="min-h-24 resize-none rounded-[7px] border border-border-weak-base bg-background-base px-3 py-2 text-12-regular leading-relaxed text-text-strong outline-none"
              />
            </Show>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <For
                each={
                  [
                    { id: "daily", label: "每天" },
                    { id: "weekly", label: "每周" },
                    { id: "monthly", label: "每月" },
                    { id: "days", label: "每隔N天" },
                    { id: "interval", label: "间隔分钟" },
                  ] as const
                }
              >
                {(option) => (
                  <button
                    type="button"
                    class="h-8 rounded-[7px] border px-2 text-11-medium transition-all duration-150"
                    classList={{
                      "border-emerald-300/50 bg-emerald-300/10 text-emerald-100":
                        scheduleDraft.triggerType === option.id,
                      "border-border-weak-base bg-background-base text-text-weak":
                        scheduleDraft.triggerType !== option.id,
                    }}
                    onClick={() => setScheduleDraft("triggerType", option.id)}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>
            <Show when={scheduleDraft.triggerType === "interval"}>
              <input
                type="number"
                min="1"
                value={scheduleDraft.minutes}
                onInput={(event) => setScheduleDraft("minutes", Number(event.currentTarget.value))}
                placeholder="间隔分钟"
                class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
              />
            </Show>
            <Show when={scheduleDraft.triggerType !== "interval"}>
              <input
                type="time"
                value={scheduleDraft.time}
                onInput={(event) => setScheduleDraft("time", event.currentTarget.value)}
                class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
              />
              <Show when={scheduleDraft.triggerType === "weekly"}>
                <select
                  value={scheduleDraft.dayOfWeek}
                  onChange={(event) => setScheduleDraft("dayOfWeek", Number(event.currentTarget.value))}
                  class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                >
                  <For each={["周一", "周二", "周三", "周四", "周五", "周六", "周日"]}>
                    {(label, index) => <option value={index() + 1}>{label}</option>}
                  </For>
                </select>
              </Show>
              <Show when={scheduleDraft.triggerType === "monthly"}>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={scheduleDraft.dayOfMonth}
                  onInput={(event) => setScheduleDraft("dayOfMonth", Number(event.currentTarget.value))}
                  placeholder="每月几号"
                  class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                />
              </Show>
              <Show when={scheduleDraft.triggerType === "days"}>
                <input
                  type="number"
                  min="1"
                  value={scheduleDraft.everyDays}
                  onInput={(event) => setScheduleDraft("everyDays", Number(event.currentTarget.value))}
                  placeholder="每隔几天"
                  class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                />
              </Show>
            </Show>
            <input
              value={scheduleDraft.notificationUrl}
              onInput={(event) => setScheduleDraft("notificationUrl", event.currentTarget.value)}
              placeholder="失败通知 Webhook URL"
              class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
            />
            <label class="flex items-center gap-2 text-12-regular text-text-weak">
              <input
                type="checkbox"
                checked={scheduleDraft.browser}
                onChange={(event) => setScheduleDraft("browser", event.currentTarget.checked)}
              />
              启用浏览器
            </label>
            <Show when={scheduleDraft.browser}>
              <input
                value={scheduleDraft.browserUrl}
                onInput={(event) => setScheduleDraft("browserUrl", event.currentTarget.value)}
                placeholder="浏览器起始 URL"
                class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
              />
            </Show>
            <For each={workflow ? officePromptInputKeys(workflow.prompt) : []}>
              {(key) => (
                <label class="flex flex-col gap-1">
                  <span class="text-11-medium text-text-weak">{officeInputLabel(key)}</span>
                  <div class="flex items-center gap-2">
                    <input
                      value={scheduleDraft.inputValues[key] ?? ""}
                      onInput={(event) => setScheduleDraft("inputValues", key, event.currentTarget.value)}
                      placeholder={`请输入 ${officeInputLabel(key)}`}
                      class="h-9 min-w-0 flex-1 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                    />
                    <Show when={isWorkflowPathInput(key)}>
                      <button
                        type="button"
                        class="grid h-9 shrink-0 place-items-center rounded-[7px] border border-border-weak-base px-3 text-11-medium text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100"
                        onClick={() =>
                          void browseWorkflowInput(key, (value) => setScheduleDraft("inputValues", key, value))
                        }
                      >
                        选择
                      </button>
                    </Show>
                  </div>
                </label>
              )}
            </For>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="h-9 rounded-[7px] border border-border-weak-base px-4 text-12-medium text-text-weak"
                onClick={() => dialog.close()}
              >
                取消
              </button>
              <button
                type="button"
                class="h-9 rounded-[7px] border border-emerald-300/45 bg-emerald-300/10 px-4 text-12-medium text-emerald-100"
                onClick={() => void saveScheduleDialog()}
              >
                保存
              </button>
            </div>
          </div>
        </Dialog>
      ),
      () => dialog.close(),
    )
  }

  function openCreateSchedule() {
    openScheduleDialog()
  }

  function scheduleTriggerFromDraft() {
    if (scheduleDraft.triggerType === "interval") {
      return { type: "interval" as const, minutes: Math.max(1, scheduleDraft.minutes) }
    }
    if (scheduleDraft.triggerType === "weekly") {
      return {
        type: "weekly" as const,
        dayOfWeek: Math.max(1, scheduleDraft.dayOfWeek),
        time: scheduleDraft.time || "09:00",
      }
    }
    if (scheduleDraft.triggerType === "monthly") {
      return {
        type: "monthly" as const,
        dayOfMonth: Math.max(1, scheduleDraft.dayOfMonth),
        time: scheduleDraft.time || "09:00",
      }
    }
    if (scheduleDraft.triggerType === "days") {
      return {
        type: "days" as const,
        everyDays: Math.max(1, scheduleDraft.everyDays),
        time: scheduleDraft.time || "09:00",
      }
    }
    return { type: "daily" as const, time: scheduleDraft.time || "09:00" }
  }

  async function saveScheduleDialog() {
    const inputValues = Object.fromEntries(
      Object.entries(scheduleDraft.inputValues)
        .map(([key, value]) => [key, value?.trim() ?? ""])
        .filter((entry) => Boolean(entry[1])),
    )
    if (scheduleDraft.id) {
      await globalSDK.client.office.platform.workflow.schedule({
        id: scheduleDraft.id,
        trigger: scheduleTriggerFromDraft(),
        notificationUrl: scheduleDraft.notificationUrl.trim() || undefined,
        browser: {
          enabled: scheduleDraft.browser,
          url: scheduleDraft.browserUrl.trim() || undefined,
        },
        inputValues,
      })
    } else {
      await globalSDK.client.office.platform.schedule.create({
        title: scheduleDraft.title,
        scene: scheduleDraft.scene,
        prompt: scheduleDraft.prompt,
        trigger: scheduleTriggerFromDraft(),
        notificationUrl: scheduleDraft.notificationUrl.trim() || undefined,
        browser: {
          enabled: scheduleDraft.browser,
          url: scheduleDraft.browserUrl.trim() || undefined,
        },
      })
    }
    void refetchSchedules()
    dialog.close()
  }

  async function deleteWorkflow(id: string) {
    await globalSDK.client.office.platform.workflow.delete({ id })
    void refetchWorkflows()
  }

  async function toggleWorkflow(id: string, enabled: boolean) {
    await globalSDK.client.office.platform.workflow.update({ id, enabled })
    void refetchWorkflows()
  }

  async function restoreArtifact(id: string) {
    await globalSDK.client.office.platform.artifact.restore({ id })
    void refetchArtifacts()
  }

  async function connectConnector(id: string) {
    await globalSDK.client.office.platform.connector.connect({ id })
    void refetchConnectors()
  }

  async function disconnectConnector(id: string) {
    await globalSDK.client.office.platform.connector.disconnect({ id })
    void refetchConnectors()
  }

  async function startBrowser() {
    if (!sessionUrl().trim()) return
    await globalSDK.client.office.platform.browser.start({ url: sessionUrl() })
    void refetchBrowser()
  }

  async function snapshotBrowser() {
    await globalSDK.client.office.platform.browser.snapshot()
    void refetchBrowser()
  }

  async function stopBrowser() {
    await globalSDK.client.office.platform.browser.stop()
    void refetchBrowser()
  }

  async function sendFeishuMessage() {
    const text = feishuMessage().trim()
    if (!text) return
    const keyword = connectorConfig()?.feishuKeyword?.trim() || "NovaWay"
    const bodyText = text.includes(keyword) ? text : `${keyword}：${text}`
    setFeishuTestState("testing")
    try {
      await globalSDK.client.office.platform.connector.action({
        id: "feishu",
        action: "send_message",
        arguments: { text: bodyText },
      })
      setFeishuMessage("")
      setFeishuTestState("success")
      showToast({ title: "飞书消息已发送", description: "请到群聊中确认是否收到。" })
    } catch {
      setFeishuTestState("failed")
      showToast({ title: "飞书发送失败", description: "请检查 Webhook、关键词或 IP 白名单设置。" })
    }
  }

  async function testFeishuConnection() {
    setFeishuTestState("testing")
    try {
      const keyword = connectorConfig()?.feishuKeyword?.trim() || "NovaWay"
      await globalSDK.client.office.platform.connector.action({
        id: "feishu",
        action: "send_message",
        arguments: { text: `${keyword}：这是一条飞书连通测试消息` },
      })
      setFeishuTestState("success")
      showToast({ title: "飞书测试消息已发送", description: "请到群里查看是否收到。" })
    } catch {
      setFeishuTestState("failed")
      showToast({ title: "飞书发送失败", description: "请检查 Webhook、关键词或 IP 白名单设置。" })
    }
  }

  async function openConnectorGuide(id: string) {
    const isFeishu = id === "feishu"
    const title = isFeishu ? "配置飞书通知" : "配置腾讯文档"
    setFeishuWebhookDraft("")
    setFeishuKeywordDraft("NovaWay")
    setFeishuAppIdDraft("")
    setFeishuAppSecretDraft("")
    setTencentTokenDraft("")
    setConnectorGuideError("")
    if (isFeishu) {
      const config = await globalSDK.client.office.platform.connector.config
        .get()
        .then((result) => result.data)
        .catch(() => undefined)
      setFeishuWebhookDraft(config?.feishuWebhookUrl ?? "")
      setFeishuKeywordDraft(config?.feishuKeyword?.trim() || "NovaWay")
      setFeishuAppIdDraft(config?.feishuAppId ?? "")
      setFeishuAppSecretDraft(config?.feishuAppSecret ?? "")
    }
    dialog.show(
      () => (
        <Dialog title={title} class="w-full max-w-[520px] mx-auto [&_[data-slot=dialog-body]]:overflow-y-auto">
          <div class="flex flex-col gap-2 px-6 pb-5">
            <div class="rounded-[7px] border border-border-weak-base bg-background-base p-2.5 text-11-regular leading-relaxed text-text-weak">
              {isFeishu
                ? "填写飞书自定义机器人 Webhook 可发送单向通知；如需在飞书里回复 NovaWay 会话，再填写企业自建应用的 App ID、App Secret 并完成绑定。"
                : "填写腾讯文档 MCP Token，保存后会自动重新连接。"}
            </div>
            <Show when={connectorGuideError()}>
              <span class="rounded-[7px] border border-rose-300/35 bg-rose-300/10 px-2.5 py-2 text-11-regular leading-relaxed text-rose-100">
                {connectorGuideError()}
              </span>
            </Show>
            <Show when={isFeishu}>
              <ol class="space-y-1.5 rounded-[7px] border border-border-weak-base bg-background-base p-3 text-11-regular leading-relaxed text-text-weak">
                <li>手机端暂不支持添加自定义机器人，请使用飞书电脑端或 Web 端操作。</li>
                <li>打开飞书并进入目标群聊。</li>
                <li>点击群聊右上角的「...」或群名称，进入「群设置」。</li>
                <li>找到「群机器人」或「机器人」，点击「添加机器人」。</li>
                <li>选择「自定义机器人」。如果列表里没有，先确认你是群主或管理员。</li>
                <li>机器人名称可任意填写，例如 NovaWay 办公助手。</li>
                <li>
                  安全设置选择「自定义关键词」，关键词和下方填写的一致；默认使用 NovaWay，也可以选择「IP
                  白名单」；不要选择「加签」。
                </li>
                <li>创建完成后复制以 https://open.feishu.cn/open-apis/bot/v2/hook/ 开头的完整 Webhook 地址。</li>
                <li>回到这里粘贴 Webhook 地址并填写关键词，点击「保存并连接」。</li>
                <li>
                  如需要飞书回复：在飞书开放平台创建「企业自建应用」，在「添加应用能力」中添加机器人，开通
                  im:message.p2p_msg:readonly、im:message:send_as_bot 权限，并订阅 im.message.receive_v1。
                </li>
                <li>在「事件订阅」中选择长连接模式，不需要公网回调地址。</li>
                <li>复制 App ID 和 App Secret 填到下方，先点击「保存并连接」，再给机器人发一条任意消息完成绑定。</li>
              </ol>
            </Show>
            <Show when={isFeishu}>
              <FeishuAppSetupGuide />
            </Show>
            <Show when={isFeishu}>
              <label class="flex flex-col gap-1">
                <span class="flex items-center gap-1 text-11-medium text-text-weak">
                  飞书群 Webhook 地址
                  <ConnectorHelpTip id="feishu" />
                </span>
                <input
                  value={feishuWebhookDraft()}
                  onInput={(event) => setFeishuWebhookDraft(event.currentTarget.value)}
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-11-medium text-text-weak">自定义关键词</span>
                <input
                  value={feishuKeywordDraft()}
                  onInput={(event) => setFeishuKeywordDraft(event.currentTarget.value)}
                  placeholder="默认 NovaWay"
                  class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="flex items-center gap-1 text-11-medium text-text-weak">
                  企业自建应用 App ID
                  <ConnectorHelpTip id="feishu-app" />
                </span>
                <input
                  value={feishuAppIdDraft()}
                  onInput={(event) => setFeishuAppIdDraft(event.currentTarget.value)}
                  placeholder="cli_..."
                  class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="flex items-center gap-1 text-11-medium text-text-weak">
                  企业自建应用 App Secret
                  <ConnectorHelpTip id="feishu-app" />
                </span>
                <input
                  type="password"
                  value={feishuAppSecretDraft()}
                  onInput={(event) => setFeishuAppSecretDraft(event.currentTarget.value)}
                  placeholder="请输入 App Secret"
                  class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                />
              </label>
            </Show>
            <Show when={!isFeishu}>
              <label class="flex flex-col gap-1">
                <span class="flex items-center gap-1 text-11-medium text-text-weak">
                  腾讯文档 Token
                  <ConnectorHelpTip id="tencent-docs" />
                </span>
                <input
                  value={tencentTokenDraft()}
                  onInput={(event) => setTencentTokenDraft(event.currentTarget.value)}
                  placeholder="粘贴从 docs.qq.com/open/auth/mcp.html 获取的 Token"
                  class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                />
              </label>
            </Show>
            <div class="flex justify-end gap-2 pt-1">
              <button
                type="button"
                class="h-9 rounded-[7px] border border-border-weak-base px-4 text-12-medium text-text-weak"
                onClick={() => dialog.close()}
              >
                取消
              </button>
              <button
                type="button"
                class="h-9 rounded-[7px] border border-emerald-300/45 bg-emerald-300/10 px-4 text-12-medium text-emerald-100"
                onClick={() => void saveConnectorGuide(id)}
              >
                保存并连接
              </button>
            </div>
          </div>
        </Dialog>
      ),
      () => dialog.close(),
    )
  }

  async function saveConnectorGuide(id: string) {
    if (id === "feishu") {
      const webhook = feishuWebhookDraft().trim()
      const appId = feishuAppIdDraft().trim()
      const appSecret = feishuAppSecretDraft().trim()
      if (!webhook && (!appId || !appSecret)) {
        setConnectorGuideError("请填写飞书 Webhook，或同时填写企业自建应用的 App ID 和 App Secret。")
        return
      }
      await globalSDK.client.office.platform.connector.config.update({
        feishuWebhookUrl: webhook || undefined,
        feishuKeyword: feishuKeywordDraft().trim() || "NovaWay",
        feishuAppId: appId || undefined,
        feishuAppSecret: appSecret || undefined,
        feishuUserId: connectorConfig()?.feishuUserId || undefined,
      })
      void refetchConnectors()
      void refetchConnectorConfig()
      void refetchStatus()
      dialog.close()
      return
    }
    const token = tencentTokenDraft().trim()
    if (!token) {
      setConnectorGuideError("请先填写腾讯文档 MCP Token。")
      return
    }
    await globalSDK.client.office.platform.connector.config.update({ tencentDocsToken: token })
    const next = await globalSDK.client.office.platform.connector.list()
    const tencent = next.data?.find((item) => item.id === "tencent-docs")
    if (tencent?.status === "failed") {
      setConnectorGuideError(
        "连接失败：Token 无效或已失效，或当前账号未开通腾讯文档 VIP 权限（官方错误码 400006/400007）。请重新获取 Token 后重试。",
      )
      return
    }
    void refetchConnectors()
    void refetchStatus()
    dialog.close()
  }

  return (
    <section class="relative z-30" onMouseLeave={() => setActiveTab(undefined)}>
      <div class="mb-4 flex items-center justify-between gap-4">
        <div>
          <div class="text-16-medium text-text-strong">办公平台</div>
          <div class="mt-1 text-12-regular text-text-weak">工作流、定时任务、连接器和浏览器自动化</div>
        </div>
        <div class="flex items-center gap-2 text-11-medium text-text-weak">
          <Show when={status()?.schedulerEnabled}>
            <span class="flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2.5 py-1 text-emerald-200">
              <span class="size-1.5 rounded-full bg-emerald-400" />
              调度运行中
            </span>
          </Show>
          <Show when={status()?.browserConfigured}>
            <span class="flex items-center gap-1.5 rounded-full border border-sky-300/25 bg-sky-300/10 px-2.5 py-1 text-sky-200">
              <Icon name="window-cursor" size="small" />
              浏览器可用
            </span>
          </Show>
          <Show when={status()?.diagnostics}>
            {(diagnostics) => (
              <span class="hidden items-center gap-1.5 rounded-full border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 py-1 text-11-medium text-text-weak lg:flex">
                浏览器{" "}
                {diagnostics().browser === "connected"
                  ? "已连接"
                  : diagnostics().browser === "failed"
                    ? "异常"
                    : "已内置"}
                <span class="text-border-stronger">·</span>
                腾讯文档 {diagnostics().tencentDocs === "configured" ? "已配置" : "未配置"}
                <span class="text-border-stronger">·</span>
                飞书 {diagnostics().feishu === "configured" ? "已配置" : "未配置"}
              </span>
            )}
          </Show>
        </div>
      </div>

      <nav class="mb-4 grid grid-cols-2 gap-2 border-b border-border-weak-base pb-3 sm:grid-cols-3 lg:grid-cols-4">
        <button
          type="button"
          class="flex h-9 w-full items-center justify-center gap-1.5 rounded-[7px] border px-3 text-12-medium transition-all duration-150 hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-[0.98]"
          classList={{
            "border-emerald-300/45 bg-emerald-300/10 text-emerald-100": activeTab() === "workflows",
            "border-border-weak-base bg-surface-raised-stronger-non-alpha text-text-weak": activeTab() !== "workflows",
          }}
          onMouseEnter={() => setActiveTab("workflows")}
          onClick={() => setActiveTab("workflows")}
        >
          <Icon name="branch" size="small" />
          工作流
        </button>
        <button
          type="button"
          class="flex h-9 w-full items-center justify-center gap-1.5 rounded-[7px] border px-3 text-12-medium transition-all duration-150 hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-[0.98]"
          classList={{
            "border-emerald-300/45 bg-emerald-300/10 text-emerald-100": activeTab() === "schedules",
            "border-border-weak-base bg-surface-raised-stronger-non-alpha text-text-weak": activeTab() !== "schedules",
          }}
          onMouseEnter={() => setActiveTab("schedules")}
          onClick={() => setActiveTab("schedules")}
        >
          <Icon name="refresh" size="small" />
          定时任务
        </button>
        <button
          type="button"
          class="flex h-9 w-full items-center justify-center gap-1.5 rounded-[7px] border px-3 text-12-medium transition-all duration-150 hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-[0.98]"
          classList={{
            "border-emerald-300/45 bg-emerald-300/10 text-emerald-100": activeTab() === "connectors",
            "border-border-weak-base bg-surface-raised-stronger-non-alpha text-text-weak": activeTab() !== "connectors",
          }}
          onMouseEnter={() => setActiveTab("connectors")}
          onClick={() => setActiveTab("connectors")}
        >
          <Icon name="link" size="small" />
          连接器
        </button>
        <button
          type="button"
          class="flex h-9 w-full items-center justify-center gap-1.5 rounded-[7px] border px-3 text-12-medium transition-all duration-150 hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-[0.98]"
          classList={{
            "border-emerald-300/45 bg-emerald-300/10 text-emerald-100": activeTab() === "history",
            "border-border-weak-base bg-surface-raised-stronger-non-alpha text-text-weak": activeTab() !== "history",
          }}
          onMouseEnter={() => setActiveTab("history")}
          onClick={() => setActiveTab("history")}
        >
          <Icon name="task" size="small" />
          运行历史
        </button>
      </nav>

      <Show when={activeTab()}>
        <div
          class="absolute left-0 right-0 top-full z-40 mt-2 transition-[opacity,transform] duration-200 ease-out"
          classList={{
            "pointer-events-none translate-y-[-8px] scale-[0.985] opacity-0": !activeTab(),
            "pointer-events-auto translate-y-0 scale-100 opacity-100": activeTab() !== undefined,
          }}
          aria-hidden={activeTab() === undefined}
        >
          <div class="rounded-[10px] border border-border-strong-base bg-surface-raised-stronger-non-alpha p-4 shadow-[0_28px_70px_rgba(0,0,0,0.28)]">
            <div class="grid grid-cols-1 gap-4">
              <div
                class="rounded-[8px] border border-border-weak-base bg-background-base p-4"
                classList={{ hidden: activeTab() !== "workflows" }}
              >
                <div class="flex items-center gap-2 text-14-medium text-text-strong">
                  <Icon name="branch" size="small" />
                  工作流
                </div>
                <div class="mt-3 text-12-regular leading-relaxed text-text-weak">
                  已沉淀 {workflows()?.length ?? 0} 个可复跑任务，可一键执行或转为定时任务。
                </div>

                <div class="mt-4 flex items-center justify-between gap-3">
                  <div class="text-11-regular leading-relaxed text-text-weak">
                    启用后可运行或转定时；停用后保留配置，不再执行。
                  </div>
                  <button
                    type="button"
                    class="grid h-9 shrink-0 place-items-center rounded-[8px] border border-emerald-300/50 bg-emerald-300/10 px-3 text-12-medium text-emerald-100 transition-all duration-150 hover:-translate-y-px hover:bg-emerald-300/20 hover:shadow-[0_8px_20px_rgba(16,185,129,0.16)]"
                    title="新建工作流"
                    onClick={() => openCreateWorkflow()}
                  >
                    <span class="flex items-center gap-1.5">
                      <Icon name="plus-small" size="small" />
                      新建
                    </span>
                  </button>
                </div>

                <div class="mt-4 flex flex-col gap-2">
                  <For each={workflows() ?? []}>
                    {(workflow) => (
                      <div class="rounded-[8px] border border-border-weaker-base bg-background-base p-3">
                        <div class="flex items-center justify-between gap-2">
                          <div class="min-w-0">
                            <div class="truncate text-13-medium text-text-strong">{workflow.title}</div>
                            <div class="mt-0.5 line-clamp-2 text-11-regular text-text-weak">{workflow.prompt}</div>
                            <div
                              class="mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-10-medium"
                              classList={{
                                "border-emerald-300/30 bg-emerald-300/10 text-emerald-200": workflow.enabled,
                                "border-border-weak-base bg-background-base text-text-muted": !workflow.enabled,
                              }}
                            >
                              <span
                                class="size-1.5 rounded-full"
                                classList={{
                                  "bg-emerald-400": workflow.enabled,
                                  "bg-text-muted": !workflow.enabled,
                                }}
                              />
                              {workflow.enabled ? "已启用" : "已停用"}
                            </div>
                          </div>
                          <div class="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              class="grid size-8 place-items-center rounded-[7px] border border-border-weak-base text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100 hover:shadow-[0_6px_16px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-95"
                              title="立即运行"
                              disabled={!workflow.enabled}
                              classList={{ "opacity-45": !workflow.enabled }}
                              onClick={() => void runWorkflow(workflow)}
                            >
                              <Icon name="play" size="small" />
                            </button>
                            <button
                              type="button"
                              class="grid size-8 place-items-center rounded-[7px] border border-border-weak-base text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100 hover:shadow-[0_6px_16px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-95"
                              title="转为定时任务"
                              disabled={!workflow.enabled}
                              classList={{ "opacity-45": !workflow.enabled }}
                              onClick={() => openScheduleDialog(workflow)}
                            >
                              <Icon name="autopilot" size="small" />
                            </button>
                            <button
                              type="button"
                              class="grid size-8 place-items-center rounded-[7px] border border-border-weak-base text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100 hover:shadow-[0_6px_16px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-95"
                              title="编辑工作流"
                              onClick={() => openWorkflowEditor(workflow)}
                            >
                              <Icon name="pencil-line" size="small" />
                            </button>
                            <button
                              type="button"
                              class="grid size-8 place-items-center rounded-[7px] border border-border-weak-base text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100 hover:shadow-[0_6px_16px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-95"
                              title={workflow.enabled ? "停用工作流" : "启用工作流"}
                              onClick={() => void toggleWorkflow(workflow.id, !workflow.enabled)}
                            >
                              <Icon name={workflow.enabled ? "circle-check" : "circle-ban-sign"} size="small" />
                            </button>
                            <button
                              type="button"
                              class="grid size-8 place-items-center rounded-[7px] border border-border-weak-base text-text-weak hover:text-rose-300"
                              title="删除"
                              onClick={() => void deleteWorkflow(workflow.id)}
                            >
                              <Icon name="trash" size="small" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <div
                class="rounded-[8px] border border-border-weak-base bg-background-base p-4"
                classList={{ hidden: activeTab() !== "schedules" }}
              >
                <div class="flex items-center gap-2 text-14-medium text-text-strong">
                  <Icon name="refresh" size="small" />
                  定时任务
                </div>
                <div class="mt-3 text-12-regular leading-relaxed text-text-weak">
                  已配置 {schedules()?.length ?? 0} 个调度，当前生效{" "}
                  {schedules()?.filter((item) => item.status === "active").length ?? 0} 个。
                </div>

                <div class="mt-4 flex items-center justify-between gap-3">
                  <div class="text-11-regular leading-relaxed text-text-weak">
                    生效中会按间隔自动运行；暂停后保留配置，不再执行。
                  </div>
                  <button
                    type="button"
                    class="grid h-9 shrink-0 place-items-center rounded-[8px] border border-emerald-300/50 bg-emerald-300/10 px-3 text-12-medium text-emerald-100 transition-all duration-150 hover:-translate-y-px hover:bg-emerald-300/20 hover:shadow-[0_8px_20px_rgba(16,185,129,0.16)]"
                    title="新建定时任务"
                    onClick={() => openCreateSchedule()}
                  >
                    <span class="flex items-center gap-1.5">
                      <Icon name="plus-small" size="small" />
                      新建
                    </span>
                  </button>
                </div>

                <div class="mt-4 flex flex-col gap-2">
                  <For each={schedules() ?? []}>
                    {(schedule) => (
                      <div class="rounded-[8px] border border-border-weaker-base bg-background-base p-3">
                        <div class="flex items-center justify-between gap-2">
                          <div class="min-w-0">
                            <div class="truncate text-13-medium text-text-strong">{schedule.title}</div>
                            <div class="mt-0.5 truncate text-11-regular text-text-weak">
                              {schedule.scene} · {officeScheduleTriggerLabel(schedule.trigger)}
                            </div>
                          </div>
                          <div class="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              class="grid size-8 place-items-center rounded-[7px] border border-border-weak-base text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100 hover:shadow-[0_6px_16px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-95"
                              title="立即执行"
                              onClick={() => void runSchedule(schedule.id)}
                            >
                              <Icon name="play" size="small" />
                            </button>
                            <button
                              type="button"
                              class="grid size-8 place-items-center rounded-[7px] border border-border-weak-base text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100 hover:shadow-[0_6px_16px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-95"
                              title={schedule.status === "active" ? "暂停" : "恢复"}
                              onClick={() =>
                                void toggleSchedule(schedule.id, schedule.status === "active" ? "paused" : "active")
                              }
                            >
                              <Icon
                                name={schedule.status === "active" ? "circle-check" : "circle-ban-sign"}
                                size="small"
                              />
                            </button>
                            <button
                              type="button"
                              class="grid size-8 place-items-center rounded-[7px] border border-border-weak-base text-text-weak hover:text-rose-300"
                              title="删除"
                              onClick={() => void deleteSchedule(schedule.id)}
                            >
                              <Icon name="trash" size="small" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <div
                class="rounded-[8px] border border-border-weak-base bg-background-base p-4"
                classList={{ hidden: activeTab() !== "connectors" }}
              >
                <div class="flex items-center gap-2 text-14-medium text-text-strong">
                  <Icon name="link" size="small" />
                  连接器
                </div>
                <div class="mt-3 text-12-regular leading-relaxed text-text-weak">
                  当前内置 {connectors()?.length ?? 0} 个办公连接能力，固定选型、无需自行配置。
                </div>
                <div class="mt-4 flex flex-col gap-2">
                  <For each={connectors() ?? []}>
                    {(connector) => (
                      <div class="flex items-center justify-between gap-3 rounded-[8px] border border-border-weaker-base bg-background-base p-3">
                        <div class="min-w-0">
                          <div class="flex min-w-0 items-center gap-1">
                            <span class="truncate text-13-medium text-text-strong">{connector.name}</span>
                            <ConnectorHelpTip id={connector.id} />
                          </div>
                          <div class="mt-0.5 line-clamp-2 text-11-regular text-text-weak">{connector.description}</div>
                          <div class="mt-0.5 text-11-regular text-text-weak">{connector.capabilities.join(" / ")}</div>
                          <Show when={connector.status === "failed"}>
                            <div class="mt-1 text-11-regular leading-relaxed text-rose-200">
                              {connector.id === "tencent-docs"
                                ? "Token 无效/失效，或账号未开通 VIP 权限；请重新配置。"
                                : "连接异常，请重新连接。"}
                            </div>
                          </Show>
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                          <span
                            class="shrink-0 rounded-full border px-2 py-0.5 text-10-medium"
                            classList={{
                              "border-emerald-300/30 bg-emerald-300/10 text-emerald-200":
                                connector.status === "connected",
                              "border-rose-300/30 bg-rose-300/10 text-rose-200": connector.status === "failed",
                              "border-border-weak-base bg-background-base text-text-muted":
                                connector.status === "disabled",
                            }}
                          >
                            {connector.status === "connected"
                              ? "已连接"
                              : connector.status === "failed"
                                ? "异常"
                                : "未启用"}
                          </span>
                          <Show when={connector.id === "feishu" || connector.id === "tencent-docs"}>
                            <button
                              type="button"
                              class="grid size-8 shrink-0 place-items-center rounded-[7px] border border-border-weak-base text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100"
                              title={connector.id === "feishu" ? "配置飞书" : "配置腾讯文档"}
                              onClick={() => void openConnectorGuide(connector.id)}
                            >
                              <Icon name="sliders" size="small" />
                            </button>
                          </Show>
                          <Show when={connector.id === "tencent-docs" && connector.configured}>
                            <button
                              type="button"
                              class="grid size-8 shrink-0 place-items-center rounded-[7px] border border-border-weak-base text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100 active:translate-y-0 active:scale-95"
                              title={connector.status === "connected" ? "断开连接" : "重新连接"}
                              onClick={() =>
                                void (connector.status === "connected"
                                  ? disconnectConnector(connector.id)
                                  : connectConnector(connector.id))
                              }
                            >
                              <Icon name={connector.status === "connected" ? "stop" : "play"} size="small" />
                            </button>
                          </Show>
                          <Show when={connector.id === "browser"}>
                            <button
                              type="button"
                              class="grid size-8 shrink-0 place-items-center rounded-[7px] border border-border-weak-base text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100 active:translate-y-0 active:scale-95"
                              title={connector.status === "connected" ? "断开连接" : "连接"}
                              onClick={() =>
                                void (connector.status === "connected"
                                  ? disconnectConnector(connector.id)
                                  : connectConnector(connector.id))
                              }
                            >
                              <Icon name={connector.status === "connected" ? "stop" : "play"} size="small" />
                            </button>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
                <div class="mt-4 rounded-[8px] border border-border-weaker-base bg-background-base p-3">
                  <div class="text-12-medium text-text-strong">飞书群 Webhook 发消息</div>
                  <div class="mt-2 flex items-center gap-2">
                    <input
                      value={feishuMessage()}
                      onInput={(event) => setFeishuMessage(event.currentTarget.value)}
                      placeholder="输入消息，发送时自动带自定义关键词"
                      class="h-9 min-w-0 flex-1 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none"
                    />
                    <button
                      type="button"
                      class="grid size-9 shrink-0 place-items-center rounded-[7px] border border-emerald-300/40 bg-emerald-300/10 text-emerald-100"
                      title="发送飞书消息"
                      onClick={() => void sendFeishuMessage()}
                    >
                      <Icon name="paper-plane" size="small" />
                    </button>
                    <button
                      type="button"
                      class="h-9 shrink-0 rounded-[7px] border border-emerald-300/40 bg-emerald-300/10 px-3 text-11-medium text-emerald-100 transition-all duration-150 hover:-translate-y-px hover:bg-emerald-300/20 hover:shadow-[0_8px_20px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-95"
                      title="发送测试消息，验证飞书是否连通"
                      disabled={feishuTestState() === "testing"}
                      classList={{ "opacity-50": feishuTestState() === "testing" }}
                      onClick={() => void testFeishuConnection()}
                    >
                      {feishuTestState() === "testing" ? "测试中..." : "测试连通"}
                    </button>
                  </div>
                  <Show when={feishuTestState() === "success"}>
                    <div class="mt-2 rounded-[7px] border border-emerald-300/35 bg-emerald-300/10 px-2.5 py-1.5 text-11-medium text-emerald-100">
                      测试消息已发送，请到飞书群里查看是否收到。
                    </div>
                  </Show>
                  <Show when={feishuTestState() === "failed"}>
                    <div class="mt-2 rounded-[7px] border border-rose-300/35 bg-rose-300/10 px-2.5 py-1.5 text-11-medium text-rose-100">
                      发送失败，请检查 Webhook、自定义关键词或 IP 白名单设置。
                    </div>
                  </Show>
                </div>
              </div>

              <div
                class="rounded-[8px] border border-border-weak-base bg-background-base p-4"
                classList={{ hidden: true }}
              >
                <div class="flex items-center gap-2 text-14-medium text-text-strong">
                  <Icon name="window-cursor" size="small" />
                  浏览器自动化
                </div>
                <div class="mt-3 text-12-regular leading-relaxed text-text-weak">
                  {browserStatus()?.active
                    ? "浏览器会话已打开，可快照或关闭。"
                    : status()?.browserConfigured
                      ? "浏览器能力已配置，可打开会话并抓取页面。"
                      : "尚未配置浏览器 CDP 或隔离启动许可。"}
                </div>
                <div class="mt-4 text-12-regular leading-relaxed text-text-weak">
                  现有工具：导航、页面快照、点击、填写、按键、截图、控制台和网络诊断。
                </div>
                <div class="mt-4 flex flex-col gap-2">
                  <input
                    value={sessionUrl()}
                    onInput={(event) => setSessionUrl(event.currentTarget.value)}
                    placeholder="https://example.com"
                    class="h-9 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none placeholder:text-text-muted"
                  />
                  <div class="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      class="h-8 rounded-[7px] border border-sky-300/35 bg-sky-300/10 text-12-medium text-sky-200"
                      onClick={() => void startBrowser()}
                    >
                      开始
                    </button>
                    <button
                      type="button"
                      class="h-8 rounded-[7px] border border-border-weak-base text-12-medium text-text-weak"
                      onClick={() => void snapshotBrowser()}
                    >
                      快照
                    </button>
                    <button
                      type="button"
                      class="h-8 rounded-[7px] border border-rose-300/30 bg-rose-300/10 text-12-medium text-rose-200"
                      onClick={() => void stopBrowser()}
                    >
                      关闭
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            class="mt-4 rounded-[8px] border border-border-weak-base bg-background-base p-4"
            classList={{ hidden: activeTab() !== "history" }}
          >
            <div class="flex items-center gap-2 text-14-medium text-text-strong">
              <Icon name="task" size="small" />
              运行历史
            </div>
            <div class="mt-3 flex flex-col gap-2">
              <For each={runs()?.slice(0, 6) ?? []}>
                {(run) => (
                  <div class="flex items-center justify-between gap-3 rounded-[8px] border border-border-weaker-base bg-background-base p-3">
                    <div class="min-w-0">
                      <div class="truncate text-12-medium text-text-strong">
                        {run.output ?? run.workflowId ?? run.scheduleId ?? "办公任务"}
                      </div>
                      <div class="mt-0.5 text-11-regular text-text-weak">
                        {new Date(run.startedAt).toLocaleString()} · {run.status}
                      </div>
                      <Show when={run.logs?.length}>
                        <div class="mt-1 line-clamp-2 text-11-regular text-text-muted">{run.logs?.join(" · ")}</div>
                      </Show>
                      <Show when={run.error}>
                        <div class="mt-1 line-clamp-2 text-11-regular text-rose-200">{run.error}</div>
                      </Show>
                    </div>
                    <Show when={run.status === "completed"}>
                      <Icon name="circle-check" size="small" />
                    </Show>
                  </div>
                )}
              </For>

              <div class="mt-4 border-t border-border-weak-base pt-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-12-medium text-text-strong">产物版本</div>
                  <div class="text-11-regular text-text-weak">{artifacts()?.length ?? 0} 个已版本化文件</div>
                </div>
                <div class="mt-2 flex flex-col gap-2">
                  <For each={artifacts()?.slice(0, 6) ?? []}>
                    {(artifact) => (
                      <div class="flex items-center justify-between gap-3 rounded-[8px] border border-border-weaker-base bg-background-base p-2.5">
                        <div class="min-w-0">
                          <div class="truncate text-12-medium text-text-strong">{artifact.name}</div>
                          <div class="mt-0.5 truncate text-11-regular text-text-weak">
                            v{artifact.version} · {artifact.path}
                          </div>
                        </div>
                        <button
                          type="button"
                          class="grid size-8 shrink-0 place-items-center rounded-[7px] border border-border-weak-base text-text-weak hover:text-emerald-200"
                          title="恢复此版本"
                          onClick={() => void restoreArtifact(artifact.id)}
                        >
                          <Icon name="arrow-undo-down" size="small" />
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </section>
  )
}
