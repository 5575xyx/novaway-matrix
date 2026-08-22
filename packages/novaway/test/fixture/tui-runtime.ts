import { createBindingLookup } from "@opentui/keymap/extras"
import { TuiConfig } from "@/config/tui"
import { TuiKeybind } from "@novaway/tui/config/keybind"

type ResolvedInput = Omit<TuiConfig.Resolved, "attention" | "keybinds" | "leader_timeout" | "mouse"> & {
  attention?: Partial<TuiConfig.Resolved["attention"]>
  keybinds?: Partial<TuiKeybind.Keybinds>
  leader_timeout?: number
  mouse?: boolean
}

export function createTuiResolvedKeybinds(input: Partial<TuiKeybind.Keybinds> = {}): TuiConfig.Resolved["keybinds"] {
  const keybinds = TuiKeybind.Keybinds.parse(input)
  return createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
    commandMap: TuiKeybind.CommandMap,
    bindingDefaults: TuiKeybind.bindingDefaults(),
  })
}

export function createTuiResolvedConfig(input: ResolvedInput = {}): TuiConfig.Resolved {
  const keybinds = TuiKeybind.Keybinds.parse(input.keybinds ?? {})
  return {
    ...input,
    mouse: true,
    attention: {
      enabled: false,
      notifications: true,
      sound: true,
      volume: 0.4,
      sound_pack: "opencode.default",
      sounds: {},
      ...input.attention,
    },
    keybinds: createTuiResolvedKeybinds(keybinds),
    leader_timeout: input.leader_timeout ?? 2000,
  }
}
