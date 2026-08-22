import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerNovaWaySpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
