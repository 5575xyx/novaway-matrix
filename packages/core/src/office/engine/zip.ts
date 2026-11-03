/**
 * ZIP 读写：PPTX 和 DOCX 共用同一份实现。
 *
 * 核心不变量：**未改动的条目连本地头一起原样拷贝**，压缩流一个字节都不碰。
 * 这样「改一个段落」不会波及样式表、主题、图片、嵌入字体和任何我们没解析的扩展。
 */
export { entryData, readZip, rebuildZip } from "../pptx-edit"
export type { ZipArchive, ZipEntry } from "../pptx-edit"

import type { ZipArchive, ZipEntry } from "../pptx-edit"
import { entryData } from "../pptx-edit"

/** 取一个条目的解压后字节。 */
export function inflateEntry(zip: ZipArchive, entry: ZipEntry): Promise<Uint8Array> {
  return entryData(zip.bytes, entry)
}
