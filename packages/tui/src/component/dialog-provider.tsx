import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "../context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@novaway/sdk-v2-latest/v2"
import { DialogModel } from "./dialog-model"
import { useToast } from "../ui/toast"
import { isConsoleManagedProvider } from "../util/provider-origin"
import { useConnected } from "./use-connected"
import { useBindings } from "../keymap"
import { useClipboard } from "../context/clipboard"

const PROVIDER_PRIORITY: Record<string, number> = {
  NovaWay: 0,
  "NovaWay-go": 1,
  sensenova: 2,
  modelscope: 3,
  iflowcn: 4,
  openrouter: 5,
  zhipuai: 6,
  agnes: 7,
  google: 8,
  groq: 9,
  nvidia: 10,
  kilo: 11,
  "siliconflow-cn": 12,
  openai: 13,
  "github-copilot": 14,
  anthropic: 15,
}

// 免费通道的「免费性质」决定了徽章措辞：
// - 免费：模型定价就是 0
// - 限速免费：key 的免费层限速可用，模型本身有标价（Gemini、Groq）
// - 免费额度：注册送固定次数，用完转付费（NVIDIA NIM）
// 徽章只出现在接入引导里；模型选择器的免费标记仍以价格为准。
type FreeBadge = "免费" | "限速免费" | "免费额度"

// 有免费档的供应商策展：用户粘一个 key 就能直接用上一批免费模型。
// 免费政策随时会变，文案写「亮点」别写死承诺；keyUrl 只放稳定的官网/控制台入口。
// 数据核对日期：2026-09（来源 models.dev 目录 + 各家官方说明 + 厂商 live 接口实测）。
const FREE_PROVIDERS: Record<
  string,
  { badge: FreeBadge; tagline: string; keyUrl: string; keyHint: string; steps: string[] }
> = {
  sensenova: {
    badge: "免费",
    tagline: "免费模型最多：GLM-5.2、DeepSeek-V4-Pro、Kimi-K3 等",
    keyUrl: "https://platform.sensenova.cn",
    keyHint: "platform.sensenova.cn",
    steps: ["注册商汤开放平台账号，在控制台的「API 密钥」页面创建密钥"],
  },
  modelscope: {
    badge: "免费",
    tagline: "海量开源模型每日免费额度：Qwen3、DeepSeek、GLM 等全系",
    keyUrl: "https://modelscope.cn/my/myaccesstoken",
    keyHint: "modelscope.cn → 访问令牌",
    steps: ["注册魔搭社区账号，在「访问令牌」页面一键复制 API-KEY"],
  },
  iflowcn: {
    badge: "免费",
    tagline: "全部免费：Qwen3-Coder-Plus、GLM-4.6、Kimi-K2、DeepSeek-V3.2",
    keyUrl: "https://iflow.cn",
    keyHint: "iflow.cn",
    steps: ["注册心流账号，在个人中心的 API 密钥页面创建密钥"],
  },
  openrouter: {
    badge: "免费",
    tagline: "21 个免费模型（认准 :free 后缀），每天 50 次",
    keyUrl: "https://openrouter.ai/settings/keys",
    keyHint: "openrouter.ai → Keys",
    steps: ["注册 OpenRouter 后创建 API Key；充值 $10 可把免费额度提到 1000 次/天"],
  },
  zhipuai: {
    badge: "免费",
    tagline: "GLM-4.7-Flash / GLM-4.5-Flash / GLM-4-Flash 免费，写码够用",
    keyUrl: "https://open.bigmodel.cn",
    keyHint: "open.bigmodel.cn",
    steps: ["注册智谱开放平台，在「API 密钥」页面创建密钥"],
  },
  agnes: {
    badge: "免费",
    tagline: "Agnes-2.5-Flash / Agnes-2.0-Flash 免费",
    keyUrl: "https://www.agnes-ai.com",
    keyHint: "agnes-ai.com",
    steps: ["注册 Agnes AI，在 API Hub 创建密钥"],
  },
  google: {
    badge: "限速免费",
    tagline: "免费档限速：Gemini Flash 系列每天 250～1000 次，无需信用卡",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "aistudio.google.com → API 密钥",
    steps: ["打开 Google AI Studio，一键创建 API 密钥（免费档的对话数据会用于模型改进）"],
  },
  groq: {
    badge: "限速免费",
    tagline: "免费档速度极快：Llama 3.3 70B 等每天上万次请求",
    keyUrl: "https://console.groq.com/keys",
    keyHint: "console.groq.com → API Keys",
    steps: ["打开 Groq 控制台注册并创建 API Key"],
  },
  nvidia: {
    badge: "免费额度",
    tagline: "注册送 1000 次推理额度，用完转付费：Llama、Nemotron、DeepSeek 等 80+ 模型",
    keyUrl: "https://build.nvidia.com",
    keyHint: "build.nvidia.com",
    steps: ["打开 build.nvidia.com 注册登录，在任意模型页点「Get API Key」创建密钥"],
  },
  kilo: {
    badge: "免费",
    tagline: "聚合网关免费池：MiniMax-M3、Nemotron、Ling 等 17+ 免费模型",
    keyUrl: "https://www.kilo.ai",
    keyHint: "kilo.ai",
    steps: ["注册 Kilo，在控制台创建 API Key"],
  },
  "siliconflow-cn": {
    badge: "免费",
    tagline: "部分模型永久免费：Qwen3.5-4B、DeepSeek-OCR 等，注册另送体验额度",
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
    keyHint: "cloud.siliconflow.cn → API 密钥",
    steps: ["注册硅基流动，在「API 密钥」页面新建密钥"],
  },
}

const CUSTOM_PROVIDER_OPTION_VALUE = "__NovaWay_custom_provider__"
const CUSTOM_PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

type ProviderOptionBase = {
  title: string
  value: string
  description?: string
  category: string
}

type ProviderOption =
  | (ProviderOptionBase & {
      type: "provider"
      providerID: string
    })
  | (ProviderOptionBase & {
      type: "custom"
    })

export function providerOptions(list: { id: string; name: string }[]): ProviderOption[] {
  return [
    ...pipe(
      list,
      sortBy(
        (x) => PROVIDER_PRIORITY[x.id] ?? 99,
        (x) => x.name.toLowerCase(),
        (x) => x.id,
      ),
      map((provider) => {
        const free = FREE_PROVIDERS[provider.id]
        return {
          type: "provider" as const,
          title: provider.name,
          value: provider.id,
          providerID: provider.id,
          description: free
            ? `（${free.badge}）${free.tagline}`
            : {
                NovaWay: "(推荐)",
                anthropic: "(API 密钥)",
                openai: "(ChatGPT Plus/Pro 或 API 密钥)",
                "NovaWay-go": "低成本订阅，适合所有人",
              }[provider.id],
          category: free ? "免费接入" : provider.id in PROVIDER_PRIORITY ? "热门" : "提供商",
        }
      }),
    ),
    {
      type: "custom",
      title: "其他",
      value: CUSTOM_PROVIDER_OPTION_VALUE,
      description: "自定义提供商",
      category: "提供商",
    },
  ]
}

export function normalizeCustomProviderID(value: string) {
  const providerID = value.trim().replace(/^@ai-sdk\//, "")
  if (!CUSTOM_PROVIDER_ID.test(providerID)) return
  return providerID
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const onboarded = useConnected()

  async function promptCustomProviderID(): Promise<string | undefined> {
    const value = await DialogPrompt.show(dialog, "其他", {
      placeholder: "提供商 ID",
      description: () => (
        <text fg={theme.textMuted}>
          这只会存储一个凭据。请在 NovaWay.json 中配置提供商以使用它。
        </text>
      ),
    })
    if (value === null) return

    const providerID = normalizeCustomProviderID(value)
    if (providerID) return providerID

    toast.show({
      variant: "error",
      message:
        "提供商 ID 必须以小写字母或数字开头，且仅使用小写字母、数字、连字符和下划线",
    })
    return promptCustomProviderID()
  }

  const options = createMemo(() => {
    return pipe(
      providerOptions(sync.data.provider_next.all),
      map((provider) => {
        if (provider.type === "custom") {
          return {
            title: provider.title,
            value: provider.value,
            description: provider.description,
            category: provider.category,
            async onSelect() {
              const providerID = await promptCustomProviderID()
              if (!providerID) return
              return dialog.replace(() => <ApiMethod providerID={providerID} title="API 密钥" custom />)
            },
          }
        }

        const providerID = provider.providerID
        const consoleManaged = isConsoleManagedProvider(sync.data.console_state.consoleManagedProviders, providerID)
        const connected = sync.data.provider_next.connected.includes(providerID)

        return {
          title: provider.title,
          value: provider.value,
          description: provider.description,
          footer: consoleManaged ? sync.data.console_state.activeOrgName : undefined,
          category: provider.category,
          gutter: connected && onboarded() ? () => <text fg={theme.success}>✓</text> : undefined,
          async onSelect() {
            if (consoleManaged) return

            const methods = sync.data.provider_auth[providerID] ?? [
              {
                type: "api",
                label: "API 密钥",
              },
            ]
            let index: number | null = 0
            if (methods.length > 1) {
              index = await new Promise<number | null>((resolve) => {
                dialog.replace(
                  () => (
                    <DialogSelect
                      title="选择认证方式"
                      options={methods.map((x, index) => ({
                        title: x.label,
                        value: index,
                      }))}
                      onSelect={(option) => resolve(option.value)}
                    />
                  ),
                  () => resolve(null),
                )
              })
            }
            if (index == null) return
            const method = methods[index]
            if (method.type === "oauth") {
              let inputs: Record<string, string> | undefined
              if (method.prompts?.length) {
                const value = await PromptsMethod({
                  dialog,
                  prompts: method.prompts,
                })
                if (!value) return
                inputs = value
              }

              const result = await sdk.client.provider.oauth.authorize({
                providerID,
                method: index,
                inputs,
              })
              if (result.error) {
                toast.show({
                  variant: "error",
                  message: JSON.stringify(result.error),
                })
                dialog.clear()
                return
              }
              if (result.data?.method === "code") {
                dialog.replace(() => (
                  <CodeMethod providerID={providerID} title={method.label} index={index} authorization={result.data!} />
                ))
              }
              if (result.data?.method === "auto") {
                dialog.replace(() => (
                  <AutoMethod providerID={providerID} title={method.label} index={index} authorization={result.data!} />
                ))
              }
            }
            if (method.type === "api") {
              let metadata: Record<string, string> | undefined
              if (method.prompts?.length) {
                const value = await PromptsMethod({ dialog, prompts: method.prompts })
                if (!value) return
                metadata = value
              }
              return dialog.replace(() => (
                <ApiMethod providerID={providerID} title={method.label} metadata={metadata} />
              ))
            }
          },
        }
      }),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="连接提供商" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const clipboard = useClipboard()

  useBindings(() => ({
    bindings: [
      {
        key: "c",
        desc: "复制提供商代码",
        group: "对话框",
        cmd: () => {
          const code =
            props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
          clipboard
            .write?.(code)
            .then(() => toast.show({ message: "已复制到剪贴板", variant: "info" }))
            .catch(toast.error)
        },
      },
    ],
  }))

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      toast.show({
        variant: "error",
        message:
          "name" in result.error && result.error.name === "ProviderAuthOauthCallbackFailed"
            ? "OAuth authorization failed. Try /connect again."
            : JSON.stringify(result.error),
      })
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>等待授权中...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>复制</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="授权码"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
  metadata?: Record<string, string>
  custom?: boolean
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API 密钥"
      description={() => {
        const free = FREE_PROVIDERS[props.providerID]
        if (free) {
          return (
            <box gap={1}>
              <text fg={theme.textMuted}>{free.tagline}</text>
              <text fg={theme.text}>获取密钥：打开 {free.keyHint}</text>
              <text fg={theme.textMuted}>{free.steps.join("；")}</text>
            </box>
          )
        }
        return (
          ({
            NovaWay: (
              <box gap={1}>
                <text fg={theme.textMuted}>
                  NovaWay Zen gives you access to all the best coding models at the cheapest prices with a single API
                  key.
                </text>
                <text fg={theme.text}>
                  Go to <span style={{ fg: theme.primary }}>https://NovaWay.ai/zen</span> to get a key
                </text>
              </box>
            ),
            "NovaWay-go": (
              <box gap={1}>
                <text fg={theme.textMuted}>
                  NovaWay Go is a $10 per month subscription that provides reliable access to popular open coding models
                  with generous usage limits.
                </text>
                <text fg={theme.text}>
                  Go to <span style={{ fg: theme.primary }}>https://NovaWay.ai/go</span> and enable NovaWay Go
                </text>
              </box>
            ),
          })[props.providerID]
        )
      }}
      onConfirm={async (value) => {
        if (!value) return
        await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
            ...(props.metadata ? { metadata: props.metadata } : {}),
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        if (props.custom && !sync.data.provider_next.all.some((provider) => provider.id === props.providerID)) {
          toast.show({
            variant: "info",
            message: `Saved credential for ${props.providerID}. Configure it in NovaWay.json to use it.`,
          })
          dialog.clear()
          return
        }
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}

interface PromptsMethodProps {
  dialog: ReturnType<typeof useDialog>
  prompts: NonNullable<ProviderAuthMethod["prompts"]>[number][]
}
async function PromptsMethod(props: PromptsMethodProps) {
  const inputs: Record<string, string> = {}
  for (const prompt of props.prompts) {
    if (prompt.when) {
      const value = inputs[prompt.when.key]
      if (value === undefined) continue
      const matches = prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
      if (!matches) continue
    }

    if (prompt.type === "select") {
      const value = await new Promise<string | null>((resolve) => {
        props.dialog.replace(
          () => (
            <DialogSelect
              title={prompt.message}
              options={prompt.options.map((x) => ({
                title: x.label,
                value: x.value,
                description: x.hint,
              }))}
              onSelect={(option) => resolve(option.value)}
            />
          ),
          () => resolve(null),
        )
      })
      if (value === null) return null
      inputs[prompt.key] = value
      continue
    }

    const value = await new Promise<string | null>((resolve) => {
      props.dialog.replace(
        () => (
          <DialogPrompt title={prompt.message} placeholder={prompt.placeholder} onConfirm={(value) => resolve(value)} />
        ),
        () => resolve(null),
      )
    })
    if (value === null) return null
    inputs[prompt.key] = value
  }
  return inputs
}
