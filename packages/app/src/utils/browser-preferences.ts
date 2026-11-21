/**
 * Whether task-created pages should be shown in the app's right-hand browser pane.
 *
 * The option is intentionally opt-out: older configs do not contain it and should
 * get the new embedded-browser behavior without a migration.
 */
export function browserEmbeddedEnabled(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return true
  const browser = (config as { browser?: unknown }).browser
  if (!browser || typeof browser !== "object" || Array.isArray(browser)) return true
  return (browser as { open_in_app?: unknown }).open_in_app !== false
}
