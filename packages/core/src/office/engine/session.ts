/**
 * 文档编辑会话：宿主侧唯一的状态负责人。
 *
 * 对齐 Weave 的一点很关键：**脏标记不属于编辑器，属于宿主**。
 * 编辑器只报告「我改了」，宿主用 revision 判断「这次保存能不能把文件标成已保存」。
 * 保存开始后用户又敲了字，这次保存完成时不能把新修改一起标干净。
 */

import type {
  ApplyOutcome,
  OfficeEngine,
  OfficeFormat,
  OfficeOp,
  OfficeResult,
} from "./contract"
import { fail, ok } from "./contract"

export type SessionSnapshot<TState> = {
  bytes: Uint8Array
  state: TState
  label: string
}

const DEFAULT_MAX_UNDO = 50

/**
 * 一条文档会话。`state` 是该格式的布局模型，`bytes` 是当前完整文件。
 * 撤销用字节快照实现：正确、简单，代价是内存；上限可配。
 * （PPTX 的增量撤销可以后续再优化，但不该在第一版就赌正确性。）
 */
export class DocumentSession<TState> {
  readonly format: OfficeFormat
  readonly #engine: OfficeEngine<TState>
  readonly #maxUndo: number

  #bytes: Uint8Array
  #state: TState
  #path?: string
  #revision = 0
  #savedRevision = 0
  #undo: SessionSnapshot<TState>[] = []
  #redo: SessionSnapshot<TState>[] = []
  /** 已落盘的字节引用；脏标记按「字节还是不是保存时那一份」判断。 */
  #savedBytes: Uint8Array

  constructor(engine: OfficeEngine<TState>, bytes: Uint8Array, state: TState, options: { path?: string; maxUndo?: number } = {}) {
    this.#engine = engine
    this.format = engine.format
    this.#bytes = bytes
    this.#state = state
    this.#path = options.path
    this.#maxUndo = options.maxUndo ?? DEFAULT_MAX_UNDO
    this.#savedBytes = bytes
  }

  static async open<TState>(
    engine: OfficeEngine<TState>,
    bytes: Uint8Array,
    options: { path?: string; maxUndo?: number } = {},
  ): Promise<OfficeResult<DocumentSession<TState>>> {
    const parsed = await engine.open(bytes)
    if (!parsed.ok) return parsed
    return ok(new DocumentSession(engine, bytes, parsed.data, options))
  }

  get path(): string | undefined {
    return this.#path
  }

  get bytes(): Uint8Array {
    return this.#bytes
  }

  get state(): TState {
    return this.#state
  }

  /** 每次内容真正变化 +1；保存用它判断有没有并发修改。 */
  get revision(): number {
    return this.#revision
  }

  /**
   * 脏标记按字节身份判断，而不是「有没有改过」：
   * 撤销回保存时的内容应当重新变成干净。版本号仍然保留，用于「保存期间又改了」。
   */
  get dirty(): boolean {
    return this.#bytes !== this.#savedBytes
  }

  get canUndo(): boolean {
    return this.#undo.length > 0
  }

  get canRedo(): boolean {
    return this.#redo.length > 0
  }

  /** 撤销栈里的标签，给 UI 显示「撤销：移动形状」。 */
  get undoLabel(): string | undefined {
    return this.#undo.at(-1)?.label
  }

  /**
   * 应用一批操作。全有或全无：引擎返回失败时，会话状态完全不动。
   */
  async apply(ops: readonly OfficeOp[], label = "编辑"): Promise<OfficeResult<ApplyOutcome<TState>>> {
    if (ops.length === 0) return fail("invalid_params", "没有要执行的操作")

    const result = await this.#engine.apply(this.#state, ops, this.#bytes)
    if (!result.ok) return result

    const outcome = result.data
    if (outcome.changed.length === 0) {
      return fail("engine", "没有找到要修改的内容", "先读取页面确认节点 id 或索引是否正确")
    }

    this.#undo.push({ bytes: this.#bytes, state: this.#state, label })
    if (this.#undo.length > this.#maxUndo) this.#undo.shift()
    this.#redo = []
    this.#bytes = outcome.bytes
    this.#state = outcome.state
    this.#revision += 1
    return ok(outcome)
  }

  undo(): OfficeResult<{ label: string }> {
    const entry = this.#undo.pop()
    if (!entry) return fail("not_found", "没有可撤销的操作")
    this.#redo.push({ bytes: this.#bytes, state: this.#state, label: entry.label })
    this.#bytes = entry.bytes
    this.#state = entry.state
    this.#revision += 1
    return ok({ label: entry.label })
  }

  redo(): OfficeResult<{ label: string }> {
    const entry = this.#redo.pop()
    if (!entry) return fail("not_found", "没有可重做的操作")
    this.#undo.push({ bytes: this.#bytes, state: this.#state, label: entry.label })
    this.#bytes = entry.bytes
    this.#state = entry.state
    this.#revision += 1
    return ok({ label: entry.label })
  }

  /** 保存开始时先取一个版本号；写盘成功后用它调 `markSaved`。 */
  saveRevision(): number {
    return this.#revision
  }

  /**
   * 保存成功。传入保存**开始**时的版本号：
   * 保存期间又有修改时返回 false，脏标记必须保留。
   */
  markSaved(revision: number): boolean {
    if (revision !== this.#revision) return false
    this.#savedBytes = this.#bytes
    this.#savedRevision = revision
    return true
  }

  /** 另存为：路径身份变了，内容不算脏。 */
  markSavedAs(path: string): void {
    this.#path = path
    this.#savedBytes = this.#bytes
    this.#savedRevision = this.#revision
  }

  /** 恢复副本 / 外部改写后用新字节重建会话（保留路径）。 */
  static async reload<TState>(
    engine: OfficeEngine<TState>,
    bytes: Uint8Array,
    options: { path?: string; maxUndo?: number } = {},
  ): Promise<OfficeResult<DocumentSession<TState>>> {
    return DocumentSession.open(engine, bytes, options)
  }
}

/**
 * 同一路径的编辑串行化。
 *
 * 人和 Agent 可能同时改同一份文件：后到的直接排队，而不是两边各写一份互相覆盖。
 * 键用规范化后的绝对路径（调用方负责规范化）。
 */
export class PathLocks {
  readonly #locks = new Map<string, Promise<unknown>>()

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve()
    const result = previous.then(task)
    // 队列里存的是「永不 reject」的尾链，否则一次失败会把后面的任务全带崩。
    const chain = result.then(
      () => undefined,
      () => undefined,
    )
    this.#locks.set(key, chain)
    try {
      return await result
    } finally {
      if (this.#locks.get(key) === chain) this.#locks.delete(key)
    }
  }
}
