import { describe, expect, test } from "bun:test"
import { errors, parseConfigSpec, parseFile, warnings } from "../../src/plugin/manifest"
import {
  contributesKeys,
  contributionDeclarationKeys,
  contributionDeclarationKinds,
  contributionKinds,
  contributionSettingKeys,
  runtimeOnlyContributionKinds,
} from "@novaway/plugin-api"

/** §14.3 第 3 步的验收：三类现存输入都能归一成同一个 Manifest v2 结构。 */
const codes = (list: { code: string }[]) => list.map((item) => item.code)

test("manifest contribution keys and registry kinds are explicitly classified", () => {
  expect([...contributionDeclarationKeys, ...contributionSettingKeys].toSorted()).toEqual(
    [...contributesKeys].toSorted(),
  )
  expect([...contributionDeclarationKinds, ...runtimeOnlyContributionKinds].toSorted()).toEqual(
    [...contributionKinds].toSorted(),
  )
})

/** 真实的 Claude marketplace 样本（ppt-master 的 .claude-plugin/plugin.json，字段照抄）。 */
const claudePptMaster = {
  $schema: "https://json.schemastore.org/claude-code-plugin-manifest.json",
  name: "ppt-master",
  description: "Generate natively editable PPTX from PDF / DOCX / URL / Markdown.",
  author: { name: "Hugo He", email: "heyug3@gmail.com", url: "https://www.hehugo.com/" },
  homepage: "https://github.com/hugohe3/ppt-master",
  repository: "https://github.com/hugohe3/ppt-master",
  license: "MIT",
  keywords: ["pptx", "presentation", "powerpoint", "svg", "drawingml", "ai", "skill", "office", "document-conversion"],
  skills: "./",
}

/** 真实的 zcode 样本：MCP 用 Claude 那套 stdio + command 字符串 + args。 */
const zcodeMcp = {
  name: "e2e-plugin-mcp-ping",
  version: "0.0.0",
  description: "E2E fixture plugin: exposes one read-only MCP tool (ping).",
  skills: "skills",
  userConfig: { label: { type: "string", title: "Workspace label", default: "user-default" } },
  author: { name: "ZCode E2E" },
  license: "MIT",
  mcpServers: {
    ping: {
      type: "stdio",
      command: "node",
      args: ["${ZCODE_PLUGIN_ROOT}/server.mjs"],
      env: { E2E_PLUGIN_RUNTIME_SECRET: "${user_config.secret}" },
    },
  },
}

/** 旧 extension 机制：contributes 形状（src/extension/schema.ts 的 Manifest）。 */
const legacyExtension = {
  name: "legacy_thing",
  manifestVersion: 1,
  version: "2.1.0",
  main: "./index.js",
  contributes: {
    commands: ["./commands"],
    agents: "./agents",
    skills: ["./skills"],
    hooks: "./hooks/hooks.json",
    outputStyles: "./output-styles",
    mcpServers: { thing: { type: "local", command: ["node", "server.js"], enabled: true, timeout: 30 } },
    lspServers: { typescript: { command: "tsserver" } },
    tools: ["./tools"],
  },
  permissions: { tools: ["novaway_bash"], network: ["api.example.com"], filesystem: ["workspace-read", "everywhere"] },
}

/** v2 声明式样本（与 packages/plugin-api/test/fixture/declarative/plugin.json 同一份）。 */
const v2Declarative = {
  name: "acme-weather",
  version: "1.0.0",
  apiVersion: 2,
  kind: "declarative",
  license: "MIT",
  categories: ["demo"],
  activationEvents: ["onTool:acme-weather_weather"],
  capabilities: { network: ["wttr.in"] },
  contributes: {
    tools: [
      {
        id: "weather",
        entry: "./tools/weather.js",
        description: "Get current weather for a city",
        parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        safety: { readOnly: true, concurrencySafe: true, destructive: false, idempotent: true },
      },
    ],
    skills: ["./skills"],
    storage: { namespace: "acme-weather", migrations: "./migrations" },
  },
}

describe("parseFile：Claude marketplace", () => {
  const hit = parseFile(claudePptMaster, { file: ".claude-plugin/plugin.json" })

  test("认得 .claude-plugin 来源并补 apiVersion=1", () => {
    expect(hit.source).toBe("claude")
    expect(hit.manifest.name).toBe("ppt-master")
    expect(hit.manifest.apiVersion).toBe(1)
    expect(hit.manifest.kind).toBe("declarative")
    expect(errors(hit.issues)).toEqual([])
  })

  test("skills 单个字符串归一成数组，keywords 进 categories", () => {
    expect(hit.manifest.contributes.skills).toEqual(["./"])
    expect(hit.manifest.categories).toEqual(claudePptMaster.keywords)
    expect(hit.manifest.license).toBe("MIT")
    expect(hit.manifest.description).toBe(claudePptMaster.description)
  })

  test("没声明的 commands/agents 按 CONVENTIONAL 补出来，并记进 legacy.fallback", () => {
    expect(hit.manifest.contributes.commands).toEqual(["commands"])
    expect(hit.manifest.legacy).toMatchObject({
      adapter: "legacy-extension",
      fallback: ["commands", "agents"],
      // author/$schema/homepage 这些 v2 没有位置的字段不许丢
      raw: { author: claudePptMaster.author },
    })
  })

  test("stdio + command 字符串 + args 拼成 v2 的 command 数组", () => {
    const mcp = parseFile(zcodeMcp, { file: ".zcode-plugin/plugin.json" })
    expect(errors(mcp.issues)).toEqual([])
    expect(mcp.manifest.contributes.mcpServers).toEqual({
      ping: {
        type: "local",
        command: ["node", "${ZCODE_PLUGIN_ROOT}/server.mjs"],
        env: { E2E_PLUGIN_RUNTIME_SECRET: "${user_config.secret}" },
      },
    })
  })
})

describe("parseFile：旧 extension 机制", () => {
  const hit = parseFile(legacyExtension, { file: "extension.json" })

  test("main 推出 kind=code，permissions 映射成 capabilities", () => {
    expect(hit.source).toBe("extension")
    expect(hit.manifest.kind).toBe("code")
    expect(hit.manifest.main).toBe("./index.js")
    expect(hit.manifest.manifestVersion).toBe(1)
    expect(hit.manifest.capabilities).toEqual({
      tools: ["novaway_bash"],
      network: ["api.example.com"],
      fs: ["workspace-read"],
    })
  })

  test("v2 放不下的字段只报 warning，不阻断解析", () => {
    expect(errors(hit.issues)).toEqual([])
    expect(codes(hit.issues)).toContain("unmapped_field")
    expect(codes(hit.issues)).toContain("capability_unknown")
    expect(hit.manifest.legacy).toMatchObject({ unmapped: expect.arrayContaining(["tools", "lspServers"]) })
    expect(warnings(hit.issues).some((item) => item.message.includes("everywhere"))).toBe(true)
  })

  test("hooks 进 lifecycleHooks，MCP 的用户态字段点名报出", () => {
    expect(hit.manifest.contributes.lifecycleHooks).toBe("./hooks/hooks.json")
    expect(hit.manifest.contributes.outputStyles).toBe("./output-styles")
    expect(hit.manifest.contributes.mcpServers).toEqual({ thing: { type: "local", command: ["node", "server.js"] } })
    expect(warnings(hit.issues).some((item) => item.message.includes("thing.enabled"))).toBe(true)
  })
})

describe("parseFile：Manifest v2", () => {
  const hit = parseFile(v2Declarative, { file: "plugin.json" })

  test("声明式 v2 原样读入，不该有任何 issue", () => {
    expect(hit.source).toBe("v2")
    expect(hit.issues).toEqual([])
    expect(hit.manifest.apiVersion).toBe(2)
    expect(hit.manifest.contributes.tools?.[0]?.id).toBe("weather")
    expect(hit.manifest.contributes.storage).toEqual({ namespace: "acme-weather", migrations: "./migrations" })
  })

  test("缺 main 的代码型插件报 error", () => {
    const broken = parseFile(
      { name: "code_thing", apiVersion: 2, kind: "code", contributes: {} },
      { file: "plugin.json" },
    )
    expect(codes(errors(broken.issues))).toContain("main_missing")
  })

  test("未知的贡献点键、非法激活事件、非 builtin 的 overrides 各自报出来", () => {
    const odd = parseFile(
      {
        name: "odd_thing",
        apiVersion: 2,
        kind: "declarative",
        activationEvents: ["onStartup", "onTool:", "onBogus:x", "onView:odd_thing.dashboard"],
        overrides: ["other_plugin", "builtin.knowledge:knowledge_search"],
        contributes: { tools: [], unicorns: ["./u"], mcpServers: { a: {} }, storage: { namespace: "odd_thing" } },
      },
      { file: "plugin.json" },
    )
    const list = odd.issues
    expect(codes(list)).toContain("contributes_unknown_key")
    expect(codes(list)).toContain("activation_event_invalid")
    expect(codes(list)).toContain("contribution_incomplete")
    expect(codes(errors(list))).toContain("contribution_incomplete")
    expect(warnings(list).filter((item) => item.code === "unmapped_field").length).toBeGreaterThan(0)
  })

  test("apiVersion 只实现 2：更高版本按 v2 尽力解析并报 error", () => {
    const future = parseFile(
      { name: "future_thing", apiVersion: 3, contributes: { skills: ["./skills"] } },
      { file: "plugin.json" },
    )
    expect(codes(errors(future.issues))).toContain("api_version")
    expect(future.manifest.contributes.skills).toEqual(["./skills"])
  })

  test("工具 id 重复、缺 description/parameters 都要报出来", () => {
    const dup = parseFile(
      {
        name: "dup_thing",
        apiVersion: 2,
        kind: "declarative",
        contributes: {
          tools: [
            { id: "a", entry: "./a.js", description: "d", parameters: { type: "object" } },
            { id: "a" },
            { id: "b", entry: "./b.js" },
          ],
        },
      },
      { file: "plugin.json" },
    )
    expect(codes(errors(dup.issues))).toContain("contribution_duplicate")
    expect(codes(warnings(dup.issues))).toContain("contribution_incomplete")
    expect(dup.manifest.contributes.tools?.length).toBe(2)
  })

  test("manifest 不是对象时用调用方给的目录名兜底", () => {
    const nope = parseFile("not a manifest", { file: "plugin.json", fallbackName: "dir_Name" })
    expect(nope.manifest.name).toBe("dir_name")
    expect(codes(errors(nope.issues))).toContain("manifest_shape")
    expect(codes(nope.issues)).toContain("name_normalized")
    expect(parseFile(null, { file: "plugin.json" }).manifest.name).toBe("")
    expect(codes(errors(parseFile(null, { file: "plugin.json" }).issues))).toContain("name_missing")
  })
})

describe("归一化的收敛性：三类输入落到同一个结构", () => {
  const skillsOf = { name: "same_thing", skills: "./skills" }
  const contributesForm = { name: "same_thing", contributes: { skills: ["./skills"] } }
  const v2Form = { name: "same_thing", apiVersion: 2, contributes: { skills: ["./skills"] } }

  test("contributes.skills 三条路径拼出来完全一致", () => {
    const list = [skillsOf, contributesForm, v2Form].map((raw) => parseFile(raw, { file: "plugin.json" }))
    for (const hit of list) expect(hit.manifest.contributes.skills).toEqual(["./skills"])
    // 顶层字段与 contributes 字段同时出现时 contributes 赢，与旧 contributions() 一致
    expect(
      parseFile({ ...contributesForm, skills: "./other" }, { file: "plugin.json" }).manifest.contributes.skills,
    ).toEqual(["./skills"])
  })

  test("id 的大小写与 npm scope 折叠成 §7.2 的字符集", () => {
    expect(parseFile({ name: "PowersNexus", contributes: {} }, { file: "plugin.json" }).manifest.name).toBe(
      "powersnexus",
    )
    expect(parseFile({ name: "@Scope/Plug", contributes: {} }, { file: "plugin.json" }).manifest.name).toBe(
      "scope_plug",
    )
    expect(codes(errors(parseFile({ name: "-leading", contributes: {} }, { file: "plugin.json" }).issues))).toContain(
      "name_invalid",
    )
  })
})

describe("legacy normalization snapshot", () => {
  test("preserves normalized declarations for the legacy Extension fixture", () => {
    const normalized = parseFile(legacyExtension, { file: "extension.json", fallbackName: "legacy_thing" })

    expect(normalized).toEqual(parseFile(legacyExtension, { file: "extension.json", fallbackName: "legacy_thing" }))
    expect(normalized.manifest).toMatchObject({
      name: "legacy_thing",
      apiVersion: 1,
      kind: "code",
      main: "./index.js",
      contributes: {
        commands: ["./commands"],
        agents: ["./agents"],
        skills: ["./skills"],
        lifecycleHooks: "./hooks/hooks.json",
        mcpServers: { thing: { type: "local", command: ["node", "server.js"] } },
        outputStyles: "./output-styles",
      },
      capabilities: { tools: ["novaway_bash"], network: ["api.example.com"], fs: ["workspace-read"] },
      legacy: { adapter: "legacy-extension", fallback: [], unmapped: ["tools", "mcpServers", "lspServers"] },
    })
  })
})

describe("v2 Surface / Previewer declarations", () => {
  test("normalizes supported render forms without dropping metadata", () => {
    const hit = parseFile(
      {
        name: "surface-author",
        apiVersion: 2,
        contributes: {
          surfaces: [
            {
              slot: "sidebar.item",
              id: "dashboard",
              title: "Dashboard",
              icon: "home",
              order: 10,
              action: { type: "view", viewId: "dashboard", render: { type: "iframe", url: "https://example.test/ui" } },
            },
            {
              slot: "settings.section",
              id: "settings",
              title: "Settings",
              view: { type: "declarative", fields: [{ key: "enabled", type: "boolean", label: "Enabled" }] },
            },
          ],
          previewers: [
            {
              id: "foo",
              match: { extension: ".foo" },
              render: { type: "iframe", url: "https://example.test/preview" },
              priority: 2,
              order: 1,
            },
          ],
        },
      },
      { file: "plugin.json" },
    )
    expect(errors(hit.issues)).toEqual([])
    expect(hit.manifest.contributes.surfaces?.[0]).toMatchObject({
      slot: "sidebar.item",
      action: { type: "view", render: { type: "iframe", url: "https://example.test/ui" } },
    })
    expect(hit.manifest.contributes.previewers?.[0]).toMatchObject({
      id: "foo",
      render: { type: "iframe", url: "https://example.test/preview" },
      order: 1,
    })
  })

  test("rejects unknown slots, unsafe URLs, host commands and unresolved previewers", () => {
    const hit = parseFile(
      {
        name: "bad-surface",
        apiVersion: 2,
        contributes: {
          surfaces: [
            { slot: "unknown.slot", id: "unknown", title: "Unknown", action: { type: "url", url: "https://x.test" } },
            {
              slot: "sidebar.item",
              id: "unsafe",
              title: "Unsafe",
              icon: "home",
              action: { type: "url", url: "javascript:alert(1)" },
            },
            {
              slot: "sidebar.item",
              id: "host",
              title: "Host",
              icon: "home",
              action: { type: "command", command: "settings.open" },
            },
          ],
          previewers: [{ id: "missing", match: { extension: ".missing" } }],
        },
      },
      { file: "plugin.json" },
    )
    expect(errors(hit.issues).length).toBe(4)
    expect(hit.manifest.contributes.surfaces).toEqual([])
    expect(hit.manifest.contributes.previewers).toEqual([])
  })
})

describe("parseConfigSpec：config.plugin 的 spec", () => {
  test("git spec 装出来的是安装实例，贡献要等模块加载", () => {
    const hit = parseConfigSpec("PowersNexus@git+https://gitee.com/nova-way/powersnexus.git", {
      source: "/x/novaway.jsonc",
      scope: "global",
    })
    expect(hit.source).toBe("config-plugin")
    expect(hit.manifest.name).toBe("powersnexus")
    expect(hit.manifest.kind).toBe("code")
    expect(hit.manifest.contributes).toEqual({})
    expect(hit.manifest.legacy).toEqual({
      adapter: "legacy-config-plugin",
      spec: "PowersNexus@git+https://gitee.com/nova-way/powersnexus.git",
      options: undefined,
      origin: "/x/novaway.jsonc",
      scope: "global",
    })
    expect(errors(hit.issues)).toEqual([])
    expect(codes(hit.issues)).toEqual(["name_normalized", "name_normalized"])
  })

  test("[spec, options] 把选项原样带走", () => {
    const hit = parseConfigSpec(["acme-plugin@1.2.3", { enabled: true }], { scope: "local" })
    expect(hit.manifest.name).toBe("acme-plugin")
    expect(hit.manifest.legacy).toMatchObject({ options: { enabled: true }, scope: "local" })
    expect(codes(hit.issues)).toContain("name_normalized")
  })

  test("npm scope 直接从 spec 折出来", () => {
    expect(parseConfigSpec("@novaway/acme").manifest.name).toBe("novaway_acme")
  })

  test("路径型 spec 猜不出 id：报 error 而不是编一个", () => {
    const hit = parseConfigSpec("file:///tmp/plugin.ts")
    expect(hit.manifest.name).toBe("")
    expect(codes(errors(hit.issues))).toContain("name_missing")
    expect(errors(hit.issues)[0].message).toContain("模块必须导出 id")
    // 调用方（host）从模块里读到 id 之后可以补进来
    expect(parseConfigSpec("file:///tmp/plugin.ts", { name: "local_thing" }).manifest.name).toBe("local_thing")
  })

  test("不是字符串也不是 [字符串, 选项] 的条目报 manifest_shape", () => {
    expect(codes(errors(parseConfigSpec(42).issues))).toContain("manifest_shape")
    const badOptions = parseConfigSpec(["acme", "yes"])
    expect(codes(badOptions.issues)).toContain("unmapped_field")
    expect(badOptions.manifest.legacy).toMatchObject({ options: undefined })
  })
})
