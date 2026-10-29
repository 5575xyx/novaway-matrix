import * as path from "path"
import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { ReadState } from "./read-state"
import { AppFileSystem } from "@novaway/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { assertExternalDirectoryEffect } from "./external-directory"
import { createTwoFilesPatch } from "diff"
import { trimDiff } from "./edit"
import * as Bom from "@/util/bom"
import * as Notebook from "./notebook"
import DESCRIPTION from "./notebook_edit.txt"

const permissionRoot = (instance: { directory: string; worktree: string }) =>
  instance.worktree === "/" ? instance.directory : instance.worktree

export const Parameters = Schema.Struct({
  notebook_path: Schema.String.annotate({
    description: "The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)",
  }),
  cell_id: Schema.optional(Schema.String).annotate({
    description:
      "The id of the cell to edit, as shown by the read tool. When inserting, the new cell goes after this cell (or at the beginning when omitted).",
  }),
  new_source: Schema.String.annotate({ description: "The new source for the cell" }),
  cell_type: Schema.optional(Schema.Literals(["code", "markdown"])).annotate({
    description: "The cell type. Defaults to the current type when replacing; required when inserting.",
  }),
  edit_mode: Schema.optional(Schema.Literals(["replace", "insert", "delete"])).annotate({
    description: "replace (default), insert, or delete.",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>

export const NotebookEditTool = Tool.define(
  "notebook_edit",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service
    const readState = yield* ReadState.Service

    const mtimeOf = (info: { mtime: Option.Option<Date> }) => Option.getOrElse(info.mtime, () => new Date(0)).getTime()

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.notebook_path)
            ? params.notebook_path
            : path.join(ctx.directory ?? instance.directory, params.notebook_path)
          yield* assertExternalDirectoryEffect(ctx, filepath)

          if (path.extname(filepath).toLowerCase() !== ".ipynb") {
            throw new Error(
              "File must be a Jupyter notebook (.ipynb file). For editing other file types, use the edit tool.",
            )
          }

          const mode = params.edit_mode ?? "replace"
          if (mode === "insert" && !params.cell_type) {
            throw new Error("cell_type is required when using edit_mode=insert.")
          }

          const info = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info) throw new Error(`Notebook not found: ${filepath}`)
          if (info.type === "Directory") throw new Error(`Path is a directory, not a notebook: ${filepath}`)

          // Mirrors edit/write: an unread or externally-changed notebook must
          // be read again, otherwise the model edits a view it never saw.
          const entry = yield* readState.get(ctx.sessionID, filepath)
          if (!entry) {
            throw new Error(
              `File has not been read yet: ${filepath}. Read the file first with the read tool before editing it.`,
            )
          }
          if (mtimeOf(info) > entry.mtime) {
            throw new Error(
              `File has been modified since it was last read: ${filepath}. Read the file again before editing it.`,
            )
          }

          const source = yield* Bom.readFile(fs, filepath)
          const original = source.text
          let notebook: Notebook.Notebook
          try {
            notebook = Notebook.parse(original)
          } catch (error) {
            throw new Error(
              `Notebook is not valid JSON: ${filepath} (${error instanceof Error ? error.message : String(error)})`,
            )
          }

          const cells = notebook.cells ?? []
          let index: number
          if (!params.cell_id) {
            if (mode !== "insert") {
              throw new Error("cell_id must be specified when using edit_mode=replace or delete.")
            }
            index = 0
          } else {
            index = Notebook.findCell(notebook, params.cell_id)
            if (index === -1) throw new Error(`Cell with id "${params.cell_id}" not found in notebook.`)
            if (mode === "insert") index += 1
          }

          const next: Notebook.Notebook = { ...notebook, cells: [...cells] }
          const supportsCellID =
            (next.nbformat ?? 0) > 4 || ((next.nbformat ?? 0) === 4 && (next.nbformat_minor ?? 0) >= 5)
          const newCellID = supportsCellID ? Math.random().toString(36).slice(2, 17) : undefined

          let cellLabel: string
          let diff: string
          if (mode === "delete") {
            const removed = next.cells![index]!
            cellLabel = Notebook.cellID(removed, index)
            diff = trimDiff(createTwoFilesPatch(filepath, filepath, Notebook.text(removed.source), ""))
            next.cells!.splice(index, 1)
          } else if (mode === "insert") {
            const cell: Notebook.Cell = {
              cell_type: params.cell_type!,
              source: params.new_source,
              metadata: {},
              ...(newCellID ? { id: newCellID } : {}),
              ...(params.cell_type === "code" ? { execution_count: null, outputs: [] } : {}),
            }
            cellLabel = Notebook.cellID(cell, index)
            diff = trimDiff(createTwoFilesPatch(filepath, filepath, "", params.new_source))
            next.cells!.splice(index, 0, cell)
          } else if (index === next.cells!.length) {
            // Replacing one past the end is an insert: the model saw N cells and
            // asked to replace the next one, which does not exist yet.
            const type = params.cell_type ?? "code"
            const cell: Notebook.Cell = {
              cell_type: type,
              source: params.new_source,
              metadata: {},
              ...(newCellID ? { id: newCellID } : {}),
              ...(type === "code" ? { execution_count: null, outputs: [] } : {}),
            }
            cellLabel = Notebook.cellID(cell, index)
            diff = trimDiff(createTwoFilesPatch(filepath, filepath, "", params.new_source))
            next.cells!.push(cell)
          } else {
            const target = { ...next.cells![index]! }
            const previous = Notebook.text(target.source)
            cellLabel = Notebook.cellID(target, index)
            target.source = params.new_source
            if (params.cell_type) target.cell_type = params.cell_type
            // Outputs belong to the old source; keeping them would be lying.
            if (target.cell_type === "code") {
              target.execution_count = null
              target.outputs = []
            }
            diff = trimDiff(createTwoFilesPatch(filepath, filepath, previous, params.new_source))
            next.cells![index] = target
          }

          const updated = Bom.join(
            Notebook.serialize(next, {
              trailingNewline: Notebook.hasTrailingNewline(original),
              lineEnding: Notebook.detectLineEnding(original),
            }),
            source.bom,
          )

          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(permissionRoot(instance), filepath)],
            always: ["*"],
            metadata: { filepath, diff },
          })

          yield* fs.writeWithDirs(filepath, updated)
          const written = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (written) {
            yield* readState.record(ctx.sessionID, filepath, {
              timestamp: Date.now(),
              mtime: mtimeOf(written),
              size: Number(written.size),
              partial: false,
            })
          }
          yield* bus.publish(File.Event.Edited, { file: filepath })
          yield* bus.publish(FileWatcher.Event.Updated, { file: filepath, event: "change" })

          const verb = mode === "insert" ? "Inserted" : mode === "delete" ? "Deleted" : "Updated"
          return {
            title: path.relative(permissionRoot(instance), filepath),
            metadata: { diff, filepath, cellID: cellLabel, editMode: mode },
            output:
              mode === "delete"
                ? `Deleted cell ${cellLabel}.`
                : `${verb} cell ${cellLabel}:

${params.new_source}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
