import { describe, expect, test } from "bun:test"

import { checkQuarantine, exclusionCommand, DEFENDER_URIS } from "./defender-repair"

describe("defender-repair", () => {
  test("non-Windows platforms never report quarantine", () => {
    const orig = process.platform
    Object.defineProperty(process, "platform", { value: "darwin" })
    try {
      expect(checkQuarantine("C:/x/NovaWay.exe", () => false).quarantined).toBe(false)
    } finally {
      Object.defineProperty(process, "platform", { value: orig })
    }
  })

  test("missing execPath reports dirMissing quarantine", () => {
    const orig = process.platform
    Object.defineProperty(process, "platform", { value: "win32" })
    try {
      const r = checkQuarantine("E:/novaway/NovaWay.exe", () => false)
      expect(r.quarantined).toBe(true)
      expect(r.dirMissing).toBe(true)
      expect(r.missing).toContain("NovaWay.exe")
    } finally {
      Object.defineProperty(process, "platform", { value: orig })
    }
  })

  test("all files present means healthy", () => {
    const orig = process.platform
    Object.defineProperty(process, "platform", { value: "win32" })
    try {
      const r = checkQuarantine("E:/novaway/NovaWay.exe", () => true)
      expect(r.quarantined).toBe(false)
      expect(r.missing).toEqual([])
    } finally {
      Object.defineProperty(process, "platform", { value: orig })
    }
  })

  test("two or more missing DLLs flags quarantine even with exe present", () => {
    const orig = process.platform
    Object.defineProperty(process, "platform", { value: "win32" })
    try {
      const present = new Set(["E:/novaway/NovaWay.exe", "E:/novaway/ffmpeg.dll"])
      const r = checkQuarantine("E:/novaway/NovaWay.exe", (p) => present.has(p))
      expect(r.quarantined).toBe(true)
      expect(r.dirMissing).toBe(false)
      expect(r.missing.length).toBeGreaterThanOrEqual(2)
    } finally {
      Object.defineProperty(process, "platform", { value: orig })
    }
  })

  test("single missing DLL is tolerated (not quarantine signature)", () => {
    const orig = process.platform
    Object.defineProperty(process, "platform", { value: "win32" })
    try {
      const present = new Set(["E:/novaway/NovaWay.exe", "E:/novaway/ffmpeg.dll", "E:/novaway/libGLESv2.dll", "E:/novaway/libEGL.dll"])
      const r = checkQuarantine("E:/novaway/NovaWay.exe", (p) => present.has(p))
      expect(r.quarantined).toBe(false)
    } finally {
      Object.defineProperty(process, "platform", { value: orig })
    }
  })

  test("exclusion command embeds the install dir", () => {
    const cmd = exclusionCommand("E:\novaway")
    expect(cmd).toContain("Add-MpPreference -ExclusionPath")
    expect(cmd).toContain("E:\novaway")
    expect(cmd).toContain("-Verb runAs")
  })

  test("defender URIs are the official protocol links", () => {
    expect(DEFENDER_URIS.history).toBe("windowsdefender://history")
    expect(DEFENDER_URIS.settings).toBe("windowsdefender://threatsettings")
  })
})
