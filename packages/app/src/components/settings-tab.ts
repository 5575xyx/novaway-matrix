export const settingsTabs = [
  "general",
  "notifications",
  "providers",
  "browser",
  "computer",
  "voice",
  "keybinds",
  "agents",
  "memory",
  "skills",
  "commands",
  "hooks",
  "rules",
  "automation",
  "arena",
  "usage",
  "data",
  "extensions",
  "mcp",
] as const

export type SettingsTab = (typeof settingsTabs)[number]

export const isSettingsTab = (value: string): value is SettingsTab => settingsTabs.some((tab) => tab === value)
