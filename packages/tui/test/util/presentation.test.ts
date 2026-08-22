import { expect, test } from "bun:test"
import stripAnsi from "strip-ansi"
import { sessionEpilogue } from "../../src/util/presentation"

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  const plain = stripAnsi(epilogue)
  expect(plain).toContain("█▀▄█")
  expect(plain).toContain("█   █")
  expect(epilogue).toContain("A session")
  expect(epilogue).toContain("novaway -s ses_123")
})
