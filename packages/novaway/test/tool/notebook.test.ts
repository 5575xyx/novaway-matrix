import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "path"
import fs from "node:fs/promises"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@novaway/core/cross-spawn-spawner"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Git } from "@/git"
import { LSP } from "@/lsp/lsp"
import { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"
import { Instruction } from "../../src/session/instruction"
import { ReadTool } from "../../src/tool/read"
import { NotebookEditTool } from "../../src/tool/notebook_edit"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { Reference } from "@/reference/reference"
import { ReadState } from "../../src/tool/read-state"
import { Bus } from "../../src/bus"
import { disposeAllInstances, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const referenceLayer = Reference.layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Git.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Instruction.defaultLayer,
    LSP.defaultLayer,
    referenceLayer,
    Truncate.defaultLayer,
    ReadState.defaultLayer,
    Bus.layer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const read = Effect.fn("NotebookTest.read")(function* (filePath: string) {
  const info = yield* ReadTool
  const tool = yield* info.init()
  return yield* tool.execute({ filePath }, ctx)
})

const edit = Effect.fn("NotebookTest.edit")(function* (args: Tool.InferParameters<typeof NotebookEditTool>) {
  const info = yield* NotebookEditTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

const fail = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause)
      return err instanceof Error ? err : new Error(String(err))
    }
    throw new Error("expected the call to fail")
  })

const LF = String.fromCharCode(10)

type Cell = Record<string, unknown>

const notebook = (cells: Cell[]) => ({
  cells,
  metadata: { language_info: { name: "python" }, kernelspec: { name: "python3" } },
  nbformat: 4,
  nbformat_minor: 5,
})

const seed = (filePath: string, cells: Cell[]) =>
  Effect.promise(() => fs.writeFile(filePath, JSON.stringify(notebook(cells), null, 1) + LF, "utf-8"))

const readJSON = (filePath: string) => Effect.promise(() => fs.readFile(filePath, "utf-8").then((t) => JSON.parse(t)))

const code = (id: string, source: string, extra: Record<string, unknown> = {}) => ({
  cell_type: "code",
  id,
  source,
  metadata: {},
  execution_count: null,
  outputs: [],
  ...extra,
})

const markdown = (id: string, source: string) => ({ cell_type: "markdown", id, source, metadata: {} })

describe("tool.read notebook", () => {
  it.instance("renders cells with ids, types and outputs", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "analysis.ipynb")
      yield* seed(filePath, [
        markdown("intro", "# Title"),
        code("run", "print(1 + 1)", {
          execution_count: 7,
          outputs: [{ output_type: "stream", name: "stdout", text: ["2" + LF] }],
        }),
      ])

      const result = yield* provideInstance(dir)(read(filePath))
      expect(result.output).toContain("<type>notebook</type>")
      expect(result.output).toContain("<language>python</language>")
      expect(result.output).toContain('<cell id="intro" type="markdown">')
      expect(result.output).toContain("# Title")
      expect(result.output).toContain('<cell id="run" type="code" language="python" execution_count="7">')
      expect(result.output).toContain("print(1 + 1)")
      expect(result.output).toContain('<output cell="run">')
      expect(result.output).toContain("2")
      expect(result.output).toContain("(2 cells)")
      expect(result.output).not.toContain("nbformat")
    }),
  )

  it.instance("attaches images from cell outputs and marks them inline", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "plot.ipynb")
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      yield* seed(filePath, [
        code("plot", "fig.savefig('a.png')", {
          execution_count: 1,
          outputs: [{ output_type: "display_data", data: { "image/png": png } }],
        }),
      ])

      const result = yield* provideInstance(dir)(read(filePath))
      expect(result.output).toContain('<image cell="plot" mime="image/png" />')
      expect(result.attachments?.length).toBe(1)
      expect(result.attachments?.[0].mime).toBe("image/png")
      expect(result.attachments?.[0].url).toStartWith("data:image/png;base64,")
    }),
  )

  it.instance("summarizes oversized cell outputs instead of dumping them", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "big.ipynb")
      yield* seed(filePath, [
        code("dump", "df", {
          execution_count: 2,
          outputs: [{ output_type: "execute_result", data: { "text/plain": "x".repeat(20_000) } }],
        }),
      ])

      const result = yield* provideInstance(dir)(read(filePath))
      expect(result.output).toContain("Outputs are too large to include")
      expect(result.output).toContain("cells[0].outputs")
      expect(result.output).not.toContain("x".repeat(1_000))
    }),
  )

  it.instance("renders tracebacks from error outputs", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "boom.ipynb")
      yield* seed(filePath, [
        code("boom", "1 / 0", {
          execution_count: 3,
          outputs: [
            {
              output_type: "error",
              ename: "ZeroDivisionError",
              evalue: "division by zero",
              traceback: ["line 1", "line 2"],
            },
          ],
        }),
      ])

      const result = yield* provideInstance(dir)(read(filePath))
      expect(result.output).toContain("ZeroDivisionError: division by zero")
      expect(result.output).toContain("line 2")
    }),
  )

  it.instance("falls back to cell-N ids when the notebook has none", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "old.ipynb")
      yield* Effect.promise(() =>
        fs.writeFile(
          filePath,
          JSON.stringify(
            {
              cells: [{ cell_type: "code", source: "a = 1", metadata: {}, execution_count: null, outputs: [] }],
              metadata: { language_info: { name: "python" } },
              nbformat: 4,
              nbformat_minor: 2,
            },
            null,
            1,
          ) + LF,
          "utf-8",
        ),
      )

      const result = yield* provideInstance(dir)(read(filePath))
      expect(result.output).toContain('<cell id="cell-0" type="code"')
    }),
  )
})

describe("tool.notebook_edit", () => {
  it.instance("replaces a cell source and clears stale outputs", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "edit.ipynb")
      yield* seed(filePath, [
        code("keep", "a = 1", { execution_count: 1, outputs: [{ output_type: "stream", text: "1" + LF }] }),
        code("target", "print('old')", {
          execution_count: 4,
          outputs: [{ output_type: "stream", text: "old" + LF }],
        }),
      ])

      yield* provideInstance(dir)(read(filePath))
      const result = yield* provideInstance(dir)(
        edit({ notebook_path: filePath, cell_id: "target", new_source: "print('new')" }),
      )
      expect(result.output).toContain("Updated cell target")

      const data = yield* readJSON(filePath)
      expect(data.cells[1].source).toBe("print('new')")
      expect(data.cells[1].outputs).toEqual([])
      expect(data.cells[1].execution_count).toBe(null)
      // The untouched cell keeps its outputs.
      expect(data.cells[0].execution_count).toBe(1)

      // The edit recorded a fresh read state, so the next read shows the code
      // rather than the "file unchanged" stub.
      const again = yield* provideInstance(dir)(read(filePath))
      expect(again.output).toContain("print('new')")
    }),
  )

  it.instance("inserts markdown and code cells after the given cell", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "insert.ipynb")
      yield* seed(filePath, [code("first", "a = 1")])

      yield* provideInstance(dir)(read(filePath))
      yield* provideInstance(dir)(
        edit({
          notebook_path: filePath,
          cell_id: "first",
          new_source: "## Notes",
          cell_type: "markdown",
          edit_mode: "insert",
        }),
      )
      yield* provideInstance(dir)(
        edit({
          notebook_path: filePath,
          cell_id: "first",
          new_source: "b = 2",
          cell_type: "code",
          edit_mode: "insert",
        }),
      )

      const data = yield* readJSON(filePath)
      expect(data.cells.map((cell: Cell) => cell.cell_type)).toEqual(["code", "code", "markdown"])
      expect(data.cells[1].source).toBe("b = 2")
      expect(data.cells[1].execution_count).toBe(null)
      expect(data.cells[2].source).toBe("## Notes")
      expect(typeof data.cells[1].id).toBe("string")
    }),
  )

  it.instance("deletes a cell and keeps the rest in order", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "delete.ipynb")
      yield* seed(filePath, [code("a", "a = 1"), code("b", "b = 2"), code("c", "c = 3")])

      yield* provideInstance(dir)(read(filePath))
      const result = yield* provideInstance(dir)(
        edit({ notebook_path: filePath, cell_id: "b", new_source: "", edit_mode: "delete" }),
      )
      expect(result.output).toContain("Deleted cell b")

      const data = yield* readJSON(filePath)
      expect(data.cells.map((cell: Cell) => cell.id)).toEqual(["a", "c"])
    }),
  )

  it.instance("rejects editing a notebook that was never read", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "unread.ipynb")
      yield* seed(filePath, [code("a", "a = 1")])

      const err = yield* provideInstance(dir)(
        fail(edit({ notebook_path: filePath, cell_id: "a", new_source: "a = 2" })),
      )
      expect(err.message).toContain("File has not been read yet")
    }),
  )

  it.instance("rejects editing a notebook that changed after the read", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "stale.ipynb")
      yield* seed(filePath, [code("a", "a = 1")])

      yield* provideInstance(dir)(read(filePath))
      yield* Effect.promise(async () => {
        await fs.writeFile(filePath, JSON.stringify(notebook([code("a", "a = 99")]), null, 1) + LF)
        const future = new Date(Date.now() + 5_000)
        await fs.utimes(filePath, future, future)
      })

      const err = yield* provideInstance(dir)(
        fail(edit({ notebook_path: filePath, cell_id: "a", new_source: "a = 2" })),
      )
      expect(err.message).toContain("File has been modified since it was last read")
    }),
  )

  it.instance("rejects unknown cells and non-notebook paths", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "misc.ipynb")
      const textPath = path.join(dir, "notes.md")
      yield* seed(filePath, [code("a", "a = 1")])
      yield* Effect.promise(() => fs.writeFile(textPath, "# hi", "utf-8"))

      yield* provideInstance(dir)(read(filePath))
      const missing = yield* provideInstance(dir)(
        fail(edit({ notebook_path: filePath, cell_id: "nope", new_source: "x" })),
      )
      expect(missing.message).toContain('Cell with id "nope" not found')

      yield* provideInstance(dir)(read(textPath))
      const wrongType = yield* provideInstance(dir)(
        fail(edit({ notebook_path: textPath, cell_id: "a", new_source: "x" })),
      )
      expect(wrongType.message).toContain("must be a Jupyter notebook")
    }),
  )

  it.instance("requires cell_type when inserting and cell_id when replacing", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filePath = path.join(dir, "validation.ipynb")
      yield* seed(filePath, [code("a", "a = 1")])
      yield* provideInstance(dir)(read(filePath))

      const noType = yield* provideInstance(dir)(
        fail(edit({ notebook_path: filePath, cell_id: "a", new_source: "x", edit_mode: "insert" })),
      )
      expect(noType.message).toContain("cell_type is required")

      const noID = yield* provideInstance(dir)(
        fail(edit({ notebook_path: filePath, new_source: "x", edit_mode: "replace" })),
      )
      expect(noID.message).toContain("cell_id must be specified")
    }),
  )
})
