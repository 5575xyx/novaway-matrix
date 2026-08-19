import { Component, Show, createEffect, createMemo, createResource, createSignal, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { writeClipboard } from "@opencode-ai/ui/util/clipboard"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { FeishuAppSetupGuide } from "./feishu-app-setup-guide"
import { SettingsList } from "./settings-list"

function SettingsRow(props: {
  title: JSX.Element | string
  description: string
  children: JSX.Element
  disabled?: boolean
}) {
  return (
    <div class="flex items-center justify-between gap-4 border-b border-border-weak-base px-4 py-3 last:border-b-0">
      <div class="min-w-0">
        <div class="text-12-medium text-text-strong">{props.title}</div>
        <div class="mt-1 text-11-regular leading-relaxed text-text-weak">{props.description}</div>
      </div>
      <div class="shrink-0" classList={{ "opacity-50": props.disabled }}>
        {props.children}
      </div>
    </div>
  )
}

function FeishuAppHelpTip() {
  const platform = usePlatform()
  const [open, setOpen] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const link = "https://open.feishu.cn/app"

  function copyLink() {
    const copy = async () => {
      if (platform.writeTextToClipboard) {
        try {
          const copied = await platform.writeTextToClipboard(link)
          if (copied) return true
        } catch {
          // 继续使用页面级复制兜底
        }
      }
      return writeClipboard(link)
    }
    void copy().then((copied) => {
      if (!copied) {
        showToast({ title: "复制失败", description: "请手动复制链接。" })
        return
      }
      setCopied(true)
      showToast({ title: "链接已复制", description: link })
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
          <span class="block text-11-regular leading-relaxed text-text-weak">
            打开飞书开放平台，创建「企业自建应用」。进入「凭证与基础信息」复制 App ID 和 App
            Secret，然后在「添加应用能力」中添加机器人，申请 im:message.p2p_msg:readonly、im:message:send_as_bot
            权限，并订阅 im.message.receive_v1，事件订阅方式选择长连接。
          </span>
          <span class="mt-2 flex items-center gap-2 rounded-[7px] border border-border-weak-base bg-background-base p-2">
            <code class="min-w-0 flex-1 truncate text-11-regular text-text-strong">{link}</code>
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

export const SettingsNotifications: Component = () => {
  const settings = useSettings()
  const globalSDK = useGlobalSDK()
  const [connectors, { refetch: refetchConnectors }] = createResource(() =>
    globalSDK.client.office.platform.connector.list().then((result) => result.data ?? []),
  )
  const [connectorConfig, { refetch: refetchConnectorConfig }] = createResource(() =>
    globalSDK.client.office.platform.connector.config.get().then((result) => result.data),
  )
  const feishu = createMemo(() => connectors()?.find((item) => item.id === "feishu"))
  const feishuConnected = createMemo(() => feishu()?.status === "connected")
  const [testing, setTesting] = createSignal(false)
  const [pollingBinding, setPollingBinding] = createSignal(false)
  const [feishuWebhookDraft, setFeishuWebhookDraft] = createSignal("")
  const [feishuKeywordDraft, setFeishuKeywordDraft] = createSignal("NovaWay")
  const [feishuAppIdDraft, setFeishuAppIdDraft] = createSignal("")
  const [feishuAppSecretDraft, setFeishuAppSecretDraft] = createSignal("")

  createEffect(() => {
    const config = connectorConfig()
    if (!config) return
    setFeishuWebhookDraft(config.feishuWebhookUrl ?? "")
    setFeishuKeywordDraft(config.feishuKeyword?.trim() || "NovaWay")
    setFeishuAppIdDraft(config.feishuAppId ?? "")
    setFeishuAppSecretDraft(config.feishuAppSecret ?? "")
  })

  async function saveFeishuConfig() {
    const webhook = feishuWebhookDraft().trim()
    const appId = feishuAppIdDraft().trim()
    const appSecret = feishuAppSecretDraft().trim()
    if (!webhook && (!appId || !appSecret)) {
      showToast({ title: "保存失败", description: "请填写飞书 Webhook 或企业自建应用配置。" })
      return
    }
    await globalSDK.client.office.platform.connector.config.update({
      feishuWebhookUrl: webhook,
      feishuKeyword: feishuKeywordDraft().trim() || "NovaWay",
      feishuAppId: appId || undefined,
      feishuAppSecret: appSecret || undefined,
      feishuUserId: connectorConfig()?.feishuUserId || undefined,
    })
    void refetchConnectorConfig()
    void refetchConnectors()
    showToast({ title: "飞书配置已保存", description: "办公平台连接器会同步显示已配置。" })
    if (appId && appSecret && !connectorConfig()?.feishuUserId) {
      showToast({ title: "请去飞书给机器人发消息", description: "发送任意一条消息后，NovaWay 会自动完成绑定。" })
      void pollFeishuBinding()
    }
  }

  async function pollFeishuBinding() {
    setPollingBinding(true)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const config = await globalSDK.client.office.platform.connector.config
        .get()
        .then((result) => result.data)
        .catch(() => undefined)
      if (config?.feishuUserId) {
        void refetchConnectorConfig()
        void refetchConnectors()
        showToast({ title: "飞书用户已绑定", description: "现在可以在飞书里回复 NovaWay 通知。" })
        setPollingBinding(false)
        return
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
    }
    setPollingBinding(false)
    showToast({
      title: "尚未绑定",
      description: "请确认已保存配置，并前往飞书给刚才创建的机器人发送任意消息。",
    })
  }

  async function refreshFeishuBinding() {
    void refetchConnectorConfig()
    void refetchConnectors()
    const config = await globalSDK.client.office.platform.connector.config
      .get()
      .then((result) => result.data)
      .catch(() => undefined)
    if (config?.feishuUserId) {
      showToast({ title: "飞书用户已绑定", description: "绑定状态已刷新。" })
      return
    }
    showToast({
      title: "尚未绑定",
      description: "请先保存 App ID 和 App Secret，然后去飞书给机器人发送任意消息。",
    })
  }

  const enabled = () => settings.notifications.feishu.enabled()
  const onlyWhenUnfocused = () => settings.notifications.feishu.onlyWhenUnfocused()
  const agent = () => settings.notifications.feishu.agent()
  const permissions = () => settings.notifications.feishu.permissions()
  const errors = () => settings.notifications.feishu.errors()
  const questions = () => settings.notifications.feishu.questions()

  async function sendTestMessage() {
    setTesting(true)
    try {
      const keyword = feishuKeywordDraft().trim() || "NovaWay"
      await globalSDK.client.office.platform.connector.action({
        id: "feishu",
        action: "send_message",
        arguments: { text: `${keyword}：这是一条飞书消息通知连通测试` },
      })
      showToast({ title: "飞书测试消息已发送", description: "请到飞书群中确认是否收到。" })
    } catch {
      showToast({ title: "飞书发送失败", description: "请检查飞书 Webhook 和机器人安全设置。" })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div>
        <h2 class="text-16-medium text-text-strong">消息通知</h2>
        <p class="mt-1 text-12-regular leading-relaxed text-text-weak">
          将 NovaWay 的通知转发到飞书群，后续可在这里继续扩展其他通知渠道。
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <h3 class="pb-2 text-14-medium text-text-strong">飞书连接配置</h3>
        <FeishuAppSetupGuide />
        <SettingsList>
          <SettingsRow title="Webhook 地址" description="填写飞书自定义机器人 Webhook，保存后会同步到办公平台连接器。">
            <input
              value={feishuWebhookDraft()}
              onInput={(event) => setFeishuWebhookDraft(event.currentTarget.value)}
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
              class="h-9 w-full min-w-0 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none sm:w-[300px]"
            />
          </SettingsRow>
          <SettingsRow
            title="自定义关键词"
            description="默认 NovaWay。飞书机器人开启自定义关键词时，这里必须和机器人里填写的完全一致。"
          >
            <input
              value={feishuKeywordDraft()}
              onInput={(event) => setFeishuKeywordDraft(event.currentTarget.value)}
              placeholder="默认 NovaWay"
              class="h-9 w-full min-w-0 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none sm:w-[160px]"
            />
          </SettingsRow>
          <SettingsRow
            title={
              <span class="inline-flex items-center gap-1">
                企业自建应用 App ID
                <FeishuAppHelpTip />
              </span>
            }
            description="在飞书开放平台创建企业自建应用后填写。配置后可让 NovaWay 在飞书内回复你并继续对应会话。"
          >
            <input
              value={feishuAppIdDraft()}
              onInput={(event) => setFeishuAppIdDraft(event.currentTarget.value)}
              placeholder="cli_..."
              class="h-9 w-full min-w-0 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none sm:w-[300px]"
            />
          </SettingsRow>
          <SettingsRow
            title={
              <span class="inline-flex items-center gap-1">
                企业自建应用 App Secret
                <FeishuAppHelpTip />
              </span>
            }
            description="请从飞书开放平台的凭证与基础信息中复制，保存后用于长连接接收飞书回复。"
          >
            <input
              type="password"
              value={feishuAppSecretDraft()}
              onInput={(event) => setFeishuAppSecretDraft(event.currentTarget.value)}
              placeholder="请输入 App Secret"
              class="h-9 w-full min-w-0 rounded-[7px] border border-border-weak-base bg-background-base px-3 text-12-regular text-text-strong outline-none sm:w-[300px]"
            />
          </SettingsRow>
          <SettingsRow
            title="飞书用户绑定状态"
            description="先保存 App ID 和 App Secret，再前往飞书给机器人发一条任意消息，NovaWay 会自动绑定你的用户 ID。"
          >
            <div class="flex items-center gap-2">
              <span class="text-12-regular text-text-weak">
                {connectorConfig()?.feishuUserId ? "已绑定" : pollingBinding() ? "等待消息..." : "未绑定"}
              </span>
              <button
                type="button"
                class="h-9 rounded-[7px] border border-border-weak-base px-3 text-11-medium text-text-weak transition-all duration-150 hover:-translate-y-px hover:border-emerald-300/50 hover:text-emerald-100"
                disabled={pollingBinding()}
                classList={{ "opacity-50": pollingBinding() }}
                onClick={() => void refreshFeishuBinding()}
              >
                刷新绑定状态
              </button>
            </div>
          </SettingsRow>
          <SettingsRow title="保存飞书配置" description="保存后，办公平台连接器会同步显示已配置。">
            <button
              type="button"
              class="flex h-9 items-center rounded-[7px] border border-emerald-300/45 bg-emerald-300/10 px-3 text-11-medium text-emerald-100 transition-all duration-150 hover:-translate-y-px hover:bg-emerald-300/20 hover:shadow-[0_8px_20px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-95"
              onClick={() => void saveFeishuConfig()}
            >
              保存配置
            </button>
          </SettingsRow>
        </SettingsList>
      </div>

      <div class="flex flex-col gap-1">
        <h3 class="pb-2 text-14-medium text-text-strong">飞书通知</h3>
        <SettingsList>
          <SettingsRow
            title="启用飞书消息通知"
            description={
              feishuConnected()
                ? "已检测到飞书已连接，可开始转发 NovaWay 消息通知。"
                : "飞书尚未连接，请先在办公平台连接器或上方配置飞书。"
            }
          >
            <Switch
              checked={enabled()}
              disabled={!feishuConnected()}
              onChange={(value) => settings.notifications.feishu.setEnabled(value)}
            />
          </SettingsRow>
          <SettingsRow
            title="仅在窗口不在前台时转发"
            description="开启后，只有 NovaWay 不在前台时才发送飞书通知，避免重复打扰。"
            disabled={!enabled()}
          >
            <Switch
              checked={onlyWhenUnfocused()}
              disabled={!enabled()}
              onChange={(value) => settings.notifications.feishu.setOnlyWhenUnfocused(value)}
            />
          </SettingsRow>
          <SettingsRow title="Agent 回复完成" description="Agent 完成一次回复后发送飞书通知。" disabled={!enabled()}>
            <Switch
              checked={agent()}
              disabled={!enabled()}
              onChange={(value) => settings.notifications.feishu.setAgent(value)}
            />
          </SettingsRow>
          <SettingsRow
            title="任务执行出错"
            description="Agent 回复或任务执行出现错误时发送飞书通知。"
            disabled={!enabled()}
          >
            <Switch
              checked={errors()}
              disabled={!enabled()}
              onChange={(value) => settings.notifications.feishu.setErrors(value)}
            />
          </SettingsRow>
          <SettingsRow
            title="权限确认"
            description="Agent 需要执行高权限操作、等待确认时发送飞书通知。"
            disabled={!enabled()}
          >
            <Switch
              checked={permissions()}
              disabled={!enabled()}
              onChange={(value) => settings.notifications.feishu.setPermissions(value)}
            />
          </SettingsRow>
          <SettingsRow title="收到问题" description="Agent 向你提问、等待回答时发送飞书通知。" disabled={!enabled()}>
            <Switch
              checked={questions()}
              disabled={!enabled()}
              onChange={(value) => settings.notifications.feishu.setQuestions(value)}
            />
          </SettingsRow>
        </SettingsList>
      </div>

      <div class="flex flex-col gap-1">
        <h3 class="pb-2 text-14-medium text-text-strong">连通测试</h3>
        <SettingsList>
          <SettingsRow
            title="发送测试消息"
            description="向已配置的飞书群发送一条 NovaWay 测试消息，验证 Webhook 是否可用。"
            disabled={!feishuConnected() || testing()}
          >
            <button
              type="button"
              class="flex h-9 items-center gap-1.5 rounded-[7px] border border-emerald-300/45 bg-emerald-300/10 px-3 text-11-medium text-emerald-100 transition-all duration-150 hover:-translate-y-px hover:bg-emerald-300/20 hover:shadow-[0_8px_20px_rgba(16,185,129,0.12)] active:translate-y-0 active:scale-95"
              disabled={!feishuConnected() || testing()}
              classList={{ "opacity-50": !feishuConnected() || testing() }}
              onClick={() => void sendTestMessage()}
            >
              <Show when={!testing()}>
                <Icon name="paper-plane" size="small" />
              </Show>
              {testing() ? "测试中..." : "发送测试消息"}
            </button>
          </SettingsRow>
        </SettingsList>
      </div>
    </div>
  )
}
