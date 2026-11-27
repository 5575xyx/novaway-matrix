const STORAGE_KEY = "novaway.voice.settings.pending"

export type VoiceSettingsStorage = Record<string, unknown>

const notifyVoiceSettingsChanged = () => {
  if (typeof globalThis.dispatchEvent === "function") {
    globalThis.dispatchEvent(new Event("novaway-voice-settings"))
  }
}

export function readVoiceSettingsStorage(): VoiceSettingsStorage {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const value: unknown = JSON.parse(raw)
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as VoiceSettingsStorage)
      : {}
  } catch {
    return {}
  }
}

export function writeVoiceSettingsStorage(value: VoiceSettingsStorage) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Browser storage can be disabled; the server config remains authoritative.
  }
  notifyVoiceSettingsChanged()
}

export function clearVoiceSettingsStorage() {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // Ignore disabled storage.
  }
  notifyVoiceSettingsChanged()
}
