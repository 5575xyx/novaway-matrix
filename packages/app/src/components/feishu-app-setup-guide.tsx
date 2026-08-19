import { For, Show, createSignal, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { writeClipboard } from "@opencode-ai/ui/util/clipboard"
import { usePlatform } from "@/context/platform"

type GuideLink = {
  label: string
  url: string
}

type GuideStep = {
  title: string
  description: string
  points?: string[]
}

const guideLinks: GuideLink[] = [
  { label: "飞书开放平台开发者后台", url: "https://open.feishu.cn/app" },
  { label: "飞书官方账号注册入口", url: "https://www.feishu.cn/" },
]

const guideSteps: GuideStep[] = [
  {
    title: "先确认需要准备什么",
    description: "这一步决定你能否顺利创建企业自建应用，建议先逐项核对。",
    points: [
      "飞书账号：个人飞书账号即可，但账号必须加入或创建一个飞书企业/组织。",
      "管理权限：创建企业自建应用通常需要组织管理员权限，或由管理员在管理后台给你开通「开发者权限」。",
      "操作设备：建议使用飞书电脑端或浏览器登录开放平台；手机端不适合填写凭证和配置应用。",
      "关键地址：开放平台开发者后台 https://open.feishu.cn/app，飞书账号注册入口 https://www.feishu.cn/。",
    ],
  },
  {
    title: "没有企业/组织时先创建或加入",
    description: "如果登录开放平台后提示「暂无可用组织」或无法创建企业自建应用，需要先完成组织准备。",
    points: [
      "自己测试：打开 https://www.feishu.cn/，用手机号或邮箱注册飞书账号。",
      "注册完成后按页面引导创建一个「团队/组织」。个人创建的测试组织，创建者默认是管理员。",
      "已经有公司飞书：让公司飞书管理员把你拉入组织，并确认你有开发者权限或请管理员代为创建应用。",
    ],
  },
  {
    title: "登录飞书开放平台",
    description: "使用刚才准备的那个飞书账号登录，不要把测试组织账号和公司账号混用。",
    points: [
      "浏览器打开 https://open.feishu.cn/app。",
      "选择「登录」，使用飞书账号扫码或手机号登录。",
      "登录后确认页面右上角显示的是你准备操作的那个组织。",
    ],
  },
  {
    title: "创建企业自建应用",
    description: "应用是飞书机器人、权限和长连接事件的容器，必须先创建。",
    points: [
      "进入开发者后台首页，点击「创建应用」或「创建企业自建应用」。",
      "应用名称建议填写「NovaWay 飞书通知」，方便后续在飞书里搜索。",
      "应用图标可以先不设置；创建成功后进入应用详情页。",
    ],
  },
  {
    title: "获取 App ID 和 App Secret",
    description: "这是 NovaWay 连接飞书长连接事件时必填的凭证，请逐位复制，不要带空格。",
    points: [
      "在刚创建的应用详情页，点击左侧「凭证与基础信息」。",
      "找到 App ID，通常以 cli_ 开头。",
      "点击 App Secret 右侧的「查看/复制」，完成身份验证后复制。",
      "回到 NovaWay，把 App ID 和 App Secret 分别粘贴到对应输入框。",
    ],
  },
  {
    title: "添加机器人能力",
    description: "飞书不会默认给企业自建应用开通机器人能力，需要先添加这个能力，后续才能在飞书里找到应用并私聊。",
    points: [
      "在应用详情页左侧导航找到「添加应用能力」；如果看不到，点击「应用能力」后再进入「添加应用能力」。",
      "选择「按能力添加」标签页，找到「机器人」卡片。",
      "点击机器人卡片上的「添加」或「+添加」，不是只开启一个开关。",
      "添加后，机器人会出现在「已添加能力」列表中，说明可以收发消息。",
    ],
  },
  {
    title: "申请消息权限",
    description: "NovaWay 需要读取你发给机器人的消息，并以机器人身份回复你。",
    points: [
      "点击左侧「权限管理」。",
      "搜索并开通 im:message.p2p_msg:readonly（读取用户发给机器人的单聊消息）。没有这项，私聊消息不会推送给 NovaWay。",
      "继续搜索并开通 im:message:send_as_bot（以应用身份发消息）。",
      "如果希望保留通用发送能力，也可以同时开通 im:message；但私聊接收绑定至少需要 im:message.p2p_msg:readonly。",
    ],
  },
  {
    title: "订阅消息事件并选长连接",
    description: "飞书把消息实时推给 NovaWay，需要订阅接收消息事件；长连接模式不需要公网服务器。",
    points: [
      "点击左侧「事件与回调」或「事件配置」。",
      "订阅方式选择「使用长连接接收事件」。",
      "点击「添加事件」，以应用身份搜索并添加「接收消息 im.message.receive_v1」。",
      "保存配置。长连接模式下不需要填写回调地址，NovaWay 启动后会主动连接飞书。",
    ],
  },
  {
    title: "发布应用并设置可见范围",
    description: "不发布的应用无法在飞书客户端里搜索和私聊，绑定会失败。",
    points: [
      "点击左侧「应用发布」。",
      "进入「版本管理与发布」，点击「创建版本」。",
      "每次新增权限或修改事件订阅后，都必须重新创建并发布版本，否则飞书客户端不会生效。",
      "可用范围至少勾选你自己的飞书账号；如果公司使用，可勾选需要使用的成员或部门。",
      "保存并提交发布。个人测试组织通常自己审批后立即生效；公司组织需要管理员审批。",
    ],
  },
  {
    title: "回飞书私聊并完成绑定",
    description: "这一步必须先把配置保存到 NovaWay，再去飞书发消息，顺序反了会收不到。",
    points: [
      "先在 NovaWay 中填好 App ID 和 App Secret，并点击「保存配置」。",
      "保存后，NovaWay 才会启动飞书长连接并开始接收消息。",
      "再打开飞书客户端，在顶部搜索你刚才创建的应用名称，例如「NovaWay 飞书通知」。",
      "进入和机器人的单聊，发送任意一条消息，例如「你好」。",
      "等待几秒后回到 NovaWay，点击「刷新绑定状态」；显示「已绑定」即配置完成。",
    ],
  },
]

function GuideLinkRow(props: { link: GuideLink }) {
  const platform = usePlatform()
  const [copied, setCopied] = createSignal(false)

  function copyLink() {
    const copy = async () => {
      if (platform.writeTextToClipboard) {
        try {
          const copied = await platform.writeTextToClipboard(props.link.url)
          if (copied) return true
        } catch {
          // 继续使用页面级复制兜底
        }
      }
      return writeClipboard(props.link.url)
    }
    void copy().then((copied) => {
      if (!copied) {
        showToast({ title: "复制失败", description: "请手动复制链接。" })
        return
      }
      setCopied(true)
      showToast({ title: "链接已复制", description: props.link.url })
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div class="flex items-center gap-2 rounded-[7px] border border-border-weak-base bg-background-base p-2">
      <div class="min-w-0 flex-1">
        <div class="truncate text-11-medium text-text-strong">{props.link.label}</div>
        <div class="mt-0.5 truncate text-10-regular text-text-muted">{props.link.url}</div>
      </div>
      <button
        type="button"
        class="flex h-8 shrink-0 items-center gap-1 rounded-[6px] border border-emerald-300/40 bg-emerald-300/10 px-2 text-10-medium text-emerald-100 transition-all duration-150 hover:-translate-y-px hover:bg-emerald-300/20 hover:shadow-[0_6px_14px_rgba(16,185,129,0.16)] active:translate-y-0 active:scale-95"
        onClick={() => copyLink()}
      >
        <Icon name={copied() ? "circle-check" : "copy"} size="small" />
        {copied() ? "已复制" : "复制"}
      </button>
    </div>
  )
}

export function FeishuAppSetupGuide(props: { compact?: boolean }): JSX.Element {
  const [open, setOpen] = createSignal(false)

  return (
    <div class="rounded-[8px] border border-border-weak-base bg-background-base">
      <button
        type="button"
        aria-expanded={open()}
        class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span class="flex min-w-0 items-center gap-2">
          <Icon name="help" size="small" />
          <span class="truncate text-12-medium text-text-strong">飞书配置引导</span>
          <span class="shrink-0 rounded-full border border-border-weak-base px-1.5 py-0.5 text-10-medium text-text-muted">
            {guideSteps.length} 步
          </span>
        </span>
        <Icon name={open() ? "arrow-up" : "arrow-down-to-line"} size="small" />
      </button>
      <Show when={open()}>
        <div class="border-t border-border-weak-base p-3">
          <div class="mb-3 grid gap-2">
            <For each={guideLinks}>{(link) => <GuideLinkRow link={link} />}</For>
          </div>
          <ol class="space-y-2.5">
            <For each={guideSteps}>
              {(step, index) => (
                <li class="flex gap-2.5">
                  <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-300/15 text-11-medium text-emerald-100">
                    {index() + 1}
                  </span>
                  <div class="min-w-0">
                    <div class="text-12-medium text-text-strong">{step.title}</div>
                    <div class="mt-0.5 text-11-regular leading-relaxed text-text-weak">{step.description}</div>
                    <Show when={step.points?.length}>
                      <ul class="mt-1.5 space-y-1 border-l border-border-weak-base pl-2.5">
                        <For each={step.points}>
                          {(point) => (
                            <li class="flex gap-1.5 text-11-regular leading-relaxed text-text-weak">
                              <span class="mt-[7px] size-1 shrink-0 rounded-full bg-text-muted" />
                              <span>{point}</span>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ol>
        </div>
      </Show>
    </div>
  )
}
