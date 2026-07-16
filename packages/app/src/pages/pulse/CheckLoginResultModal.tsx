import { createMemo, createSignal, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { PLATFORM_LIST } from "@/context/platform-accounts"
import { ConfirmDialog } from "@/components/dialog-confirm"

export interface CheckResult {
  id: string
  platform: string
  nickname: string
  avatar: string
  valid: boolean
}

export function CheckLoginResultModal(props: { results: CheckResult[]; onRemove: (id: string) => void }) {
  const dialog = useDialog()
  const [confirmRemoveId, setConfirmRemoveId] = createSignal<string | null>(null)

  const onlineCount = createMemo(() => props.results.filter((r) => r.valid).length)
  const offlineCount = createMemo(() => props.results.filter((r) => !r.valid).length)

  const platformInfo = (platId: string) => PLATFORM_LIST.find((p) => p.id === platId)

  return (
    <Dialog title="账号登录状态检测" size="large">
      <div class="p-4">
        <div class="flex items-center gap-4 mb-4">
          <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-13-medium text-emerald-600 dark:text-emerald-400">
            <Icon name="circle-check" size="small" />
            在线 {onlineCount()}
          </div>
          <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-13-medium text-rose-600 dark:text-rose-400">
            <Icon name="circle-x" size="small" />
            离线 {offlineCount()}
          </div>
          <div class="text-12-regular text-text-weak ml-auto">共 {props.results.length} 个账号</div>
        </div>

        <Show
          when={props.results.length > 0}
          fallback={<div class="text-center py-8 text-14-regular text-text-weaker">暂无账号数据</div>}
        >
          <div class="space-y-1 max-h-[360px] overflow-y-auto">
            <For each={props.results}>
              {(result) => {
                const info = () => platformInfo(result.platform)
                return (
                  <div class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-raised-base-hover transition-colors">
                    <Show
                      when={result.valid}
                      fallback={<Icon name="circle-x" size="small" class="text-rose-500 shrink-0" />}
                    >
                      <Icon name="circle-check" size="small" class="text-emerald-500 shrink-0" />
                    </Show>
                    <div class="size-8 rounded-full bg-background-weak flex items-center justify-center overflow-hidden shrink-0">
                      <Show
                        when={result.avatar}
                        fallback={<span class="text-12-regular text-text-weak">{result.nickname?.charAt(0)}</span>}
                      >
                        <img src={result.avatar} alt="" class="size-full object-cover" />
                      </Show>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="text-13-medium text-text-strong truncate">{result.nickname}</div>
                      <div class="flex items-center gap-1 mt-0.5">
                        <Show when={info()?.icon}>
                          <img src={info()?.icon} alt="" class="size-3" />
                        </Show>
                        <span class="text-11-regular text-text-weaker">{info()?.name}</span>
                      </div>
                    </div>
                    <Show when={!result.valid}>
                      <button
                        class="shrink-0 text-12-regular text-rose-600 dark:text-rose-400 hover:underline px-2 py-1"
                        onClick={() => setConfirmRemoveId(result.id)}
                      >
                        移除
                      </button>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </div>
      <ConfirmDialog
        open={confirmRemoveId() !== null}
        title="移除账号"
        description={`确定移除账号「${props.results.find((r) => r.id === confirmRemoveId())?.nickname || ""}」？`}
        confirmText="移除"
        variant="danger"
        onConfirm={() => {
          const id = confirmRemoveId()
          if (id) props.onRemove(id)
        }}
        onClose={() => setConfirmRemoveId(null)}
      />
    </Dialog>
  )
}
