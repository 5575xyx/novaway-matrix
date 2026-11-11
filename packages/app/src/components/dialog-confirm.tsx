import { JSX } from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Button } from "@novaway/ui/button"
import { Dialog } from "@novaway/ui/dialog"
import { useLanguage } from "@/context/language"

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
  const language = useLanguage()
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
                "text-foreground-subtle": props.variant !== "danger",
                "text-[var(--icon-critical-base)]": props.variant === "danger",
              }}
            >
              {props.description}
            </div>
          </div>
          <div class="flex justify-end gap-2 p-4 pt-0">
            <Button variant="ghost" size="large" onClick={props.onClose}>
              {props.cancelText || language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              classList={{
                "bg-[var(--surface-critical-strong)] hover:bg-[var(--surface-critical-strong)] border-[var(--surface-critical-strong)] text-on-critical-strong":
                  props.variant === "danger",
              }}
              onClick={() => {
                props.onConfirm()
                props.onClose()
              }}
            >
              {props.confirmText || language.t("common.confirm")}
            </Button>
          </div>
        </Dialog>
      </Kobalte.Portal>
    </Kobalte>
  )
}
