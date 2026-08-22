import { JSX } from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"

export type ConfirmVariant = "danger" | "normal"

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

export function ConfirmDialog(props: ConfirmDialogProps) {
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
        <Dialog title={props.title} fit>
          <div data-slot="dialog-body" class="p-4">
            <div
              class="text-14-regular"
              classList={{
                "text-text-weak": props.variant !== "danger",
                "text-rose-600 dark:text-rose-400": props.variant === "danger",
              }}
            >
              {props.description}
            </div>
          </div>
          <div class="flex justify-end gap-2 p-4 pt-0">
            <Button variant="ghost" size="large" onClick={props.onClose}>
              {props.cancelText || "取消"}
            </Button>
            <Button
              variant="primary"
              size="large"
              classList={{
                "bg-rose-600 hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600 border-rose-600 dark:border-rose-500":
                  props.variant === "danger",
              }}
              onClick={() => {
                props.onConfirm()
                props.onClose()
              }}
            >
              {props.confirmText || "确认"}
            </Button>
          </div>
        </Dialog>
      </Kobalte.Portal>
    </Kobalte>
  )
}
