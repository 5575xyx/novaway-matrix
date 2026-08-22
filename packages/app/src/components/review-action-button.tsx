import { IconButton } from "@novaway/ui/icon-button"
import { Tooltip } from "@novaway/ui/tooltip"
import type { Component, ComponentProps } from "solid-js"

export const ReviewActionButton: Component<{
  icon: ComponentProps<typeof IconButton>["icon"]
  label: string
  disabled?: boolean
  onClick: () => void
}> = (props) => (
  <Tooltip value={props.label} placement="top">
    <IconButton
      icon={props.icon}
      variant="ghost"
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props.label}
    />
  </Tooltip>
)
