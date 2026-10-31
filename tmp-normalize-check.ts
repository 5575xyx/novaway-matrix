import fs from "node:fs"
import { normalize } from "./packages/ui/src/components/session-diff"
const diff = JSON.parse(fs.readFileSync("/tmp/pelican.json", "utf8"))
const view = normalize(diff)
const fd = view.fileDiff
console.log(
  "name",
  fd.name,
  "hunks",
  fd.hunks.length,
  "deletionLines",
  fd.deletionLines.length,
  "additionLines",
  fd.additionLines.length,
)
console.log("first hunk", JSON.stringify(fd.hunks[0]).slice(0, 300))
