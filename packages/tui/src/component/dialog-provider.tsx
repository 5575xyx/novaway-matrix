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
import { FREE_PROVIDER_RANK } from "@novaway/core/free-provider-policy"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@novaway/sdk-v2-latest/v2"
import { DialogModel } from "./dialog-model"
import { useToast } from "../ui/toast"
import { isConsoleManagedProvider } from "../util/provider-origin"
import { useConnected } from "./use-connected"
import { useBindings } from "../keymap"
import { useClipboard } from "../context/clipboard"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  "opencode-go": 1,
  sensenova: 2,
  modelscope: 3,
  openrouter: 4,
  zhipuai: 5,
  agnes: 6,
  google: 7,
  groq: 8,
  nvidia: 9,
  kilo: 10,
  "siliconflow-cn": 11,
  openai: 12,
  "github-copilot": 13,
  anthropic: 14,
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
  // 第一梯队：免费额度最大、最稳定（推荐）
  modelscope: {
    badge: "免费",
    tagline: "海量开源模型每日免费额度：Qwen3、DeepSeek、GLM 等全系",
    keyUrl: "https://modelscope.cn/my/myaccesstoken",
    keyHint: "modelscope.cn → 访问令牌",
    steps: ["注册魔搭社区账号，在「访问令牌」页面一键复制 API-KEY"],
  },  sensenova: {
    badge: "免费",
    tagline: "免费模型最多：GLM-5.2、DeepSeek-V4-Pro、Kimi-K3 等",
    keyUrl: "https://platform.sensenova.cn",
    keyHint: "platform.sensenova.cn",
    steps: ["注册商汤开放平台账号，在控制台的「API 密钥」页面创建密钥"],
  },
  openrouter: {
    badge: "免费",
    tagline: "21 个免费模型（认准 :free 后缀），每天 50 次",
    keyUrl: "https://openrouter.ai/settings/keys",
    keyHint: "openrouter.ai → Keys",
    steps: ["注册 OpenRouter 后创建 API Key；充值 $10 可把免费额度提到 1000 次/天"],
  },
  kilo: {
    badge: "免费",
    tagline: "聚合网关免费池：MiniMax-M3、Nemotron、Ling 等 17+ 免费模型",
    keyUrl: "https://www.kilo.ai",
    keyHint: "kilo.ai",
    steps: ["注册 Kilo，在控制台创建 API Key"],
  },
  requesty: {
    badge: "免费",
    tagline: "12 个免费档路由：Nemotron / Ling / Gemma / GPT-OSS 全免费",
    keyUrl: "https://requesty.ai",
    keyHint: "requesty.ai",
    steps: ["注册 Requesty，在 Keys 页面创建 API Key"],
  },
  inferx: {
    badge: "免费",
    tagline: "12 个免费档：Qwen3-Coder-Next FP8、DeepSeek、GLM 主力",
    keyUrl: "https://model.inferx.net",
    keyHint: "inferx.net",
    steps: ["注册 InferX，在控制台创建 API Key"],
  },
  unorouter: {
    badge: "免费",
    tagline: "11 个 :free 模型路由：DeepSeek / Qwen3.5 / GLM / Nemotron / GPT-5.5",
    keyUrl: "https://unorouter.com",
    keyHint: "unorouter.com",
    steps: ["注册 UnoRouter，在 Keys 页面创建 API Key"],
  },
  // vercel / kenari / kimi-for-coding 已删除（实测不能用的免费档）
  // 第二梯队：5-10 个免费模型的主力档
  qvac: {
    badge: "免费",
    tagline: "9 个全免费档：Qwen3.5/3.6、Gemma 4、GPT-OSS 20B/120B",
    keyUrl: "https://www.npmjs.com/package/@qvac/ai-sdk-provider",
    keyHint: "qvac.ai",
    steps: ["访问 QVAC 控制台注册并创建 API Key"],
  },
  zhipuai: {
    badge: "免费",
    tagline: "GLM-4.7-Flash / GLM-4.5-Flash / GLM-4-Flash 免费，写码够用",
    keyUrl: "https://open.bigmodel.cn",
    keyHint: "open.bigmodel.cn",
    steps: ["注册智谱开放平台，在「API 密钥」页面创建密钥"],
  },
  llama: {
    badge: "免费",
    tagline: "Meta Llama API：Llama 3.x / 4 全系列免费档",
    keyUrl: "https://llama.developer.meta.com",
    keyHint: "llama.developer.meta.com",
    steps: ["注册 Meta Developer，在 Llama API 页面创建 Key"],
  },
  zenmux: {
    badge: "免费",
    tagline: "7 个免费档路由：Kimi-K3 / Claude-Sonnet / GLM-5.2 / Step-3.7 全免费",
    keyUrl: "https://zenmux.ai",
    keyHint: "zenmux.ai",
    steps: ["注册 ZenMux，在控制台创建 API Key"],
  },
  nan: {
    badge: "免费",
    tagline: "7 个全免费档：GLM-5.3、Qwen3.6/3.8、DeepSeek-V4-Flash",
    keyUrl: "https://nan.builders",
    keyHint: "nan.builders",
    steps: ["注册 NaN，在控制台创建 API Key"],
  },
  pendra: {
    badge: "免费",
    tagline: "6 个全免费档：DeepSeek-V4-Flash / Qwen3-Coder / GLM-4.7-Flash",
    keyUrl: "https://pendra.ai",
    keyHint: "pendra.ai",
    steps: ["注册 Pendra，在控制台创建 API Key"],
  },
  orcarouter: {
    badge: "免费",
    tagline: "5 个 :free 模型路由：DeepSeek / Tencent-Hy3 / GLM-5.3-Flash",
    keyUrl: "https://docs.orcarouter.ai",
    keyHint: "orcarouter.ai",
    steps: ["注册 OrcaRouter，在控制台创建 API Key"],
  },
  agnes: {
    badge: "免费",
    tagline: "Agnes-2.5-Flash / Agnes-2.0-Flash 免费",
    keyUrl: "https://www.agnes-ai.com",
    keyHint: "agnes-ai.com",
    steps: ["注册 Agnes AI，在 API Hub 创建密钥"],
  },
  // 第三梯队：本地推理 / 试用档
  lmstudio: {
    badge: "免费",
    tagline: "本地推理：启动 LM Studio 自带的 OpenAI 兼容服务即可",
    keyUrl: "https://lmstudio.ai/models",
    keyHint: "lmstudio.ai",
    steps: ["下载 LM Studio，启动本地 OpenAI 兼容服务（默认 127.0.0.1:1234）"],
  },

  // iflowcn / kimi-for-coding / kenari / vercel 已删除（实测不能用的免费档）
  "atomic-chat": {
    badge: "免费",
    tagline: "本地推理：Atomic Chat 自带 OpenAI 兼容服务（127.0.0.1:1337）",
    keyUrl: "https://atomic.chat",
    keyHint: "atomic.chat",
    steps: ["下载 Atomic Chat，启动本地服务（默认 127.0.0.1:1337）"],
  },
  google: {
    badge: "限速免费",
    tagline: "免费档限速：Gemini Flash 系列每天 250～1000 次，无需信用卡",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "aistudio.google.com → API 密钥",
    steps: ["打开 Google AI Studio，一键创建 API 密钥（免费档的对话数据会用于模型改进）"],
  },
  groq: {
    badge: "免费额度",
    tagline: "⚠️ Groq 已下线免费档：Llama 3.1/3.3 改成 Enterprise only；GPT-OSS / Qwen 按 token 收费（最便宜 $0.075/1M），需绑卡",
    keyUrl: "https://console.groq.com/keys",
    keyHint: "console.groq.com → API Keys",
    steps: [
      "⚠️ Groq 当前没有真免费档，全部按 token 付费（GPT OSS 20B 最便宜 $0.075/1M）",
      "需要绑信用卡才能用，可考虑跳过",
    ],
  },
  nvidia: {
    badge: "免费额度",
    tagline: "注册送 1000 次推理额度，用完转付费：Llama、Nemotron、DeepSeek 等 80+ 模型",
    keyUrl: "https://build.nvidia.com",
    keyHint: "build.nvidia.com",
    steps: ["打开 build.nvidia.com 注册登录，在任意模型页点「Get API Key」创建密钥"],
  },
  aihubmix: {
    badge: "免费",
    tagline: "4 个国产免费档：MiMo-V2.5 / MiniMax-M2.7 / GLM-5.1",
    keyUrl: "https://docs.aihubmix.com",
    keyHint: "aihubmix.com",
    steps: ["注册 AIHubMix，在控制台创建 API Key"],
  },
  empiriolabs: {
    badge: "免费",
    tagline: "4 个全免费档：GLM-4.5/4.7/4.6v-Flash + Gemma-3-27B",
    keyUrl: "https://docs.empiriolabs.ai",
    keyHint: "empiriolabs.ai",
    steps: ["注册 EmpirioLabs，在控制台创建 API Key"],
  },
  poolside: {
    badge: "免费",
    tagline: "Poolside Laguna 主力免费档：XS/S/M 三档全免",
    keyUrl: "https://platform.poolside.ai",
    keyHint: "platform.poolside.ai",
    steps: ["注册 Poolside，在控制台创建 API Key"],
  },
  llmgateway: {
    badge: "免费",
    tagline: "3 个免费档：atria-dawn-preview 等代理免费档",
    keyUrl: "https://llmgateway.io",
    keyHint: "llmgateway.io",
    steps: ["注册 LLMGateway，在控制台创建 API Key"],
  },
  zai: {
    badge: "免费",
    tagline: "智谱 Z.AI 海外：GLM-4.5/4.7-Flash 永久免费",
    keyUrl: "https://z.ai",
    keyHint: "z.ai",
    steps: ["注册 Z.AI 账号，在 API Keys 页面创建 Key"],
  },
  "tencent-tokenhub": {
    badge: "免费",
    tagline: "腾讯 TokenHub：Hunyuan-Yuan3.5 Hy3 / Hy3-Preview",
    keyUrl: "https://cloud.tencent.com/product/tokenhub",
    keyHint: "cloud.tencent.com → TokenHub",
    steps: ["登录腾讯云，在 TokenHub 控制台创建 API Key"],
  },
  nova: {
    badge: "免费",
    tagline: "Amazon Nova 试用档：nova-2-lite / nova-2-pro",
    keyUrl: "https://nova.amazon.com/dev/documentation",
    keyHint: "nova.amazon.com",
    steps: ["登录 AWS，在 Amazon Nova 控制台创建 API Key"],
  },
  huggingface: {
    badge: "限速免费",
    tagline: "HF Inference Providers：GLM-4.7-Flash 等免费档",
    keyUrl: "https://huggingface.co/settings/tokens",
    keyHint: "huggingface.co → Tokens",
    steps: ["注册 Hugging Face，在 Settings → Tokens 创建 Read token"],
  },
  mistral: {
    badge: "限速免费",
    tagline: "Mistral La Plateforme 试用层：Devstral-Small 免费",
    keyUrl: "https://console.mistral.ai",
    keyHint: "console.mistral.ai",
    steps: ["注册 Mistral，在 API Keys 页面创建 Key"],
  },
  cohere: {
    badge: "限速免费",
    tagline: "Cohere Trial：north-mini-code 试用档",
    keyUrl: "https://dashboard.cohere.com",
    keyHint: "dashboard.cohere.com",
    steps: ["注册 Cohere，在 API Keys 页面创建 Trial Key"],
  },
  amd: {
    badge: "免费额度",
    tagline: "AMD Developer Cloud 试用：Qwen3.8-27B",
    keyUrl: "https://developer.amd.com.cn/radeon/tokenfactory",
    keyHint: "developer.amd.com.cn",
    steps: ["登录 AMD Developer Cloud，在 Token Factory 创建 API Key"],
  },
  // 第四梯队：小众档
  bothub: {
    badge: "免费",
    tagline: "俄罗斯代理：Nemotron-3-Ultra / Gemma-4-31B :free",
    keyUrl: "https://bothub.ru",
    keyHint: "bothub.ru",
    steps: ["注册 Bothub，在控制台创建 API Key"],
  },
  hetzner: {
    badge: "免费",
    tagline: "Hetzner Cloud Inference 试用：Qwen3.6/3.8",
    keyUrl: "https://experiments.hetzner.com/docs/inference",
    keyHint: "hetzner.com",
    steps: ["登录 Hetzner Cloud，在 Inference 项目页创建 API Key"],
  },
  poe: {
    badge: "免费",
    tagline: "Poe API：GPT-5.3-Codex-Spark / Kimi-K2.5-FW / Gemma-4-31B",
    keyUrl: "https://creator.poe.com/docs/external-applications/openai-compatible-api",
    keyHint: "creator.poe.com",
    steps: ["注册 Poe 开发者账号，在 API Keys 页面创建 Key"],
  },
  "regolo-ai": {
    badge: "免费",
    tagline: "Regolo AI 欧洲免费档：faster-whisper-large-v3 等",
    keyUrl: "https://docs.regolo.ai",
    keyHint: "regolo.ai",
    steps: ["注册 Regolo AI，在控制台创建 API Key"],
  },
  "nano-gpt": {
    badge: "免费",
    tagline: "NanoGPT 免费档：auto-model 自动路由",
    keyUrl: "https://docs.nano-gpt.com",
    keyHint: "nano-gpt.com",
    steps: ["注册 NanoGPT，在控制台创建 API Key"],
  },
  ovhcloud: {
    badge: "免费",
    tagline: "OVHcloud AI Endpoints 试用：Qwen3Guard 系列",
    keyUrl: "https://www.ovhcloud.com/en/public-cloud/ai-endpoints",
    keyHint: "ovhcloud.com",
    steps: ["注册 OVHcloud，在 AI Endpoints 控制台创建 API Key"],
  },
  meganova: {
    badge: "免费",
    tagline: "Meganova 免费档：Mistral-Small-3.2-24B 等",
    keyUrl: "https://docs.meganova.ai",
    keyHint: "meganova.ai",
    steps: ["注册 Meganova，在控制台创建 API Key"],
  },
  tokenrouter: {
    badge: "免费",
    tagline: "TokenRouter 免费档：GLM-5.3-free",
    keyUrl: "https://www.tokenrouter.com",
    keyHint: "tokenrouter.com",
    steps: ["注册 TokenRouter，在控制台创建 API Key"],
  },
  standardcompute: {
    badge: "免费",
    tagline: "Standard Compute 试用：standardcompute 模型",
    keyUrl: "https://standardcompute.com",
    keyHint: "standardcompute.com",
    steps: ["注册 Standard Compute，在控制台创建 API Key"],
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
        // 免费通道置顶（0），其次 PROVIDER_PRIORITY（1..），最后兜底（99）
        (x) => (FREE_PROVIDERS[x.id] ? 0 : PROVIDER_PRIORITY[x.id] !== undefined ? 1 : 2),
        // 同分组内：免费通道按 FREE_PROVIDER_RANK 排；其他按 PROVIDER_PRIORITY 排
        (x) => {
          if (FREE_PROVIDERS[x.id]) return FREE_PROVIDER_RANK.indexOf(x.id) + 100
          return PROVIDER_PRIORITY[x.id] ?? 99
        },
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
                opencode: "(推荐)",
                anthropic: "(API 密钥)",
                openai: "(ChatGPT Plus/Pro 或 API 密钥)",
                "opencode-go": "低成本订阅，适合所有人",
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
      description: () => <text fg={theme.textMuted}>这只会存储一个凭据。请在 NovaWay.json 中配置提供商以使用它。</text>,
    })
    if (value === null) return

    const providerID = normalizeCustomProviderID(value)
    if (providerID) return providerID

    toast.show({
      variant: "error",
      message: "提供商 ID 必须以小写字母或数字开头，且仅使用小写字母、数字、连字符和下划线",
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
  const [busy, setBusy] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API 密钥"
      busy={busy()}
      busyText="连接中..."
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
        return {
          opencode: (
            <box gap={1}>
              <text fg={theme.textMuted}>
                NovaWay Zen gives you access to all the best coding models at the cheapest prices with a single API key.
              </text>
              <text fg={theme.text}>
                Go to <span style={{ fg: theme.primary }}>https://opencode.ai/zen</span> to get a key
              </text>
            </box>
          ),
          "opencode-go": (
            <box gap={1}>
              <text fg={theme.textMuted}>
                OpenCode Go is a $10 per month subscription that provides reliable access to popular open coding models
                with generous usage limits.
              </text>
              <text fg={theme.text}>
                Go to <span style={{ fg: theme.primary }}>https://opencode.ai/go</span> and enable OpenCode Go
              </text>
            </box>
          ),
        }[props.providerID]
      }}
      onConfirm={async (value) => {
        if (!value) return
        setBusy(true)
        try {
          await sdk.client.auth.set({
            providerID: props.providerID,
            auth: {
              type: "api",
              key: value,
              ...(props.metadata ? { metadata: props.metadata } : {}),
            },
          })
          await sdk.client.instance.dispose()
          // instance.dispose 是响应后异步执行的；sync.bootstrap 立刻调
          // 仍然拿到旧实例的 provider 列表，会显示「未找到结果」。
          // 多调几次 bootstrap，等新实例起来后刷新出 Kenari 等新通道。
          await sync.bootstrap()
          for (let attempt = 0; attempt < 5; attempt++) {
            if (sync.data.provider.some((p) => p.id === props.providerID)) break
            await new Promise((r) => setTimeout(r, 250))
            await sync.bootstrap()
          }
          if (props.custom && !sync.data.provider_next.all.some((provider) => provider.id === props.providerID)) {
            toast.show({
              variant: "info",
              message: `Saved credential for ${props.providerID}. Configure it in NovaWay.json to use it.`,
            })
            dialog.clear()
            return
          }
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
        } catch (err) {
          toast.show({
            variant: "error",
            message: `连接 ${props.providerID} 失败：${err instanceof Error ? err.message : String(err)}`,
          })
          setBusy(false)
        }
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
