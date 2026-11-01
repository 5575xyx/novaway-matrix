import { Dialog } from "@novaway/ui/dialog"
import { Button } from "@novaway/ui/button"
import { Markdown } from "@novaway/ui/markdown"
import { useDialog } from "@novaway/ui/context/dialog"
import { useLanguage } from "@/context/language"

/**
 * 更新详情弹窗：点侧栏那颗更新按钮时出现。
 *
 * 内容来自安装包元数据里的 releaseNotes（打包时由 packages/desktop/release-notes.md
 * 写进 latest.yml），所以「这次修了什么」完全由我们自己维护，不需要依赖 GitHub
 * Release 的正文。没写说明时明确说一句，而不是留一片空白。
 *
 * `action` 决定按钮语义：
 *  - "download" —— 手检查到新版本、还没下载，点一下开始下载（进度回到侧栏按钮上）；
 *  - "install"  —— 安装包已经下好，点一下安装并重启。
 */
export function DialogUpdateNotes(props: {
  version?: string
  notes?: string
  action: "download" | "install"
  busy: boolean
  onAction: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const title = () =>
    props.version
      ? language.t("update.notes.title", { version: props.version })
      : language.t("update.notes.titleFallback")

  return (
    <Dialog
      size="large"
      title={title()}
      class="w-[min(calc(100vw-40px),560px)] max-h-[min(calc(100vh-40px),560px)]"
      footer={
        <div class="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("toast.update.action.notYet")}
          </Button>
          <Button variant="primary" size="large" disabled={props.busy} onClick={props.onAction}>
            {props.action === "download"
              ? language.t("update.action.download")
              : language.t("update.action.install")}
          </Button>
        </div>
      }
    >
      <div class="min-h-0 w-full overflow-y-auto px-1 py-1 text-13-regular">
        {props.notes ? (
          <Markdown text={props.notes} cacheKey={`update-notes:${props.version ?? ""}`} class="text-13-regular" />
        ) : (
          <p class="text-13-regular text-foreground-subtle">{language.t("update.notes.empty")}</p>
        )}
      </div>
    </Dialog>
  )
}
