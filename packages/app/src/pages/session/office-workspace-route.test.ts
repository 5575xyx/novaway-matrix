import { describe, expect, test } from "bun:test"
import { showOfficeNewSessionWorkspace, showOfficeSessionComposer } from "./office-workspace-route"

describe("office workspace route", () => {
  test("shows the office workspace only before a session is created", () => {
    expect(showOfficeNewSessionWorkspace("zen", undefined)).toBe(true)
    expect(showOfficeNewSessionWorkspace("zen", "ses_1")).toBe(false)
  })

  test("keeps other modes on the original session layout", () => {
    expect(showOfficeNewSessionWorkspace("forge", undefined)).toBe(false)
    expect(showOfficeNewSessionWorkspace("pulse", undefined)).toBe(false)
  })

  test("uses the office composer only after an office session is created", () => {
    expect(showOfficeSessionComposer("zen", undefined)).toBe(false)
    expect(showOfficeSessionComposer("zen", "ses_1")).toBe(true)
    expect(showOfficeSessionComposer("forge", "ses_1")).toBe(false)
    expect(showOfficeSessionComposer("pulse", "ses_1")).toBe(false)
  })
})
