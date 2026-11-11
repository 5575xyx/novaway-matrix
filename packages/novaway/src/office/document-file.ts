/**
 * 按路径的文档编辑：UI（HTTP）和 Agent（工具）共用的一条写回路径。
 *
 * 和 PPTX 专用链路一样，写盘用「临时文件 + rename」，调用方负责广播事件。
 * 这里只做「字节进、字节出」，不碰文件系统，方便单测。
 */
import type { OfficeEngine, OfficeFormat, OfficeOp, OfficeResult } from "@novaway/core/office/engine/contract"
import { fail, ok } from "@novaway/core/office/engine/contract"
import { engineFor } from "@novaway/core/office/engine/registry"
import { DocumentSession } from "@novaway/core/office/engine/session"
import { runtimeEngineFor, runtimeOfficeFormatOf, type RuntimeOfficeRegistry } from "./runtime"

export type DocumentEditResult = {
  bytes: Uint8Array
  /** 被重写的包内条目；文本类文档是 ["html"] / ["text"]。 */
  changed: string[]
  applied: unknown[]
}

export function formatOfPath(filepath: string, registry?: RuntimeOfficeRegistry): OfficeFormat | undefined {
  return runtimeOfficeFormatOf(filepath, registry)
}

/**
 * 全有或全无：任一 op 失败都不会返回新字节。
 * `format` 由调用方按路径推断（officeFormatOf）后传入。
 *
 * 纯字节入口：不需要文件系统，也不维护撤销历史。
 * 真正写文件请用 `@/office/document-sessions` 的 `editDocumentFile`
 * （它在这个函数之上加了按路径的会话缓存 —— 人和 AI 共用一条撤销栈）。
 */
export async function applyDocumentOpsAs(
  bytes: Uint8Array,
  format: OfficeFormat | undefined,
  ops: readonly OfficeOp[],
  options: { password?: string; registry?: RuntimeOfficeRegistry } = {},
): Promise<OfficeResult<DocumentEditResult>> {
  if (ops.length === 0) return fail("invalid_params", "没有要执行的操作")
  if (!format) return fail("unsupported_format", "暂不支持编辑这种文件")

  const engine = runtimeEngineFor(format, options.registry) ?? engineFor(format)
  if (!engine) return fail("unsupported_format", "暂不支持 " + format + " 文件")

  const opened = await DocumentSession.open(engine as OfficeEngine<unknown>, bytes, options)
  if (!opened.ok) return opened

  const applied = await opened.data.apply(ops, "文档编辑")
  if (!applied.ok) return applied

  return ok({
    bytes: applied.data.bytes,
    changed: applied.data.changed,
    applied: applied.data.applied,
  })
}
