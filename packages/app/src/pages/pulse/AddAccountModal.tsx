import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { PLATFORM_LIST, usePlatformAccounts } from "@/context/platform-accounts"

export function AddAccountModal() {
  const dialog = useDialog()
  const platform = usePlatformAccounts()

  const handleAdd = async (platformId: string) => {
    const result = await platform.addAccount(platformId)
    if (result?.success) {
      dialog.close()
    }
  }

  return (
    <Dialog title="账号添加">
      <div class="p-5">
        <p class="text-14-regular text-text-weak mb-2">选择平台添加账号</p>
        <p class="text-12-regular text-text-weaker mb-5">登录未完成或登录失败，账号不会加入左侧列表</p>
        <div class="flex gap-6 flex-wrap">
          {PLATFORM_LIST.map((plat) => (
            <button
              class="flex flex-col items-center gap-2 p-3 rounded-[10px] border border-border-weak-base bg-background-base transition-all duration-150 hover:-translate-y-0.5 hover:border-border-interactive-base hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] cursor-pointer min-w-[70px]"
              onClick={() => handleAdd(plat.id)}
            >
              <div class="size-12 rounded-[10px] flex items-center justify-center overflow-hidden bg-white">
                <img src={plat.icon} alt={plat.name} class="size-full object-contain" />
              </div>
              <span class="text-12-regular text-text-strong">{plat.name}</span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
