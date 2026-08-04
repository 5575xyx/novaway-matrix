import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { ConfigCommand } from "../../src/config/command"

describe("ConfigCommand evolution artifact loading", () => {
  test("loads workflows and prompts as slash-command templates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "novaway-cmd-"))
    await mkdir(path.join(root, "workflows"), { recursive: true })
    await mkdir(path.join(root, "prompts"), { recursive: true })
    await mkdir(path.join(root, "commands"), { recursive: true })

    await writeFile(
      path.join(root, "commands", "daily.md"),
      `---
description: Daily status command
---

Daily status for $ARGUMENTS
`,
    )
    await writeFile(
      path.join(root, "workflows", "incident-response.md"),
      `# Incident Response

1. Collect symptoms
2. Mitigate
3. Write postmortem
`,
    )
    await writeFile(
      path.join(root, "prompts", "office-brief.md"),
      `---
description: Office brief prompt
---

Write a concise office brief.
`,
    )

    const loaded = await ConfigCommand.load(root)
    expect(loaded.daily?.template).toContain("Daily status")
    expect(loaded["incident-response"]?.template).toContain("postmortem")
    expect(loaded["incident-response"]?.description).toContain("workflow")
    expect(loaded["office-brief"]?.template).toContain("office brief")
    expect(loaded["office-brief"]?.description).toContain("Office brief")
  })
})
