import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { useDialog } from "@novaway/ui/context/dialog"
import { useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@novaway/core/util/encode"
import { produce } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

/**
 * 删除会话确认框。
 *
 * 侧栏的任务行与旧会话列表都要用它（重建前是 `sidebar-items.tsx` 里的私有组件，
 * 任务行接管菜单后就抽出来共用）。删除是级联的：连同所有子会话一起清掉，
 * 删的是当前正在看的会话时还要退回会话空态，否则会停在一个不存在的 id 上。
 */
export function DialogDeleteSession(props: { sessionID: string; title: string; directory: string }) {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const dialog = useDialog()
  const navigate = useNavigate()
  const params = useParams()
  const [, setSessionStore] = globalSync.child(props.directory)

  const removeFromStore = () => {
    const removed = new Set<string>([props.sessionID])
    const byParent = new Map<string, string[]>()
    const sessions = globalSync.child(props.directory)[0].session ?? []
    for (const item of sessions) {
      const parentID = item.parentID
      if (!parentID) continue
      const existing = byParent.get(parentID)
      if (existing) {
        existing.push(item.id)
        continue
      }
      byParent.set(parentID, [item.id])
    }
    const stack = [props.sessionID]
    while (stack.length) {
      const parentID = stack.pop()
      if (!parentID) continue
      const children = byParent.get(parentID)
      if (!children) continue
      for (const child of children) {
        if (removed.has(child)) continue
        removed.add(child)
        stack.push(child)
      }
    }
    setSessionStore(
      "session",
      produce((draft) => {
        for (let i = draft.length - 1; i >= 0; i--) {
          if (removed.has(draft[i].id)) draft.splice(i, 1)
        }
      }),
    )
  }

  const handleDelete = async () => {
    const isCurrentSession = params.id === props.sessionID
    try {
      await globalSDK.client.session.delete({ sessionID: props.sessionID })
    } catch {
      // ignore — session may already be deleted server-side
    }
    removeFromStore()
    dialog.close()
    if (isCurrentSession) {
      navigate(`/${base64Encode(props.directory)}/session`)
    }
  }

  return (
    <Dialog title={language.t("session.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-foreground">
            {language.t("session.delete.confirm", { name: props.title })}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={() => void handleDelete()}>
            {language.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
