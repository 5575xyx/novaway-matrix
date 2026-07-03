import { createSignal, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatformAccounts, PLATFORM_LIST, type PlatformAccount } from "@/context/platform-accounts"
import { ConfirmDialog } from "@/components/dialog-confirm"

function GroupSidebar(props: {
  selectedGroupId: number | "all"
  onSelect: (id: number | "all") => void
  onCreateGroup: (name: string) => void
  onRenameGroup: (id: number, name: string) => void
  onDeleteGroup: (id: number) => void
}) {
  const platform = usePlatformAccounts()
  const [editingId, setEditingId] = createSignal<number | null>(null)
  const [editName, setEditName] = createSignal("")
  const [newGroupName, setNewGroupName] = createSignal("")
  const [showNewInput, setShowNewInput] = createSignal(false)
  const [renameConfirmGroup, setRenameConfirmGroup] = createSignal<{ id: number; name: string } | null>(null)
  const [deleteConfirmGroupId, setDeleteConfirmGroupId] = createSignal<number | null>(null)

  const allCount = () => platform.store.accounts.length
  const groupCount = (id: number) => platform.accountsInGroup(id).length

  const handleCreate = () => {
    const name = newGroupName().trim()
    if (!name) return
    props.onCreateGroup(name)
    setNewGroupName("")
    setShowNewInput(false)
  }

  const handleRename = (id: number) => {
    const name = editName().trim()
    if (!name) return
    props.onRenameGroup(id, name)
    setEditingId(null)
    setEditName("")
  }

  const handleContextMenu = (e: MouseEvent, group: { id: number; name: string }) => {
    e.preventDefault()
    if (group.id === 1) return
    setRenameConfirmGroup(group)
  }

  return (
    <>
    <div class="w-48 shrink-0 border-r border-border-weak-base bg-background-weak/40 flex flex-col h-full">
      <div class="p-3 border-b border-border-weak-base">
        <button
          class="w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-13-medium transition-colors"
          classList={{
            "bg-surface-raised-base-hover text-text-strong": props.selectedGroupId === "all",
            "text-text-weak hover:bg-surface-raised-base-hover": props.selectedGroupId !== "all",
          }}
          onClick={() => props.onSelect("all")}
        >
          <span>全部账号</span>
          <span class="ml-auto text-12-regular text-text-weaker">{allCount()}</span>
        </button>
      </div>

      <div class="p-2">
        <div class="flex items-center justify-between px-2 py-1.5">
          <span class="text-11-regular text-text-weaker uppercase tracking-wider">列表</span>
          <button
            class="size-5 rounded flex items-center justify-center text-text-weak hover:text-text-strong hover:bg-surface-raised-base-hover transition-colors"
            onClick={() => setShowNewInput(true)}
          >
            <Icon name="plus-small" size="small" />
          </button>
        </div>

        <Show when={showNewInput()}>
          <div class="flex items-center gap-1 px-1 py-0.5">
            <input
              class="flex-1 h-7 px-2 rounded border border-border-interactive-base bg-background-base text-12-regular text-text-strong outline-none"
              value={newGroupName()}
              onInput={(e) => setNewGroupName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate()
                if (e.key === "Escape") setShowNewInput(false)
              }}
              placeholder="列表名称"
              autofocus
            />
          </div>
        </Show>

        <For each={platform.store.groups}>
          {(group) => (
            <div
              class="group flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer"
              classList={{
                "bg-surface-raised-base-hover": props.selectedGroupId === group.id,
              }}
            >
              <Show
                when={editingId() === group.id}
                fallback={
                  <button
                    class="flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-12-regular text-left transition-colors hover:bg-surface-raised-base-hover"
                    classList={{
                      "text-text-strong font-medium": props.selectedGroupId === group.id,
                      "text-text-weak": props.selectedGroupId !== group.id,
                    }}
                    onClick={() => props.onSelect(group.id)}
                    onContextMenu={(e) => handleContextMenu(e, group)}
                  >
                    <Icon name="bullet-list" size="small" class="text-text-weaker shrink-0" />
                    <span class="flex-1 truncate">{group.name}</span>
                    <span class="text-11-regular text-text-weaker">{groupCount(group.id)}</span>
                  </button>
                }
              >
                <input
                  class="flex-1 h-7 px-2 rounded border border-border-interactive-base bg-background-base text-12-regular text-text-strong outline-none"
                  value={editName()}
                  onInput={(e) => setEditName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(group.id)
                    if (e.key === "Escape") setEditingId(null)
                  }}
                  autofocus
                />
              </Show>
              <Show when={group.id !== 1 && editingId() !== group.id}>
                <button
                  class="size-5 shrink-0 rounded flex items-center justify-center text-text-weaker hover:text-rose-500 hover:bg-surface-raised-base-hover transition-colors opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirmGroupId(group.id)
                  }}
                >
                  <Icon name="trash" size="small" />
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>

      <div class="mt-auto p-2 border-t border-border-weak-base">
        <Button
          variant="secondary"
          class="w-full"
          onClick={() => setShowNewInput(true)}
        >
          <Icon name="plus-small" size="small" />
          新建列表
        </Button>
      </div>
    </div>
    <ConfirmDialog
        open={renameConfirmGroup() !== null}
        title="重命名列表"
        description={`确定重命名列表「${renameConfirmGroup()?.name || ""}」？`}
        confirmText="重命名"
        variant="normal"
        onConfirm={() => {
          const g = renameConfirmGroup()
          if (g) {
            setEditingId(g.id)
            setEditName(g.name)
          }
        }}
        onClose={() => setRenameConfirmGroup(null)}
      />
      <ConfirmDialog
        open={deleteConfirmGroupId() !== null}
        title="删除列表"
        description={
          <span>
            确定删除列表「<span class="font-medium">{platform.store.groups.find((g) => g.id === deleteConfirmGroupId())?.name || ""}</span>」吗？<br />
            该列表下的账号将移回默认列表。
          </span>
        }
        confirmText="删除"
        variant="danger"
        onConfirm={() => {
          const id = deleteConfirmGroupId()
          if (id) props.onDeleteGroup(id)
        }}
        onClose={() => setDeleteConfirmGroupId(null)}
      />
    </>
  )
}

function AccountTable(props: { accounts: PlatformAccount[]; onMoveGroup: (accountId: string, groupId: number) => void }) {
  const platform = usePlatformAccounts()

  const platformInfo = (platId: string) => PLATFORM_LIST.find((p) => p.id === platId)
  const groupName = (groupId: number) => platform.store.groups.find((g) => g.id === groupId)?.name || "默认列表"

  return (
    <div class="flex-1 overflow-auto">
      <Show
        when={props.accounts.length > 0}
        fallback={
          <div class="flex items-center justify-center h-full text-text-weaker text-14-regular">
            暂无数据
          </div>
        }
      >
        <table class="w-full">
          <thead>
            <tr class="border-b border-border-weak-base">
              <th class="text-left px-4 py-3 text-12-regular text-text-weak font-normal">账号</th>
              <th class="text-left px-4 py-3 text-12-regular text-text-weak font-normal">平台</th>
              <th class="text-left px-4 py-3 text-12-regular text-text-weak font-normal">账号状态</th>
              <th class="text-left px-4 py-3 text-12-regular text-text-weak font-normal">所属列表</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.accounts}>
              {(account) => {
                const info = () => platformInfo(account.platform)
                return (
                  <tr class="border-b border-border-weaker-base hover:bg-surface-raised-base-hover transition-colors">
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-2.5">
                        <div class="size-8 rounded-full bg-background-weak flex items-center justify-center text-12-regular text-text-weak overflow-hidden">
                          {account.avatar ? (
                            <img src={account.avatar} alt="" class="size-full object-cover" />
                          ) : (
                            <span>{account.nickname?.charAt(0)}</span>
                          )}
                        </div>
                        <span class="text-13-medium text-text-strong truncate">{account.nickname}</span>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-1.5">
                        <img src={info()?.icon} alt="" class="size-4" />
                        <span class="text-12-regular text-text-weak">{info()?.name}</span>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <span
                        class="inline-flex items-center gap-1 text-12-regular"
                        classList={{
                          "text-emerald-600 dark:text-emerald-400": account.status === "valid",
                          "text-amber-600 dark:text-amber-400": account.status === "expired",
                          "text-rose-600 dark:text-rose-400": account.status === "login_failed",
                        }}
                      >
                        <span
                          class="size-1.5 rounded-full"
                          classList={{
                            "bg-emerald-500": account.status === "valid",
                            "bg-amber-500": account.status === "expired",
                            "bg-rose-500": account.status === "login_failed",
                          }}
                        />
                        {account.status === "valid" ? "在线" : account.status === "expired" ? "离线" : "异常"}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      <select
                        class="h-7 px-2 rounded border border-border-weak-base bg-background-base text-12-regular text-text-strong outline-none hover:border-border-interactive-base transition-colors cursor-pointer"
                        value={account.groupId}
                        onChange={(e) => {
                          const newGroupId = Number(e.currentTarget.value)
                          if (newGroupId !== account.groupId) {
                            props.onMoveGroup(account.id, newGroupId)
                          }
                        }}
                      >
                        <For each={platform.store.groups}>
                          {(group) => (
                            <option value={group.id}>{group.name}</option>
                          )}
                        </For>
                      </select>
                    </td>
                  </tr>
                )
              }}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  )
}

export function AccountManagerModal() {
  const dialog = useDialog()
  const platform = usePlatformAccounts()
  const [selectedGroupId, setSelectedGroupId] = createSignal<number | "all">("all")

  const filteredAccounts = () => {
    if (selectedGroupId() === "all") return platform.store.accounts
    return platform.accountsInGroup(selectedGroupId() as number)
  }

  return (
    <Dialog title="账号管理器">
      <div class="flex h-[500px]">
        <GroupSidebar
          selectedGroupId={selectedGroupId()}
          onSelect={setSelectedGroupId}
          onCreateGroup={platform.createGroup}
          onRenameGroup={platform.renameGroup}
          onDeleteGroup={platform.deleteGroup}
        />
        <AccountTable accounts={filteredAccounts()} onMoveGroup={(accountId, groupId) => platform.moveAccountToGroup(accountId, groupId)} />
      </div>
    </Dialog>
  )
}
