import { createSignal, For, Show } from "solid-js"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { PLATFORM_LIST, usePlatformAccounts } from "@/context/platform-accounts"
import { PlatformIcon } from "@/components/platform-icon"

export function AddAccountModal() {
  const dialog = useDialog()
  const platform = usePlatformAccounts()
  const [busyPlatform, setBusyPlatform] = createSignal<string | null>(null)
  const [error, setError] = createSignal("")

  const handleAdd = async (platformId: string) => {
    if (busyPlatform()) return
    setError("")
    setBusyPlatform(platformId)
    try {
      const result = await platform.addAccount(platformId)
      if (result?.success) {
        dialog.close()
      } else {
        setError(result?.error || "账号接入未完成，请完成登录后重试。")
      }
    } catch (cause) {
      console.error("[AddAccountModal] account onboarding failed", cause)
      setError(cause instanceof Error ? cause.message : "账号接入失败，请稍后重试。")
    } finally {
      setBusyPlatform(null)
    }
  }

  return (
    <Dialog title="账号添加">
      <div class="p-5">
        <p class="text-14-regular text-foreground-subtle mb-2">选择平台添加账号</p>
        <p class="mb-5 text-12-regular text-foreground-subtlest">登录未完成或登录失败，账号不会加入左侧列表</p>
        <Show when={error()}>
          <div
            class="mb-4 rounded-lg border border-surface-critical-base/30 bg-surface-critical-base/10 px-3 py-2 text-12-regular leading-5 text-critical-base"
            role="alert"
          >
            {error()}
          </div>
        </Show>
        <Show when={busyPlatform()}>
          <div
            class="mb-4 flex items-center gap-2 rounded-lg border border-border bg-background-alt px-3 py-2 text-12-regular text-foreground-subtle"
            aria-live="polite"
          >
            <span class="size-3.5 animate-spin rounded-full border-2 border-border border-t-border-interactive-base" />
            正在打开平台登录窗口，请完成登录后返回…
          </div>
        </Show>
        <div class="flex flex-wrap gap-6">
          {PLATFORM_LIST.map((plat) => (
            <button
              type="button"
              disabled={!!busyPlatform()}
              aria-busy={busyPlatform() === plat.id}
              class="flex min-w-[70px] cursor-pointer flex-col items-center gap-2 rounded-[10px] border border-border bg-background p-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-interactive-hover hover:shadow-[0_8px_24px_color-mix(in_srgb,var(--text-strong)_6%,transparent)] disabled:cursor-wait disabled:opacity-55 disabled:hover:translate-y-0"
              onClick={() => handleAdd(plat.id)}
            >
              <div class="size-12 rounded-[10px] flex items-center justify-center overflow-hidden bg-background-alt">
                <PlatformIcon
                  color={plat.iconColor}
                  markColor={plat.iconMarkColor}
                  svg={plat.icon}
                  class="size-full object-contain"
                />
              </div>
              <span class="text-12-regular text-foreground">{plat.name}</span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
