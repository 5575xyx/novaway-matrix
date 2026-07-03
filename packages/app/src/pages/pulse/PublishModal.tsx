import { createSignal, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatformAccounts, PLATFORM_LIST, type PlatformAccount } from "@/context/platform-accounts"

function AccountCheckbox(props: {
  account: PlatformAccount
  checked: boolean
  onToggle: () => void
}) {
  const info = () => PLATFORM_LIST.find((p) => p.id === props.account.platform)

  return (
    <label
      class="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-surface-raised-base-hover"
      classList={{ "opacity-50 pointer-events-none": props.account.status !== "valid" }}
    >
      <input
        type="checkbox"
        checked={props.checked}
        onChange={props.onToggle}
        class="size-4 rounded border-border-weak-base accent-[var(--novaway-mode-color,#FF6B6B)]"
      />
      <div class="size-7 rounded-full bg-background-weak flex items-center justify-center overflow-hidden shrink-0">
        {props.account.avatar ? (
          <img src={props.account.avatar} alt="" class="size-full object-cover" />
        ) : (
          <span class="text-11-regular text-text-weak">{props.account.nickname?.charAt(0)}</span>
        )}
      </div>
      <span class="text-13-medium text-text-strong truncate">{props.account.nickname}</span>
      <span class="text-xs ml-auto">{info()?.icon}</span>
    </label>
  )
}

export function PublishModal() {
  const dialog = useDialog()
  const platform = usePlatformAccounts()

  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set())
  const [title, setTitle] = createSignal("")
  const [content, setContent] = createSignal("")
  const [publishing, setPublishing] = createSignal(false)
  const [results, setResults] = createSignal<{ accountId: string; success: boolean; error?: string }[]>([])

  const toggleAccount = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedAccounts = () =>
    platform.store.accounts.filter((a) => selectedIds().has(a.id))

  const handlePublish = async () => {
    if (selectedAccounts().length === 0 || !content().trim()) return
    setPublishing(true)
    const res: { accountId: string; success: boolean; error?: string }[] = []
    for (const account of selectedAccounts()) {
      try {
        await platform.publish(account.id, {
          title: title(),
          content: content(),
          images: [],
        })
        res.push({ accountId: account.id, success: true })
      } catch (e: any) {
        res.push({ accountId: account.id, success: false, error: e?.message || "发布失败" })
      }
    }
    setResults(res)
    setPublishing(false)
  }

  const successCount = () => results().filter((r) => r.success).length
  const failCount = () => results().filter((r) => !r.success).length

  return (
    <Dialog title="发布内容">
      <div class="p-5 max-h-[600px] overflow-y-auto">
        <Show
          when={results().length === 0}
          fallback={
            <div class="space-y-4">
              <div class="rounded-[10px] border border-border-weak-base bg-background-weak/40 p-5 text-center">
                <div class="text-3xl mb-3">{successCount() > 0 ? "✅" : "❌"}</div>
                <div class="text-14-medium text-text-strong mb-1">
                  发布完成：成功 {successCount()}，失败 {failCount()}
                </div>
                <div class="text-12-regular text-text-weak">共 {results().length} 个账号</div>
              </div>
              <button
                class="w-full rounded-[8px] border border-border-weak-base bg-background-base px-4 py-2.5 text-13-medium text-text-strong transition-colors hover:bg-surface-raised-base-hover"
                onClick={() => dialog.close()}
              >
                关闭
              </button>
            </div>
          }
        >
          <div class="space-y-5">
            <div>
              <label class="block text-13-medium text-text-strong mb-2">选择发布账号</label>
              <div class="rounded-[10px] border border-border-weak-base bg-background-weak/40 p-2 space-y-0.5 max-h-48 overflow-y-auto">
                <For each={platform.store.accounts}>
                  {(account) => (
                    <AccountCheckbox
                      account={account}
                      checked={selectedIds().has(account.id)}
                      onToggle={() => toggleAccount(account.id)}
                    />
                  )}
                </For>
                <Show when={platform.store.accounts.length === 0}>
                  <div class="py-6 text-center text-12-regular text-text-weaker">
                    暂无账号，请先添加
                  </div>
                </Show>
              </div>
              <Show when={selectedAccounts().length > 0}>
                <div class="mt-1.5 text-11-regular text-text-weak">
                  已选择 {selectedAccounts().length} 个账号
                </div>
              </Show>
            </div>

            <div>
              <label class="block text-13-medium text-text-strong mb-2">标题（可选）</label>
              <input
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
                placeholder="输入标题..."
                class="w-full rounded-[8px] border border-border-weak-base bg-background-base px-3.5 py-2.5 text-13-regular text-text-strong placeholder:text-text-muted outline-none transition-all duration-150 focus:border-[var(--novaway-mode-color,#FF6B6B)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--novaway-mode-color,#FF6B6B)_15%,transparent)]"
              />
            </div>

            <div>
              <label class="block text-13-medium text-text-strong mb-2">正文内容</label>
              <textarea
                value={content()}
                onInput={(e) => setContent(e.currentTarget.value)}
                placeholder="输入发布内容..."
                rows={6}
                class="w-full rounded-[8px] border border-border-weak-base bg-background-base px-3.5 py-2.5 text-13-regular text-text-strong placeholder:text-text-muted outline-none resize-none transition-all duration-150 focus:border-[var(--novaway-mode-color,#FF6B6B)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--novaway-mode-color,#FF6B6B)_15%,transparent)]"
              />
            </div>

            <div class="flex gap-2">
              <button
                class="flex-1 rounded-[8px] border border-border-weak-base bg-background-base px-4 py-2.5 text-13-medium text-text-strong transition-colors hover:bg-surface-raised-base-hover"
                onClick={() => dialog.close()}
              >
                取消
              </button>
              <button
                class="flex-1 rounded-[8px] px-4 py-2.5 text-13-medium text-white transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
                style={{
                  "background": "linear-gradient(135deg, var(--novaway-mode-color, #FF6B6B), #e05555)",
                  "box-shadow": "0 4px 12px color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 30%, transparent)",
                }}
                disabled={selectedAccounts().length === 0 || !content().trim() || publishing()}
                onClick={handlePublish}
              >
                {publishing() ? "发布中..." : `发布到 ${selectedAccounts().length} 个账号`}
              </button>
            </div>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
