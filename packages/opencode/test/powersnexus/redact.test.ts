import { expect, test } from "bun:test"
import { redactArgv, redactEvidence, redactSecrets, redactUrl } from "../../src/powersnexus/redact"

test("脱敏 Bearer/JWT/API Key 与赋值型密钥", () => {
  expect(redactSecrets("Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz")).toContain("***REDACTED***")
  expect(redactSecrets("token=eyJhbGciOiJIUzI1NiJ9.abc.def")).toContain("***REDACTED***")
  expect(redactSecrets("api_key: super-secret-value")).toContain("***REDACTED***")
  expect(redactSecrets("password=hunter2")).toContain("***REDACTED***")
  expect(redactSecrets("hello world")).toBe("hello world")
})

test("脱敏 argv 中紧随敏感 flag 的值", () => {
  expect(redactArgv(["curl", "--token", "xyz", "--password", "hunter2", "https://example.com"])).toEqual([
    "curl",
    "--token",
    "***REDACTED***",
    "--password",
    "***REDACTED***",
    "https://example.com",
  ])
  expect(redactArgv(["-H", "Authorization: Bearer abcdef"])[1]).toContain("***REDACTED***")
})

test("脱敏 URL 查询参数、userinfo 与证据地址", () => {
  const safe = redactUrl("https://user:pass@example.test/api?token=abc&name=ok&api_key=xyz")
  expect(safe).not.toContain("user")
  expect(safe).not.toContain("pass")
  expect(safe).not.toContain("abc")
  expect(safe).not.toContain("xyz")
  expect(safe).toContain("name=ok")
  expect(redactEvidence(["https://example.test/path?access_token=secret"])[0]).not.toContain("secret")
})
