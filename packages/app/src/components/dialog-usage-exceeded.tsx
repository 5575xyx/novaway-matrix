import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { Button } from "@novaway/ui/button"
import { useDialog } from "@novaway/ui/context/dialog"
import { Dialog } from "@novaway/ui/dialog"
import { JSX } from "solid-js"

export type DialogGoUpsellProps = {
  title: string
  description: JSX.Element
  link?: string
  actionLabel: string
  onClose?: (dontShowAgain?: boolean) => void
}

export function DialogUsageExceeded(props: DialogGoUpsellProps) {
  const dialog = useDialog()
  const platform = usePlatform()
  const language = useLanguage()

  const dismiss = () => {
    props.onClose?.(true)
    dialog.close()
  }

  return (
    <Dialog title={props.title} description={props.description} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={dismiss}>
            {language.t("dialog.usageExceeded.doNotShow")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
