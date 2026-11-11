/** Download test-only public samples; never execute their macros or add them to the repository. */
import { mkdir, writeFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { createHash } from "node:crypto"

const directory = process.argv[2] && resolve(process.argv[2])
if (!directory) throw new Error("Usage: bun script/download-office-test-samples.ts <new-directory-outside-repository>")
const root = resolve(import.meta.dir, "..").toLowerCase()
if (directory.toLowerCase() === root || directory.toLowerCase().startsWith(root + sep)) throw new Error("Keep real macro samples outside the repository")
const samples = [
  ["docm", "jimyuill/MS-Word-macros-and-vba", "review-comments-stats.docm", "main", "242812633a60d840238939aaad088e9ad65a24617accf275c15fc1efaa55cfcf"],
  ["xlsm", "apache/poi", "test-data/spreadsheet/SimpleMacro.xlsm", "trunk", "f76c986f4ebc25c2cc57c088b2511a1269f4bd61d6223a2ab58db351da348ba6"],
  ["pptm", "apache/poi", "test-data/slideshow/SimpleMacro.pptm", "trunk", "8a3573c82fd07a301d7f175b8bee646c0b58eb8a945bd0ff408225b6e2b89b15"],
  ["doc", "apache/poi", "test-data/document/SampleDoc.doc", "trunk", "717585c0a88f20862c86220163dd03da87cd743970354c6b29add32725f2e833"],
  ["xls", "apache/poi", "test-data/spreadsheet/Simple.xls", "trunk", "2b5ec8298bacffdca61c50f6f7607da0a4e63cf76fa011c62f203e6a66bc072a"],
  ["ppt", "apache/poi", "test-data/slideshow/basic_test_ppt_file.ppt", "trunk", "e8fd4c38ad72ce3735acbca0b60dd5870fb60f819c169e3947d166f4f1bcc79d"],
] as const
await mkdir(directory) // Refuse existing directories and never overwrite user files.
const manifest = []
for (const [extension, repository, file, ref, expected] of samples) {
  const url = `https://api.github.com/repos/${repository}/contents/${file}?ref=${ref}`
  const response = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "NovaWay-Office-verification" } })
  if (!response.ok) throw new Error(`Sample fetch failed (${response.status}): ${url}`)
  const data = await response.json() as { content: string; sha: string }
  const bytes = Buffer.from(data.content, "base64")
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  if (sha256 !== expected) throw new Error(`Upstream sample changed: ${extension}; review it before updating the expected hash`)
  await writeFile(resolve(directory, `sample.${extension}`), bytes, { flag: "wx" })
  manifest.push({ extension, url, sha256, gitBlob: data.sha, bytes: bytes.length })
}
await writeFile(resolve(directory, "sources.json"), JSON.stringify(manifest, null, 2), { flag: "wx" })
console.log(`OFFICE_REAL_SAMPLES=${directory}`)
