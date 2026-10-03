import { afterEach, describe, expect, test } from "bun:test"
import { createSignal, For, Show } from "solid-js"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import {
  BlockTool,
  formatCompletedSubagentDetail,
  formatSubagentRetry,
  formatSubagentTitle,
  formatSubagentToolcalls,
  InlineToolRow,
  parseApplyPatchFiles,
  parseDiagnostics,
  parseQuestionAnswers,
  parseQuestions,
  parseTodos,
  alwaysSeparate,
  toolDisplay,
} from "../../../src/routes/session"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"

// 紧凑形态的工具现在是**一张带边框的卡**(原型 card-design-v7.html:427-458),
// 间距登记也从行内工具行搬到了卡壳上(见 routes/session 的 BlockTool)。
// 所以这一组 fixture 挂的是生产组合 BlockTool + InlineToolRow,而不是脱开 Provider 的裸行 ——
// 挂裸行的话,改卡壳的 padding 或间距规则都不会有任何一条快照变红。
// 挂它需要主题与 KV,所以下面统一套一层 Providers。
function Providers(props: { children: JSX.Element }) {
  return (
    <TestTuiContexts>
      <TuiConfigProvider config={createTuiResolvedConfig()}>
        <ArgsProvider>
          <KVProvider>
            <ThemeProvider mode="dark">{props.children}</ThemeProvider>
          </KVProvider>
        </ArgsProvider>
      </TuiConfigProvider>
    </TestTuiContexts>
  )
}

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

type ToolFixture = { label: string; error?: string }

const tools: readonly ToolFixture[] = [
  {
    label:
      'Grep "NovaWay.*DB|database|sqlite|drizzle|dev.*db|data.*dir|xdg|APPDATA" in packages/NovaWay/src (151 matches)',
  },
  {
    label: 'Glob "**/*db*" in packages/NovaWay (6 matches)',
  },
  {
    label: "Read packages/NovaWay/src/storage/db.ts [offset=1, limit=130]",
  },
  {
    label: "Read packages/NovaWay/src/index.ts [offset=1, limit=100]",
    error: "No LSP server available for this file type.",
  },
  {
    label:
      'Grep "export const NovaWay_DB|NovaWay_DB|NovaWay_DEV|Global\\.Path\\.data|data =" in packages/NovaWay/src (115 matches)',
  },
] as const

/** 紧凑工具卡的本地写法,与生产 InlineTool 的组合一致:卡 + InlineToolRow 当 head。 */
function CompactTool(props: { label: string; error?: string; errorExpanded?: boolean }) {
  // 错误详情是 body,默认收起 —— 用户点 head 才展开(生产里由 BlockTool 内部那个 open 管)。
  const body = props.errorExpanded ? props.error : undefined
  return (
    <BlockTool
      collapsible={Boolean(props.error)}
      bodyRows={body ? body.split("\n").length : undefined}
      head={
        <InlineToolRow complete={true} pending="" failed={Boolean(props.error)}>
          {props.label}
        </InlineToolRow>
      }
    >
      {body ? <text>{body}</text> : undefined}
    </BlockTool>
  )
}

function ShellOutput() {
  return (
    <BlockTool title="ls" collapsible bodyRows={2}>
      <text>$ ls</text>
      <text>file.ts</text>
    </BlockTool>
  )
}

function UserMessage() {
  return (
    <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)}>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2}>
        <text>Check whether the next tool remains separated.</text>
      </box>
    </box>
  )
}

function Fixture(props: { errorExpanded?: boolean; before?: "shell" | "user" }) {
  return (
    <box flexDirection="column" width={72}>
      <box flexDirection="column">
        {props.before === "shell" && <ShellOutput />}
        {props.before === "user" && <UserMessage />}
        <For each={tools}>
          {(item) => <CompactTool label={item.label} error={item.error} errorExpanded={props.errorExpanded} />}
        </For>
      </box>
    </box>
  )
}

function TaskRowsFixture() {
  return (
    <box flexDirection="column" width={72}>
      <CompactTool label={'Grep "Task" (2 matches)'} />
      <CompactTool label="Explore Task — Inspect active task spacing" />
      <CompactTool label={"General Task — Confirm completed task spacing\n↳ 1 toolcall · 501ms"} />
      <CompactTool label="Read src/cli/cmd/tui/routes/session/index.tsx" />
    </box>
  )
}

function LoadedReadBeforeTaskFixture() {
  return (
    <box flexDirection="column" width={72}>
      <CompactTool label="Read src/cli/cmd/tui/routes/session/index.tsx" />
      <box paddingLeft={3}>
        <text paddingLeft={3}>↳ Loaded src/cli/cmd/tui/routes/session/tools.tsx</text>
      </box>
      <CompactTool label={"Explore Task — Inspect active task spacing\n↳ 1 toolcall · 501ms"} />
    </box>
  )
}

function AssistantSummaryBeforeInlineFixture() {
  return (
    <box flexDirection="column" width={72}>
      <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={3}>
        <text>▣ Build · Little Frank · 53.1s</text>
      </box>
      <CompactTool label={"Build Task — Review changes\n↳ 48 toolcalls · 1m 40s"} />
    </box>
  )
}

function AssistantErrorBeforeInlineFixture() {
  return (
    <box flexDirection="column" width={72}>
      <box
        ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
        border={["left"]}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
      >
        <text>Managed inference requires an active Member plan</text>
      </box>
      <CompactTool label={"Build Task — Review changes\n↳ 48 toolcalls · 1m 40s"} />
    </box>
  )
}

function StickyScrollFixture(props: { separated: boolean; scroll: (scroll: ScrollBoxRenderable) => void }) {
  return (
    // 视口 6 行:2 行固定 + 3 行工具卡装得下 —— 不留余量的话卡会被 flexShrink 压扁
    // (Renderable 的 flexShrink 默认是 1),量出来的就不是内容高度了。
    <scrollbox ref={props.scroll} stickyScroll={true} stickyStart="bottom" height={6} width={72}>
      <box height={1}>
        <text>First row</text>
      </box>
      <box height={1}>
        <text>Second row</text>
      </box>
      <Show when={props.separated}>
        <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)}>
          <text>Assistant text</text>
        </box>
      </Show>
      <CompactTool label="Read src/cli/cmd/tui/routes/session/index.tsx" />
    </scrollbox>
  )
}

function FailedPendingToolFixture() {
  return (
    <BlockTool
      collapsible={true}
      head={
        <InlineToolRow complete={false} pending="Preparing patch..." failed={true} failure="Patch failed">
          Patch
        </InlineToolRow>
      }
    >
      <text>Patch failed</text>
    </BlockTool>
  )
}

function FailedCompleteToolFixture() {
  // 失败但已经完成:head 上留的是有用的那一句(文件路径),failure 文案**不进 head**。
  // 错误详情是 body,由用户点 head 展开 —— 所以这里刻意不给 body,断言才成立。
  return (
    <BlockTool
      collapsible={true}
      head={
        <InlineToolRow complete={true} pending="Reading file..." failed={true} failure="Read failed">
          Read src/index.ts
        </InlineToolRow>
      }
    />
  )
}

// 主题与字体都是异步就绪的,单次 renderOnce 拿到的必然是半截帧 —— 卡壳都还没画出来。
// 等到帧里出现 ╭(工具卡的上边框)再继续。
async function settle(app: { renderOnce: () => Promise<void>; captureCharFrame: () => string }) {
  for (let attempt = 0; attempt < 40; attempt++) {
    await app.renderOnce()
    if (app.captureCharFrame().includes("╭")) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function renderFrame(component: () => JSX.Element, options: { width: number; height: number }) {
  testSetup = await testRender(() => <Providers>{component()}</Providers>, options)
  await settle(testSetup)
  await testSetup.renderOnce()

  return testSetup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
}

describe("TUI inline tool wrapping", () => {
  test("falls back for unknown tool names", () => {
    expect(toolDisplay("bash")).toBe("bash")
    expect(toolDisplay("plugin_tool")).toBe("generic")
  })

  test("replaces pending copy when a tool fails before completion", async () => {
    const frame = await renderFrame(() => <FailedPendingToolFixture />, { width: 72, height: 8 })
    expect(frame).toContain("Patch failed")
    expect(frame).not.toContain("Preparing patch")
  })

  test("preserves useful completed copy when a tool fails", async () => {
    const frame = await renderFrame(() => <FailedCompleteToolFixture />, { width: 72, height: 8 })
    expect(frame).toContain("Read src/index.ts")
    expect(frame).not.toContain("Read failed")
  })

  test("filters malformed nested tool wire data", () => {
    expect(
      parseApplyPatchFiles([
        null,
        { type: "add" },
        { type: "add", relativePath: "a.ts", filePath: "a.ts", patch: "diff", deletions: 0 },
      ]),
    ).toEqual([
      { type: "add", relativePath: "a.ts", filePath: "a.ts", patch: "diff", deletions: 0, movePath: undefined },
    ])
    expect(parseTodos([null, { status: "pending" }, { status: "pending", content: "Safe" }])).toEqual([
      { status: "pending", content: "Safe" },
    ])
    expect(parseQuestions([{}, { question: 1 }, { question: "Continue?" }])).toEqual([{ question: "Continue?" }])
    expect(parseQuestionAnswers([null, ["yes", 1], "no"])).toEqual([[], ["yes"], []])
    expect(parseQuestionAnswers({})).toBeUndefined()
  })

  test("ignores diagnostics with malformed nested ranges", () => {
    expect(
      parseDiagnostics(
        {
          "a.ts": [
            { severity: 1, message: "missing range" },
            { severity: 1, message: "bad line", range: { start: { line: "0", character: 1 } } },
            { severity: 1, message: "valid", range: { start: { line: 2, character: 3 } } },
          ],
        },
        "a.ts",
      ),
    ).toEqual([{ message: "valid", range: { start: { line: 2, character: 3 } } }])
  })

  test("formats completed subagent toolcall details", () => {
    expect(formatCompletedSubagentDetail(0, "501ms")).toBe("501ms")
    expect(formatCompletedSubagentDetail(1, "501ms")).toBe("1 toolcall · 501ms")
    expect(formatCompletedSubagentDetail(2, "501ms")).toBe("2 toolcalls · 501ms")
    expect(formatSubagentToolcalls(0)).toBe("0 toolcalls")
  })

  test("keeps background state attached to the subagent identity", () => {
    expect(formatSubagentTitle("Explore", "Inspect renderer", false)).toBe("Explore Task — Inspect renderer")
    expect(formatSubagentTitle("Explore", "Inspect renderer", true)).toBe(
      "Explore Task (background) — Inspect renderer",
    )
  })

  test("keeps retry status ahead of wrapping messages", () => {
    expect(formatSubagentRetry(2, "Rate limited by provider")).toBe("Retrying (attempt 2) · Rate limited by provider")
  })

  test("snapshots consecutive grep, glob, and read rows at a narrow width", async () => {
    expect(await renderFrame(() => <Fixture />, { width: 72, height: 40 })).toMatchSnapshot()
  })

  test("snapshots expanded tool errors under the tool text", async () => {
    expect(await renderFrame(() => <Fixture errorExpanded />, { width: 72, height: 48 })).toMatchSnapshot()
  })

  test("keeps separation after a shell output block", async () => {
    expect(await renderFrame(() => <Fixture before="shell" />, { width: 72, height: 48 })).toMatchSnapshot()
  })

  test("keeps separation after a padded user message", async () => {
    expect(await renderFrame(() => <Fixture before="user" />, { width: 72, height: 44 })).toMatchSnapshot()
  })

  test("separates after a multi-line task row", async () => {
    expect(await renderFrame(() => <TaskRowsFixture />, { width: 72, height: 24 })).toMatchSnapshot()
  })

  test("separates a task row from a preceding inline detail", async () => {
    expect(await renderFrame(() => <LoadedReadBeforeTaskFixture />, { width: 72, height: 16 })).toMatchSnapshot()
  })

  test("separates an inline row from the previous assistant summary", async () => {
    expect(
      await renderFrame(() => <AssistantSummaryBeforeInlineFixture />, { width: 72, height: 10 }),
    ).toMatchSnapshot()
  })

  test("separates an inline row from the previous assistant error", async () => {
    expect(await renderFrame(() => <AssistantErrorBeforeInlineFixture />, { width: 72, height: 12 })).toMatchSnapshot()
  })

  test("updates sticky-bottom geometry when a text separator mounts and unmounts", async () => {
    const [separated, setSeparated] = createSignal(false)
    let scroll: ScrollBoxRenderable | undefined
    testSetup = await testRender(
      () => (
        <Providers>
          <StickyScrollFixture separated={separated()} scroll={(value) => (scroll = value)} />
        </Providers>
      ),
      {
        width: 72,
        height: 6,
      },
    )

    await settle(testSetup)
    // 视口 6 行,而内容只有 2 + 3 = 5 行:scrollbox 的 content 有 `minHeight: 100%`,
    // 所以装得下时 scrollHeight 就是视口高度 6。挂上那个 1 行的分隔框之后多出 marginTop,
    // 内容变成 7 > 视口,贴底才真的发生。
    expect(scroll?.scrollHeight).toBe(6)
    expect(scroll?.scrollTop).toBe(Math.max(0, scroll!.scrollHeight - scroll!.viewport.height))

    setSeparated(true)
    await settle(testSetup)
    expect(scroll?.scrollHeight).toBe(7)
    expect(scroll?.scrollTop).toBe(Math.max(0, scroll!.scrollHeight - scroll!.viewport.height))

    setSeparated(false)
    await settle(testSetup)
    expect(scroll?.scrollHeight).toBe(6)
    expect(scroll?.scrollTop).toBe(Math.max(0, scroll!.scrollHeight - scroll!.viewport.height))
  })
})
