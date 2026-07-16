import { createSignal, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatformAccounts, PLATFORM_LIST, type PlatformAccount } from "@/context/platform-accounts"
import { AddAccountModal } from "./AddAccountModal"
import { AccountManagerModal } from "./AccountManagerModal"
import { CheckLoginResultModal } from "./CheckLoginResultModal"
import { ConfirmDialog } from "@/components/dialog-confirm"

function AccountItem(props: {
  account: PlatformAccount
  isSelected: boolean
  onSelect: () => void
  onCheckLogin: () => void
  onRemove: () => void
}) {
  const info = () => PLATFORM_LIST.find((p) => p.id === props.account.platform)
  const [showMenu, setShowMenu] = createSignal(false)
  const [menuPos, setMenuPos] = createSignal({ x: 0, y: 0 })
  const [confirmRemove, setConfirmRemove] = createSignal(false)

  const statusColor = () => {
    switch (props.account.status) {
      case "valid":
        return "bg-emerald-500"
      case "expired":
        return "bg-amber-500"
      case "login_failed":
        return "bg-rose-500"
      default:
        return "bg-gray-300 dark:bg-gray-600"
    }
  }

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setShowMenu(true)
  }

  const handleMenuAction = (action: "check" | "remove") => {
    setShowMenu(false)
    if (action === "check") props.onCheckLogin()
    else setConfirmRemove(true)
  }

  return (
    <div
      class="relative flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150"
      classList={{
        "bg-surface-raised-base-hover": props.isSelected,
        "hover:bg-surface-raised-base-hover": !props.isSelected,
      }}
      style={props.isSelected ? { "box-shadow": "inset 3px 0 0 var(--novaway-mode-color, #FF6B6B)" } : undefined}
      onClick={props.onSelect}
      onContextMenu={handleContextMenu}
    >
      <div class="relative size-8 shrink-0 rounded-full bg-background-weak flex items-center justify-center overflow-hidden">
        {props.account.avatar ? (
          <img src={props.account.avatar} alt="" class="size-full object-cover" />
        ) : (
          <span class="text-12-regular text-text-weak">{props.account.nickname?.charAt(0)}</span>
        )}
        <span
          class={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ${statusColor()} ring-2 ring-background-base`}
        />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-13-medium text-text-strong truncate leading-tight">{props.account.nickname}</div>
        <div class="flex items-center gap-1 mt-0.5">
          <img src={info()?.icon} alt="" class="size-3" />
          <span class="text-11-regular text-text-weaker">{info()?.name}</span>
        </div>
      </div>

      <Show when={showMenu()}>
        <div
          class="fixed z-50 bg-background-raised-base border border-border-weak-base rounded-lg shadow-lg py-1 min-w-[120px]"
          style={{ left: `${menuPos().x}px`, top: `${menuPos().y}px` }}
          onClick={() => setShowMenu(false)}
        >
          <button
            class="w-full px-3 py-1.5 text-left text-12-regular text-text-strong hover:bg-surface-raised-base-hover flex items-center gap-2"
            onClick={() => handleMenuAction("check")}
          >
            <Icon name="circle-check" size="small" class="text-text-weak" />
            检测登录状态
          </button>
          <button
            class="w-full px-3 py-1.5 text-left text-12-regular text-rose-600 dark:text-rose-400 hover:bg-surface-raised-base-hover flex items-center gap-2"
            onClick={() => handleMenuAction("remove")}
          >
            <Icon name="trash" size="small" />
            移除账号
          </button>
        </div>
      </Show>
      <ConfirmDialog
        open={confirmRemove()}
        title="移除账号"
        description={`确定移除账号「${props.account.nickname}」？`}
        confirmText="移除"
        variant="danger"
        onConfirm={() => props.onRemove()}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  )
}

export function PulseSidebar() {
  const dialog = useDialog()
  const platform = usePlatformAccounts()
  const [expandedGroups, setExpandedGroups] = createSignal<Set<number>>(new Set([1]))

  const toggleGroup = (id: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openAddAccount = () => dialog.show(() => <AddAccountModal />)
  const openAccountManager = () => dialog.show(() => <AccountManagerModal />)

  return (
    <div class="flex flex-col h-full">
      <div class="shrink-0 p-3 border-b border-border-weak-base">
        <div
          class="rounded-[10px] p-3"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--novaway-mode-color, #FF6B6B) 10%, transparent), transparent)",
          }}
        >
          <div class="text-14-medium text-text-strong mb-1">账号矩阵</div>
          <div class="text-11-regular text-text-weak mb-2">一站式账号接入与状态巡检</div>
          <div class="flex gap-2 mb-2">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border-weak-base text-11-regular text-text-weak">
              总账号 {platform.store.accounts.length}
            </span>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border-weak-base text-11-regular text-emerald-600 dark:text-emerald-400">
              在线 {platform.onlineCount()}
            </span>
          </div>
          <Show when={platform.platformTags().length > 0}>
            <div class="flex flex-wrap gap-1">
              <For each={platform.platformTags()}>
                {(tag) => (
                  <span class="px-1.5 py-0.5 rounded text-10-medium bg-background-base/60 text-text-weak border border-border-weaker-base">
                    {tag}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

      <div class="shrink-0 p-2 border-b border-border-weak-base">
        <div class="flex gap-1.5">
          <button
            class="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-[8px] border border-border-weak-base text-13-medium text-text-strong transition-all duration-150 hover:bg-surface-raised-base-hover hover:border-border-interactive-base"
            onClick={openAccountManager}
          >
            <Icon name="sidebar" size="small" class="text-icon-base" />
            账号管理器
          </button>
          <button
            class="shrink-0 size-9 rounded-[8px] border border-border-weak-base bg-background-base flex items-center justify-center text-text-strong transition-all duration-150 hover:bg-surface-raised-base-hover hover:border-border-interactive-base"
            onClick={openAddAccount}
          >
            <Icon name="plus" size="small" />
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto py-1">
        <For each={platform.store.groups}>
          {(group) => {
            const accounts = () => platform.accountsInGroup(group.id)
            const isExpanded = () => expandedGroups().has(group.id)
            const onlineInGroup = () => accounts().filter((a) => a.status === "valid").length

            return (
              <div class="mx-1.5 mb-1">
                <button
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-12-regular text-text-weak hover:bg-surface-raised-base-hover transition-colors"
                  onClick={() => toggleGroup(group.id)}
                >
                  <Icon
                    name={isExpanded() ? "chevron-down" : "chevron-right"}
                    size="small"
                    class="text-text-weaker shrink-0"
                  />
                  <span class="flex-1 text-left truncate">{group.name}</span>
                  <span class="text-11-regular text-text-weaker">
                    {accounts().length}个 / 在线{onlineInGroup()}个
                  </span>
                </button>
                <Show when={isExpanded()}>
                  <div class="ml-2 space-y-0.5">
                    <For each={accounts()}>
                      {(account) => (
                        <AccountItem
                          account={account}
                          isSelected={platform.store.selectedAccountId === account.id}
                          onSelect={() => platform.selectAccount(account.id)}
                          onCheckLogin={async () => {
                            await platform.checkSingleLogin(account.id)
                          }}
                          onRemove={async () => {
                            await platform.removeAccount(account.id)
                          }}
                        />
                      )}
                    </For>
                    <Show when={accounts().length === 0}>
                      <div class="px-3 py-2 text-11-regular text-text-weaker text-center">暂无账号</div>
                    </Show>
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
      </div>

      <div class="shrink-0 border-t border-border-weak-base p-2">
        <button
          class="flex w-full items-center justify-center gap-1.5 rounded-[8px] px-3 py-2 text-12-medium text-text-weak transition-all duration-150 hover:bg-surface-raised-base-hover hover:text-text-base border border-border-weak-base disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={platform.store.loading}
          onClick={async () => {
            const results = await platform.checkAllLogins()
            dialog.show(() => (
              <CheckLoginResultModal
                results={results}
                onRemove={async (id) => {
                  await platform.removeAccount(id)
                }}
              />
            ))
          }}
        >
          <Icon name="circle-check" size="small" />
          {platform.store.loading ? "检测中..." : "一键检测登录状态"}
        </button>
      </div>
    </div>
  )
}
