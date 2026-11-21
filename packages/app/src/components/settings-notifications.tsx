import type { Config } from "@novaway/sdk/v2/client"
import { useMutation } from "@tanstack/solid-query"
import { Component, For, Show, createEffect, createMemo, createResource, createSignal, type JSX } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { Switch } from "@novaway/ui/switch"
import { showToast } from "@novaway/ui/toast"
import { writeClipboard } from "@novaway/ui/util/clipboard"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { FeishuAppSetupGuide } from "./feishu-app-setup-guide"
import { SettingsGroup, SettingsNumberField } from "./settings-parts"

const channelKindLabels: Record<string, string> = {
  feishu: "飞书",
  telegram: "Telegram",
  dingtalk: "钉钉",
  wecom: "企业微信",
  slack: "Slack",
}

// 与其它设置页保持同一种行式布局：左侧标题 + 说明，右侧控件。
function SettingsRow(props: {
  title: JSX.Element | string
  description: string
  children: JSX.Element
  disabled?: boolean
}) {
  return (
    <div
      data-row-hover
      class="group border-t border-border/80 px-4 py-4 transition-colors first:border-t-0 hover:bg-hover/40"
    >
      <div class="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div class="min-w-0">
          <div class="text-13-medium text-foreground">{props.title}</div>
          <div class="mt-0.5 text-12-regular leading-5 text-foreground-subtle">{props.description}</div>
        </div>
        <div
          class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end"
          classList={{ "opacity-50": props.disabled }}
        >
          {props.children}
        </div>
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
        class="shrink-0 cursor-help text-foreground-subtle outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Icon name="help" size="small" />
      </span>
      <Show when={open()}>
        <span aria-hidden="true" class="absolute left-0 top-full h-2 w-72" />
        <span
          class="absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-lg border border-border-hover bg-popover p-3 text-left"
          style={{ "box-shadow": "0 18px 44px color-mix(in srgb, var(--text-strong) 20%, transparent)" }}
        >
          <span class="block text-11-regular leading-relaxed text-foreground-subtle">
            打开飞书开放平台，创建「企业自建应用」。进入「凭证与基础信息」复制 App ID 和 App
            Secret，然后在「添加应用能力」中添加机器人，申请 im:message.p2p_msg:readonly、im:message:send_as_bot
            权限，并订阅 im.message.receive_v1，事件订阅方式选择长连接。
          </span>
          <span class="mt-2 flex items-center gap-2 rounded-lg border border-border bg-background transition-colors focus-visible:border-interactive-focus focus-visible:outline-none p-2">
            <code class="min-w-0 flex-1 truncate text-11-regular text-foreground">{link}</code>
            <button
              type="button"
              class="h-7 shrink-0 rounded-md border border-border bg-surface px-2 text-10-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
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
              class="mt-2 flex items-center gap-1.5 rounded-lg border border-success-base/30 bg-surface-success-weak px-2 py-1.5 text-11-medium text-success-base"
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
  const globalSync = useGlobalSync()
  const channels = createMemo(() => globalSync.data.config.channels ?? {})
  const channelInstances = createMemo(() => channels().channels ?? [])
  const channelMaxRestarts = createMemo(() => {
    const value = channels().max_restarts
    return typeof value === "number" ? value : undefined
  })
  const saveChannels = useMutation(() => ({
    mutationFn: (config: Config) => globalSync.updateConfig(config),
    onError: (err) =>
      showToast({
        title: "保存失败",
        description: err instanceof Error ? err.message : String(err),
      }),
  }))
  const updateChannels = (patch: Partial<NonNullable<Config["channels"]>>) =>
    saveChannels.mutate({ channels: { ...channels(), ...patch } } as Config)
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
    <div class="mx-auto flex h-full w-full max-w-[1040px] flex-col gap-5 overflow-y-auto px-4 pb-10 pt-8 sm:px-8 lg:px-10">
      <header class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--popover)_calc(100%_-_24px),transparent)] pb-2">
        <h2 class="text-24-semibold tracking-tight text-foreground">消息通知</h2>
        <p class="mt-1 text-12-regular leading-relaxed text-foreground-subtle">
          把 NovaWay 的通知转发到外部消息通道（飞书、Telegram、钉钉、企业微信、Slack）。
        </p>
      </header>

      <div class="flex flex-col gap-1">
        <h3 class="pb-2 text-14-medium text-foreground">飞书连接配置</h3>
        <FeishuAppSetupGuide />
        <SettingsGroup>
          <SettingsRow title="Webhook 地址" description="填写飞书自定义机器人 Webhook，保存后会同步到办公平台连接器。">
            <input
              value={feishuWebhookDraft()}
              onInput={(event) => setFeishuWebhookDraft(event.currentTarget.value)}
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
              class="h-9 w-full min-w-0 rounded-lg border border-border bg-background transition-colors focus-visible:border-interactive-focus focus-visible:outline-none px-3 text-12-regular text-foreground outline-none sm:w-[300px]"
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
              class="h-9 w-full min-w-0 rounded-lg border border-border bg-background transition-colors focus-visible:border-interactive-focus focus-visible:outline-none px-3 text-12-regular text-foreground outline-none sm:w-[160px]"
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
              class="h-9 w-full min-w-0 rounded-lg border border-border bg-background transition-colors focus-visible:border-interactive-focus focus-visible:outline-none px-3 text-12-regular text-foreground outline-none sm:w-[300px]"
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
              class="h-9 w-full min-w-0 rounded-lg border border-border bg-background transition-colors focus-visible:border-interactive-focus focus-visible:outline-none px-3 text-12-regular text-foreground outline-none sm:w-[300px]"
            />
          </SettingsRow>
          <SettingsRow
            title="飞书用户绑定状态"
            description="先保存 App ID 和 App Secret，再前往飞书给机器人发一条任意消息，NovaWay 会自动绑定你的用户 ID。"
          >
            <div class="flex items-center gap-2">
              <span class="text-12-regular text-foreground-subtle">
                {connectorConfig()?.feishuUserId ? "已绑定" : pollingBinding() ? "等待消息..." : "未绑定"}
              </span>
              <button
                type="button"
                class="h-9 rounded-lg border border-border bg-surface px-3 text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
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
              class="flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
              onClick={() => void saveFeishuConfig()}
            >
              保存配置
            </button>
          </SettingsRow>
        </SettingsGroup>
      </div>

      <div class="flex flex-col gap-1">
        <h3 class="pb-2 text-14-medium text-foreground">飞书通知</h3>
        <SettingsGroup>
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
        </SettingsGroup>
      </div>

      <div class="flex flex-col gap-1">
        <h3 class="pb-2 text-14-medium text-foreground">连通测试</h3>
        <SettingsGroup>
          <SettingsRow
            title="发送测试消息"
            description="向已配置的飞书群发送一条 NovaWay 测试消息，验证 Webhook 是否可用。"
            disabled={!feishuConnected() || testing()}
          >
            <button
              type="button"
              class="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-11-medium text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
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
        </SettingsGroup>
      </div>

      <div class="flex flex-col gap-1">
        <h3 class="pb-2 text-14-medium text-foreground">外部通道</h3>
        <SettingsGroup>
          <SettingsRow
            title="启用外部通道"
            description={
              channelInstances().length === 0
                ? "配置中还没有登记通道实例；先在配置文件里添加 channels.channels。"
                : `已登记 ${channelInstances().length} 个实例。关闭后所有通道停止收发消息。`
            }
            disabled={channelInstances().length === 0 || saveChannels.isPending}
          >
            <Switch
              checked={channels().enabled === true}
              disabled={saveChannels.isPending || channelInstances().length === 0}
              onChange={(value) => updateChannels({ enabled: value })}
            />
          </SettingsRow>
          <SettingsRow
            title="失败重启次数"
            description="单个通道连续失败达到上限后标记为 failed，不再自动重启。"
            disabled={channels().enabled !== true || saveChannels.isPending}
          >
            <SettingsNumberField
              value={channelMaxRestarts()}
              fallback={3}
              min={0}
              disabled={saveChannels.isPending || channels().enabled !== true}
              onSave={(value) => updateChannels({ max_restarts: value })}
            />
          </SettingsRow>
          <Show
            when={channelInstances().length > 0}
            fallback={
              <SettingsRow
                title="已登记实例"
                description="还没有通道实例。在配置文件的 channels.channels 中添加后，这里会显示只读概览。"
              >
                <span class="text-12-regular text-foreground-subtlest">无</span>
              </SettingsRow>
            }
          >
            <For each={channelInstances()}>
              {(channel) => (
                <SettingsRow
                  title={
                    <span class="inline-flex items-center gap-2">
                      {channel.name}
                      <span class="rounded-md bg-surface px-1.5 py-0.5 text-11-regular text-foreground-subtle">
                        {channelKindLabels[channel.kind] ?? channel.kind}
                      </span>
                      <Show when={channel.enabled === false}>
                        <span class="text-11-regular text-foreground-subtlest">实例已单独关闭</span>
                      </Show>
                    </span>
                  }
                  description={
                    channel.secret_name
                      ? `凭据来自秘密存储：${channel.secret_name}`
                      : "凭据以明文写在配置中；建议改为 secret_name 引用秘密存储。"
                  }
                >
                  <span class="text-12-regular text-foreground-subtlest">
                    {channel.secret_name ? "已接入秘密存储" : "明文配置"}
                  </span>
                </SettingsRow>
              )}
            </For>
          </Show>
        </SettingsGroup>
        <div class="px-1 pt-2 text-12-regular leading-5 text-foreground-subtle">
          凭据不放设置页：在秘密存储中为每个通道建一条记录，用 channels.channels 的 secret_name
          指向它；需要回调的通道（钉钉 / 企业微信 / Slack）再配置 host、port 与 path。
        </div>
      </div>
    </div>
  )
}
