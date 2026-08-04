export type FloatingWidgetMode = "full" | "minimal"

export function resolveFloatingWidgetMode(visible: boolean): FloatingWidgetMode {
  return visible ? "full" : "minimal"
}

export function resolveFloatingRestoreAnchor(
  minimalBounds: { x: number; y: number; width: number; height: number },
  collapsedSize: number,
) {
  return {
    x: minimalBounds.x + minimalBounds.width - collapsedSize,
    y: minimalBounds.y + minimalBounds.height - collapsedSize,
  }
}
