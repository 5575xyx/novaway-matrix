import { expect } from "bun:test"
import { Effect } from "effect"
import { PowersNexusBrowserQa } from "../../src/powersnexus/browser-qa"
import { PowersNexusBrowser } from "../../src/powersnexus/browser"
import { AppProcess } from "@opencode-ai/core/process"
import { NodeFileSystem } from "@effect/platform-node"
import path from "node:path"
import { Layer } from "effect"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(PowersNexusBrowserQa.defaultLayer)

it.instance("Browser 未配置时 Browser QA 明确失败而不是静默跳过", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    delete process.env.POWERSNEXUS_BROWSER_CDP_URL
    delete process.env.POWERSNEXUS_BROWSER_ALLOW_LAUNCH
    const qa = yield* PowersNexusBrowserQa.Service
    const result = yield* Effect.exit(
      qa.run({
        worktree: tmp.directory,
        scenarios: [{ id: "home", url: "https://example.com", requiredText: ["Example"] }],
        viewports: [{ name: "desktop", width: 1440, height: 900 }],
      }),
    )
    expect(result._tag).toBe("Failure")
  }),
  { git: true },
)

const itMocked = testEffect(
  PowersNexusBrowserQa.layer.pipe(
    Layer.provide(
      Layer.mock(PowersNexusBrowser.Service, {
        setViewport: (width, height) => Effect.sync(() => viewports.push(`${width}x${height}`)),
        navigate: (url) => Effect.succeed({ url, title: "测试页面" }),
        snapshot: () =>
          Effect.succeed({
            url: "http://127.0.0.1:4173",
            title: "测试页面",
            text: "测试页面内容已加载\n[e1] button \"保存\"",
            bodyText: "测试页面内容已加载",
            refs: [{ ref: "e1", role: "button", name: "保存", tag: "button" }],
            overflow: false,
            focusVisible: true,
          }),
        click: () => Effect.void,
        fill: () => Effect.void,
        press: () => Effect.void,
        screenshot: () => Effect.succeed({ path: path.join(tmpRoot, "shot.png") }),
        console: () => Effect.succeed([]),
        network: () => Effect.succeed([]),
        accessibility: () => Effect.succeed('- button "保存"'),
        close: () => Effect.void,
      }),
    ),
    Layer.provide(AppProcess.defaultLayer),
    Layer.provide(NodeFileSystem.layer),
  ),
)

let viewports: string[] = []
let tmpRoot = ""

itMocked.instance("Browser QA 实际设置 viewport 并把快照报告纳入证据", () =>
  Effect.gen(function* () {
    const tmp = yield* TestInstance
    viewports = []
    tmpRoot = tmp.directory
    const qa = yield* PowersNexusBrowserQa.Service
    const results = yield* qa.run({
      worktree: tmp.directory,
      scenarios: [{ id: "home", url: "http://127.0.0.1:4173", requiredText: ["测试页面"] }],
      viewports: [
        { name: "desktop", width: 1440, height: 900 },
        { name: "mobile", width: 390, height: 844 },
      ],
    })
    expect(viewports).toEqual(["1440x900", "390x844"])
    expect(results).toHaveLength(2)
    expect(results.every((result) => result.passed)).toBe(true)
    expect(results[0]?.evidenceFiles.some((file) => file.endsWith(".snapshot.json"))).toBe(true)
    expect(results[0]?.evidenceFiles.some((file) => file.endsWith(".json"))).toBe(true)
  }),
)
