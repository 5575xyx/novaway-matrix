/**
 * 贡献点全集（插件文档 §3 + §4.1，super-agent 文档 §12.1）。
 *
 * 新增第 25 个贡献点时改这里与一个注册表，不改内核的 if 链。
 */
export type ContributionKind =
  | "tool"
  | "agent"
  | "skill"
  | "command"
  | "provider"
  | "office-engine"
  | "previewer"
  | "publish-driver"
  | "surface"
  | "interceptor"
  | "mcp"
  | "output-style"
  | "scheduler"
  | "event-source"
  | "http-route"
  | "lsp"
  | "trigger"
  | "fast-path"
  | "routing-policy"
  | "worker-type"
  | "watchdog-policy"
  | "channel"

/** 贡献来源作用域；覆盖优先级 session > project > global > builtin（§4.9、§10.5）。 */
export type PluginScope = "builtin" | "global" | "project" | "session"

export interface Disposable {
  dispose(): void
}

/** 所有注册表共享的语义：命名、冲突、覆盖、释放、变更通知（§4.1）。 */
export interface Registry<T> {
  register(item: T): Disposable
  resolve(id: string): T | undefined
  list(): ReadonlyArray<T>
  onDidChange(fn: () => void): Disposable
}

/** 未对第三方开放的注册表：读取可用，`register` 抛 `capability_denied`（§5.3）。 */
export interface RestrictedRegistry<T> extends Omit<Registry<T>, "register"> {
  register(item: T): never
}
