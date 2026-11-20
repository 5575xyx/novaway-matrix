import { describe, expect, test } from "bun:test"
import {
  SuperAgentSecurityError,
  assertCommand,
  assertExternalURL,
  assertExternalURLResolved,
  assertRuntimeType,
  requiresApproval,
} from "../../src/super-agent/security"

describe("Super-Agent security gate", () => {
  test("enforces runtime and command namespaces", () => {
    expect(() => assertRuntimeType("plugin.agent", { allowedRuntimeTypes: ["plugin.agent"] })).not.toThrow()
    expect(() => assertRuntimeType("other.agent", { allowedRuntimeTypes: ["plugin.agent"] })).toThrow(SuperAgentSecurityError)
    expect(() => assertCommand("bun", { allowedCommands: ["bun"] })).not.toThrow()
    expect(() => assertCommand("bun; whoami", { allowedCommands: ["bun"] })).toThrow(SuperAgentSecurityError)
    expect(() => assertCommand("../bun", { allowedCommands: ["bun"] })).toThrow(SuperAgentSecurityError)
  })

  test("rejects credentialed and private network targets by default", async () => {
    expect(() => assertExternalURL("https://example.com/agent")).not.toThrow()
    expect(() => assertExternalURL("http://example.com/agent")).toThrow(SuperAgentSecurityError)
    expect(() => assertExternalURL("https://127.0.0.1/agent")).toThrow(SuperAgentSecurityError)
    expect(() => assertExternalURL("https://user:secret@example.com/agent")).toThrow(SuperAgentSecurityError)
    expect(() => assertExternalURL("http://localhost:4199", { allowHttp: true })).toThrow(SuperAgentSecurityError)
    await expect(
      assertExternalURLResolved("https://rebind.example", {}, async () => [{ address: "127.0.0.1" }]),
    ).rejects.toThrow(SuperAgentSecurityError)
    await expect(
      assertExternalURLResolved("https://public.example", {}, async () => [{ address: "203.0.113.10" }]),
    ).resolves.toMatchObject({ hostname: "public.example" })
  })

  test("keeps dangerous capabilities behind approval", () => {
    expect(requiresApproval("command")).toBe(true)
    expect(requiresApproval("external_network")).toBe(true)
    expect(requiresApproval("read_file", { approvalRequiredCapabilities: ["write_file"] })).toBe(false)
    expect(requiresApproval("write_file", { approvalRequiredCapabilities: ["write_file"] })).toBe(true)
  })
})
