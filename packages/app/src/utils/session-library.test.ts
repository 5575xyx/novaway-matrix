import { describe, expect, test } from "bun:test"
import { branchChannel } from "./session-library"

describe("branchChannel", () => {
  test("reads the branch name out of a dev build version", () => {
    expect(branchChannel("0.0.0-feat/team-orchestration-202610291155")).toBe("feat/team-orchestration")
    expect(branchChannel("0.0.0-main-202610291155")).toBe("main")
  })

  test("stays quiet for release builds", () => {
    expect(branchChannel("1.2.3")).toBeUndefined()
    expect(branchChannel(undefined)).toBeUndefined()
  })

  test("stays quiet for shared channels", () => {
    expect(branchChannel("0.0.0-latest-202610291155")).toBeUndefined()
    expect(branchChannel("0.0.0-local-202610291155")).toBeUndefined()
    expect(branchChannel("0.0.0-prod-202610291155")).toBeUndefined()
  })
})
