/** Run with Bun; optionally pass packages/app/dist to verify a production build. */
import { readdir, readFile, stat } from "node:fs/promises"
import { resolve, dirname, join } from "node:path"
import { createHash } from "node:crypto"

const source = resolve(import.meta.dir, "../packages/app/public/office")
const target = process.argv[2] ? resolve(process.argv[2], "office") : source
const required = [
  "docx-editor.js",
  "docx-editor.css",
  "docx-worker.js",
  "sheets-editor.js",
  "sheets-editor.css",
  "blank.xlsx",
  "slides-editor.js",
  "slides-editor.css",
  "slides-worker.js",
  "pdf-editor.js",
  "pdf-editor.css",
  "pdf-worker.js",
  "pdf-runtime/pdfium.wasm",
  "pdf-runtime/hb-subset.wasm",
  "pdf-runtime/NotoSansCJKsc-Regular-subset.otf",
  "pdf-runtime/LiberationSans-Regular.ttf",
  "pdf-runtime/LICENSE-OFL.txt",
  "pdf-runtime/LICENSE.pdfium",
  "LICENSE",
  "NOTICE",
  "THIRD-PARTY-NOTICES.txt",
]
for (const file of required) {
  if (!(await stat(join(target, file))).size) throw new Error(`Empty Office asset: ${file}`)
}
const license = await readFile(join(target, "LICENSE"), "utf8")
const notice = await readFile(join(target, "NOTICE"), "utf8")
const thirdParty = await readFile(join(target, "THIRD-PARTY-NOTICES.txt"), "utf8")
if (!license.includes("Apache License") || !notice.includes("8ab58a51433577a1317af4206137cee425b86606"))
  throw new Error("Missing Office license/provenance")
for (const name of ["Univer", "Tiptap", "Konva", "MPL", "Unicode"]) {
  if (!new RegExp(name, "i").test(thirdParty)) throw new Error(`Missing third-party notice: ${name}`)
}
let files = 0
let bytes = 0
async function inspect(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) {
      await inspect(file)
      continue
    }
    const data = await readFile(file)
    files++
    bytes += data.length
    if (target !== source) {
      const original = await readFile(join(source, file.slice(target.length + 1)))
      if (!data.equals(original)) throw new Error(`Production Office asset differs: ${file}`)
    }
    if (/\.css$/.test(entry.name)) {
      for (const match of data.toString().matchAll(/url\(["']?([^\s)"']+)["']?\)/g)) {
        const reference = match[1]!
        if (/^(data:|https?:|\/|#)/.test(reference)) continue
        await stat(resolve(dirname(file), reference.split(/[?#]/)[0]!))
      }
    }
    if (/\.wasm$/.test(entry.name) && data.subarray(0, 4).toString("hex") !== "0061736d")
      throw new Error(`Invalid WASM: ${file}`)
  }
}
await inspect(target)
for (const directory of ["pdfjs/cmaps", "pdfjs/standard_fonts", "pdfjs/wasm"]) {
  if (!(await readdir(join(target, directory))).length) throw new Error(`Missing PDF resources: ${directory}`)
}
const hashes = await Promise.all(
  required
    .filter((name) => name.endsWith("-editor.js"))
    .map(async (file) => ({
      file,
      sha256: createHash("sha256")
        .update(await readFile(join(target, file)))
        .digest("hex"),
    })),
)
console.log(JSON.stringify({ directory: target, files, bytes, hashes }, null, 2))
