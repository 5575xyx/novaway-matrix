import { JSX, Show } from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"

export type ConfirmVariant = "danger" | "normal" | "uninstall"

export type ConfirmDialogProps = {
  open: boolean
  title: string
  description: JSX.Element | string
  confirmText?: string
  cancelText?: string
  variant?: ConfirmVariant
  onConfirm: () => void
  onClose: () => void
}

/**
 * NovaWay 统一确认弹窗。
 *
 * 所有需要用户二次确认的操作都从这里进入，避免设置页和扩展页各自
 * 拼出一套不同的遮罩、按钮和间距。uninstall 是专门的轻量危险变体。
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const language = useLanguage()
  const isDanger = () => props.variant === "danger" || props.variant === "uninstall"
  const isUninstall = () => props.variant === "uninstall"

  return (
    <Kobalte
      modal
      preventScroll={false}
      open={props.open}
      onOpenChange={(open: boolean) => {
        if (!open) props.onClose()
      }}
    >
      <Kobalte.Portal>
        <Kobalte.Overlay data-component="dialog-overlay" onClick={props.onClose} />
        <Dialog
          title={props.title}
          fit
          variant={isUninstall() ? "uninstall" : isDanger() ? "danger" : "default"}
          class="[&_[data-slot=dialog-title]]:flex-1"
          footer={
            <>
              <Button variant="ghost" size="large" onClick={props.onClose}>
                {props.cancelText || language.t("common.cancel")}
              </Button>
              <Button
                variant={isDanger() ? "destructive" : "primary"}
                size="large"
                onClick={() => {
                  props.onConfirm()
                  props.onClose()
                }}
              >
                {props.confirmText || language.t("common.confirm")}
              </Button>
            </>
          }
        >
          <div class="flex items-start gap-3 px-5 py-4">
            <Show when={isDanger()}>
              <div
                class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full"
                classList={{
                  "bg-surface-critical-weak text-text-critical-base": true,
                }}
              >
                <Icon name={isUninstall() ? "trash" : "warning"} size="normal" />
              </div>
            </Show>
            <div
              class="min-w-0 text-14-regular leading-6"
              classList={{
                "text-foreground-subtle": !isDanger(),
                "text-foreground": isDanger(),
              }}
            >
              {props.description}
            </div>
          </div>
        </Dialog>
      </Kobalte.Portal>
    </Kobalte>
  )
}
