import { Show } from "solid-js"
import { useDialog } from "@novaway/ui/context/dialog"
import { usePlatformAccounts } from "@/context/platform-accounts"
import { PlatformWebView } from "./PlatformWebView"
import { PublishModal } from "./PublishModal"

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
        <h3 class="text-18-medium text-foreground mb-2">选择一个平台账号</h3>
        <p class="text-13-regular text-foreground-subtle leading-relaxed mb-6">
          点击左侧已登录的账号查看详情，或直接发布内容到多个平台
        </p>
        <div class="flex items-center justify-center gap-3 mb-6 text-12-regular text-foreground-subtlest">
          <span class="flex items-center gap-1.5">
            <span class="size-1.5 rounded-full bg-foreground-subtlest" />
            支持 7 个主流平台
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-1.5 rounded-full bg-foreground-subtlest" />
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
