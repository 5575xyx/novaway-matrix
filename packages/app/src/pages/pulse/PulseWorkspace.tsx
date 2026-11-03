import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { useDialog } from "@novaway/ui/context/dialog"
import { Icon } from "@novaway/ui/icon"
import { IconButton } from "@novaway/ui/icon-button"
import { FRAME_WINDOW_CONTROLS_WIDTH } from "@/components/frame-window-controls"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { PlatformAccountsProvider, usePlatformAccounts } from "@/context/platform-accounts"
import { decode64 } from "@/utils/base64"
import { PulseChatHost } from "./PulseChatHost"
import { PulseMain } from "./PulseMain"
import { PulseSidebar } from "./PulseSidebar"
import { PublishModal } from "./PublishModal"

function PulseWorkspaceInner(props: { onBack: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const platform = usePlatformAccounts()
  const layout = useLayout()
  const params = useParams()

  // 对话要按目录建会话、拉数据。工作台挂在主帧外层（不在 DirectoryLayout 里），
  // 只能从路由参数解目录，再自己补 provider —— 见 PulseChatHost 的说明。
  const directory = createMemo(() => decode64(params.dir) ?? "")
  // 对话区默认展开：进运营工作台的第一诉求就是"说一句话让它去干活"。
  const [chatOpen, setChatOpen] = createSignal(true)

  onMount(() => {
    void platform.refreshGroups()
    // 迁移/旧版本留下的账号可能只有 cookie 没有昵称头像：打开工作台时后台补一次。
    // 主进程会先打接口、被风控时再用隐藏窗口读页面（见 desktop/platform/profile.ts）。
    void platform.refreshAccounts().then(() => platform.refreshProfiles())
    // 工作台是"账号列表 + 平台网页 + 运营对话"的三栏组合，宽度紧张。打开时把桌面
    // 侧栏收起来腾地方；返回时不自动展开 —— 展开入口本来就在会话帧 Header 上。
    layout.sidebar.setExpanded(false)
  })

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div class="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <IconButton
          icon="arrow-left"
          variant="ghost"
          size="small"
          aria-label={language.t("common.back")}
          onClick={props.onBack}
        />
        <span class="text-14-medium text-foreground">{language.t("pulse.workspace.title")}</span>
        <span class="min-w-0 truncate text-12-regular text-foreground-subtle">
          {language.t("pulse.workspace.subtitle")}
        </span>
        {/* 一站式发布入口：账号详情区是平台网页，没有这里的话用户找不到"发到多个平台"。
            放标题右侧而不是顶行最右 —— 最右那块是 FrameWindowControls 的窗控拖拽区
            （最小化/恢复/关闭），按钮放过去既重叠又点不到（见 frame-window-controls.tsx
            顶部注释：「页面自己的动作按钮一律放左边」）。 */}
        <button
          type="button"
          data-slot="pulse-publish-entry"
          class="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-12-medium text-white transition-all duration-150 hover:-translate-y-px active:translate-y-0 active:scale-[0.98]"
          style={{
            background: "linear-gradient(135deg, var(--novaway-mode-color, #FF6B6B), #e05555)",
            "box-shadow": "0 4px 12px color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 30%, transparent)",
          }}
          onClick={() => dialog.show(() => <PublishModal />)}
        >
          <Icon name="paper-plane" size="small" />
          {language.t("pulse.publish.open")}
        </button>
        {/* 对话区开关：和发布入口一起留在左侧动作区，右侧整段留给窗控。 */}
        <IconButton
          icon="speech-bubble"
          variant="ghost"
          size="small"
          aria-label={language.t("pulse.chat.toggle")}
          aria-pressed={chatOpen()}
          onClick={() => setChatOpen((value) => !value)}
        />
        <span class="flex-1" aria-hidden="true" />
        {/* 占住右上角窗控的宽度：封面面板自带的窗控浮在这行上，右侧要留白。 */}
        <span
          class="h-px shrink-0"
          style={{ width: `${FRAME_WINDOW_CONTROLS_WIDTH}px` }}
          aria-hidden="true"
        />
      </div>
      {/* 三栏：账号列表 / 账号详情（平台网页） / 运营对话。
          对话是真实的服务端会话（固定 pulse-orchestrator 主智能体），渲染和输入框
          都复用标准那套（Message / AssistantParts / 同样的输入框外壳）。 */}
      <div class="flex min-h-0 flex-1">
        <div class="w-60 shrink-0 overflow-y-auto border-r border-border bg-background-alt/40">
          <PulseSidebar />
        </div>
        <div class="min-w-0 flex-1 overflow-auto">
          <PulseMain />
        </div>
        <Show when={chatOpen()}>
          <div
            data-slot="pulse-chat-column"
            class="flex w-[380px] max-w-[46%] shrink-0 flex-col overflow-hidden border-l border-border bg-background"
          >
            {/* 没选项目就没有目录，建不了会话 —— 提示一句，而不是让对话区空转。 */}
            <Show
              when={directory()}
              fallback={
                <div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <Icon name="speech-bubble" class="size-6 text-foreground-subtlest" />
                  <p class="text-ui-caption leading-5 text-foreground-subtle">
                    {language.t("pulse.chat.noDirectory")}
                  </p>
                </div>
              }
            >
              <PulseChatHost directory={directory()} />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

/**
 * 运营工作台（原 `/pulse` 整窗页面）。
 *
 * 以前运营模式是一个**独立的窗口级布局**：自带顶栏、账号栏和一套手写的聊天气泡，
 * 切过去时左侧图标条（数据库/知识库/扩展/设置）整块消失。现在它变成主帧内的
 * 普通页面（和设置/数据库/自动化一致），图标条始终保留；对话区也换回了标准的
 * 消息渲染与输入框（见 PulseChat），不再是另一套气泡样式。
 */
export default function PulseWorkspace(props: { onBack: () => void }) {
  return (
    <PlatformAccountsProvider>
      <PulseWorkspaceInner onBack={props.onBack} />
    </PlatformAccountsProvider>
  )
}
