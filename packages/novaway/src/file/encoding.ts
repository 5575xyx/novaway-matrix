/**
 * 读写的编码层：让右侧面板的文本 / 代码编辑器也遵守同一条规则 ——
 * 文件原来是什么编码、有没有 BOM、用哪种换行符，写回时保持不变。
 *
 * 浏览器里的 textarea 只会给我们 `\n`，也不认识 GBK；所以编解码放在服务端，
 * 和 `crates/text-editor` 一样以磁盘上的字节为格式依据。
 */
import { decodeText, encodeText } from "@novaway/core/office/text/format"

/** 按真实编码解码（UTF-8 / UTF-16 / GBK + BOM），换行统一成 \n。 */
export function decodeFileText(bytes: Uint8Array): string {
  return decodeText(bytes).text
}

/**
 * 按磁盘上原有的格式写回。
 *
 * `original` 是写之前读到的字节；文件不存在（新建）时用 UTF-8 + LF。
 * 传入的文本先把换行统一成 \n，避免 textarea 里的 CRLF 被二次展开成 \r\r\n。
 */
export function encodeFileText(contents: string, original?: Uint8Array): Uint8Array {
  const normalized = contents.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  if (!original) return new TextEncoder().encode(normalized)
  return encodeText(normalized, decodeText(original).format)
}
