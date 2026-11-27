import { createRequire } from "node:module"
import type { Opts, Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

/** @ts-expect-error -- node-pty's declaration is hidden by its package exports. */
type NodePty = typeof import("@lydell/node-pty")

// node-pty is a native module. Do not load it while the server/sidecar is
// starting: the Electron utility process does not need a terminal unless a
// terminal is actually opened, and an ABI mismatch must not take down all HTTP
// requests. Loading it on first use also keeps normal startup independent from
// the native terminal binary.
let nodePty: NodePty | undefined
const loadNodePty = () => {
  nodePty ??= createRequire(import.meta.url)("@lydell/node-pty") as NodePty
  return nodePty
}

export function spawn(file: string, args: string[], opts: Opts): Proc {
  const proc = loadNodePty().spawn(file, args, opts)
  return {
    pid: proc.pid,
    onData(listener) {
      return proc.onData(listener)
    },
    onExit(listener) {
      return proc.onExit(listener)
    },
    write(data) {
      proc.write(data)
    },
    resize(cols, rows) {
      proc.resize(cols, rows)
    },
    kill(signal) {
      proc.kill(signal)
    },
  }
}
