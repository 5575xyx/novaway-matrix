import { Component, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useDialog } from "@novaway/ui/context/dialog"
import { Dialog } from "@novaway/ui/dialog"
import { List } from "@novaway/ui/list"
import { useLanguage } from "@/context/language"
import type { TextPart as SDKTextPart } from "@novaway/sdk/v2/client"

interface RevertTurn {
  id: string
  index: number
  text: string
  time: string
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

/**
 * 统一回滚入口：把本会话的用户提问按轮次列出来，选中一条即回滚到它发出之前。
 * 真正执行回滚的是会话页的 revert（先预览受影响文件、再让用户确认），这里只负责选点。
 */
export const DialogRevert: Component<{ onSelect: (messageID: string) => void }> = (props) => {
  const params = useParams()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()

  const turns = createMemo((): RevertTurn[] => {
    const sessionID = params.id
    if (!sessionID) return []

    const result: RevertTurn[] = []
    for (const message of sync.data.message[sessionID] ?? []) {
      if (message.role !== "user") continue

      const parts = sync.data.part[message.id] ?? []
      const textPart = parts.find((x): x is SDKTextPart => x.type === "text" && !x.synthetic && !x.ignored)
      if (!textPart) continue

      result.push({
        id: message.id,
        index: result.length + 1,
        text: textPart.text.replace(/\n/g, " ").slice(0, 200),
        time: formatTime(new Date(message.time.created)),
      })
    }

    return result.reverse()
  })

  return (
    <Dialog title={language.t("command.session.revertTo")}>
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.revertTurn.empty")}
        key={(x) => x.id}
        items={turns}
        filterKeys={["text"]}
        onSelect={(item) => {
          if (!item) return
          dialog.close()
          props.onSelect(item.id)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="shrink-0 tabular-nums text-foreground-subtlest font-normal">{item.index}</span>
            <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
            <span class="text-foreground-subtle shrink-0 font-normal">{item.time}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
