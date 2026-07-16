import { Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatformAccounts, PLATFORM_LIST } from "@/context/platform-accounts"
import type { PlatformAccount } from "@/context/platform-accounts"
import { PlatformWebView } from "./PlatformWebView"
import { PublishModal } from "./PublishModal"

function StatCard(props: { label: string; value: string; icon: string }) {
  return (
    <div class="rounded-[8px] border border-border-weak-base bg-background-base p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-border-interactive-base hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-base">{props.icon}</span>
        <span class="text-12-regular text-text-weak">{props.label}</span>
      </div>
      <div class="text-xl font-semibold text-text-strong">{props.value}</div>
    </div>
  )
}

function AccountOverview(props: { account: PlatformAccount }) {
  const dialog = useDialog()
  const platform = usePlatformAccounts()
  const info = () => PLATFORM_LIST.find((p) => p.id === props.account.platform)

  const openPublish = () => {
    platform.selectAccount(props.account.id)
    dialog.show(() => <PublishModal />)
  }

  return (
    <div class="p-6 space-y-5 max-w-3xl">
      <div class="flex items-center gap-4 pb-5 border-b border-border-weak-base">
        <div class="size-14 rounded-[12px] flex items-center justify-center bg-white overflow-hidden">
          <img src={info()?.icon} alt="" class="size-full object-contain p-1" />
        </div>
        <div class="flex-1">
          <h2 class="text-18-medium text-text-strong">{props.account.nickname}</h2>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-13-regular text-text-weak">{info()?.name}</span>
            <span class="size-1 rounded-full bg-border-weak-base" />
            <span
              class="inline-flex items-center gap-1 text-12-medium"
              classList={{
                "text-emerald-600 dark:text-emerald-400": props.account.status === "valid",
                "text-amber-600 dark:text-amber-400": props.account.status === "expired",
                "text-rose-600 dark:text-rose-400": props.account.status === "login_failed",
              }}
            >
              <span
                class="size-1.5 rounded-full"
                classList={{
                  "bg-emerald-500": props.account.status === "valid",
                  "bg-amber-500": props.account.status === "expired",
                  "bg-rose-500": props.account.status === "login_failed",
                }}
              />
              {props.account.status === "valid" ? "已登录" : props.account.status === "expired" ? "已过期" : "异常"}
            </span>
          </div>
        </div>
        <button
          class="rounded-[8px] border border-border-weak-base bg-background-weak px-3 py-2 text-12-medium text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
          onClick={() => platform.removeAccount(props.account.id)}
        >
          移除账号
        </button>
      </div>

      <div class="grid grid-cols-3 gap-3">
        <StatCard label="粉丝" value="-" icon="👥" />
        <StatCard label="作品" value="-" icon="📄" />
        <StatCard label="获赞" value="-" icon="❤️" />
      </div>

      <div class="rounded-[10px] border border-border-weak-base bg-background-base p-5 transition-all duration-150 hover:-translate-y-0.5 hover:border-border-interactive-base hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
        <h3 class="text-14-medium text-text-strong mb-4">快捷操作</h3>
        <div class="flex gap-3">
          <button
            class="inline-flex items-center gap-1.5 rounded-[8px] px-4 py-2.5 text-13-medium text-white transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0"
            style={{
              background: "linear-gradient(135deg, var(--novaway-mode-color, #FF6B6B), #e05555)",
              "box-shadow": "0 4px 12px color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 30%, transparent)",
            }}
            onClick={openPublish}
          >
            <span>📤</span>
            发布内容
          </button>
          <button class="inline-flex items-center gap-1.5 rounded-[8px] border border-border-weak-base bg-background-weak px-4 py-2.5 text-13-medium text-text-strong transition-all duration-150 hover:-translate-y-0.5 hover:border-border-interactive-base hover:bg-surface-raised-base-hover active:translate-y-0">
            <span>📋</span>
            查看作品
          </button>
        </div>
      </div>

      <div class="rounded-[10px] border border-border-weak-base bg-background-base p-5 transition-all duration-150 hover:-translate-y-0.5 hover:border-border-interactive-base hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
        <h3 class="text-14-medium text-text-strong mb-4">最近发布</h3>
        <div class="py-12 flex flex-col items-center justify-center text-center">
          <div class="size-14 rounded-[12px] bg-background-weak flex items-center justify-center mb-4">
            <span class="text-xl">📝</span>
          </div>
          <p class="text-13-regular text-text-weak">暂无发布记录</p>
          <p class="text-12-regular text-text-weaker mt-1">发布内容后将在这里显示</p>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  const dialog = useDialog()
  const openPublish = () => dialog.show(() => <PublishModal />)

  return (
    <div class="flex items-center justify-center h-full">
      <div class="text-center max-w-sm mx-auto p-8">
        <div
          class="size-20 mx-auto mb-6 rounded-[16px] flex items-center justify-center"
          style={{ "background-color": "color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 10%, transparent)" }}
        >
          <span class="text-4xl" style={{ color: "var(--novaway-mode-color, #FF6B6B)" }}>
            📱
          </span>
        </div>
        <h3 class="text-18-medium text-text-strong mb-2">选择一个平台账号</h3>
        <p class="text-13-regular text-text-weak leading-relaxed mb-6">
          点击左侧已登录的账号查看详情，或直接发布内容到多个平台
        </p>
        <div class="flex items-center justify-center gap-3 mb-6 text-12-regular text-text-weaker">
          <span class="flex items-center gap-1.5">
            <span class="size-1.5 rounded-full bg-text-weaker" />
            支持 7 个主流平台
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-1.5 rounded-full bg-text-weaker" />
            一键多平台管理
          </span>
        </div>
        <button
          class="inline-flex items-center gap-1.5 rounded-[8px] px-5 py-2.5 text-13-medium text-white transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0"
          style={{
            background: "linear-gradient(135deg, var(--novaway-mode-color, #FF6B6B), #e05555)",
            "box-shadow": "0 4px 12px color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 30%, transparent)",
          }}
          onClick={openPublish}
        >
          <span>📤</span>
          一键发布
        </button>
      </div>
    </div>
  )
}

export function PulseMain() {
  const platform = usePlatformAccounts()
  const selectedAccount = () => platform.store.accounts.find((a) => a.id === platform.store.selectedAccountId)

  return (
    <Show when={selectedAccount()} keyed fallback={<EmptyState />}>
      {(account) => (
        <PlatformWebView
          accountId={account.id}
          platform={account.platform}
          cookies={account.cookies}
          uid={account.uid}
          nickname={account.nickname}
          avatar={account.avatar}
        />
      )}
    </Show>
  )
}
