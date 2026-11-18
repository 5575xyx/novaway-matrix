import { expect, test } from "bun:test"
import { Schema } from "effect"
import { MarketplaceEntry } from "@/server/routes/instance/httpapi/groups/extension"

test("marketplace API preserves localized names and market types", () => {
  const entry = Schema.decodeUnknownSync(MarketplaceEntry)({
    name: "NovaWay Office Workbench",
    packageId: "com.novaway.office-suite",
    displayName: "办公工作台",
    displayNameI18n: { "zh-CN": "办公工作台", en: "Office Workbench" },
    version: "0.2.0",
    description: "办公工作台",
    longDescription: "完整办公工作台",
    author: "NovaWay-AI",
    license: "MIT",
    url: "https://example.com/office.zip",
    kind: "zip",
    categories: ["office", "productivity"],
    marketTypes: ["workbench", "agents", "skills", "tools", "commands"],
    capabilities: ["agents", "skills", "tools", "commands"],
  })

  expect(entry).toMatchObject({
    displayName: "办公工作台",
    displayNameI18n: { "zh-CN": "办公工作台", en: "Office Workbench" },
    categories: ["office", "productivity"],
    marketTypes: ["workbench", "agents", "skills", "tools", "commands"],
  })
})
