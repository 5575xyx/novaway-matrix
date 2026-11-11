import fs from "node:fs/promises"
import path from "node:path"
import {
  pluginError,
  type HttpClient,
  type KernelApi,
  type PluginCapabilities,
  type SecretStore,
} from "@novaway/plugin-api"

/**
 * 能力检查（§5.4、§11.1）：**未声明即拒绝**，错误信息写清缺哪个 capability。
 *
 * 检查发生在调用点而不是激活时：manifest 里声明了什么，只有真的去读那个文件 / 发那个请求 /
 * 取那个 secret 时才知道够不够。激活时预检一遍既拦不住动态拼出来的路径，也会让「声明了但没用」
 * 的插件白白报错。
 *
 * 这一层不认识 Effect Service，也不认识内核模块：底层实现（fetch / SecretStore / 两个目录根）
 * 由宿主注进来，所以第三方与第一方走的是同一套判定，差别只在 `KernelApi` 多出来的字段。
 */

export type Roots = {
  /** 相对路径的解析基准，也是 `workspace-read` / `workspace-write` 的边界。 */
  workspace: string
  /**
   * `plugin-data` 的落点，宿主按 pluginID 分好（桌面端是 userData，§16 第 5 条）。
   * 只能用绝对路径访问——把数据目录的路径告诉插件是激活输入的事，不在 `ctx.files` 里编一个前缀 scheme。
   */
  data: string
}

/** 缺哪个 capability 就写哪个：作者照着 message 改 manifest 就能修好（§5.5）。 */
function denied(pluginID: string, message: string, contributionID?: string) {
  return pluginError("capability_denied", message, { pluginID, contributionID })
}

function declared(list: readonly string[] | undefined) {
  if (list === undefined) return "未声明"
  return list.length === 0 ? "声明为空" : list.join("、")
}

/**
 * `capabilities.network` 的主机匹配（§11.1 的 `*.githubusercontent.com` 写法）。
 *
 * `*.example.com` 只匹配子域，不匹配 `example.com` 本身——通配符代表「至少再多一级」，
 * 否则声明 `*.internal` 就等于把裸域也放出去了。单独一个 `*` 是全放行，§11.3 要求二次确认。
 */
export function hostAllowed(patterns: readonly string[] | undefined, hostname: string) {
  if (patterns === undefined) return false
  const host = hostname.toLowerCase()
  return patterns.some((raw) => {
    const pattern = raw.toLowerCase()
    if (pattern === "*") return true
    if (!pattern.startsWith("*.")) return host === pattern
    const suffix = pattern.slice(1)
    return host.endsWith(suffix) && host.length > suffix.length
  })
}

export function createHttp(input: {
  pluginID: string
  capabilities?: PluginCapabilities
  fetch?: typeof fetch
}): HttpClient {
  const run = input.fetch ?? globalThis.fetch
  const patterns = input.capabilities?.network
  return {
    async fetch(url, init) {
      const target = new URL(url)
      // 只放 http/https：`file:` / `data:` 会让 network 白名单形同虚设，等于绕过 ctx.files 的 fs 检查。
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw denied(input.pluginID, `ctx.http 只允许 http/https，"${target.protocol}" 会绕过 capabilities.network`)
      }
      if (!hostAllowed(patterns, target.hostname)) {
        throw denied(
          input.pluginID,
          `访问 "${target.hostname}" 需要 capabilities.network 声明该主机（当前：${declared(patterns)}）`,
          target.hostname,
        )
      }
      return run(url, init)
    },
  }
}

/**
 * `capabilities.secrets` 的 key 白名单。
 *
 * §5.4 只写了「只允许读取」，但 write / remove 同样要拦：能写就能覆盖别人的 token，
 * 能删就能让别人的插件静默掉线，两者都不比读更轻。
 */
export function createSecrets(input: {
  pluginID: string
  capabilities?: PluginCapabilities
  store: SecretStore
}): SecretStore {
  const keys = input.capabilities?.secrets
  const check = (key: string) => {
    if (keys?.includes(key)) return
    throw denied(
      input.pluginID,
      `使用 secret "${key}" 需要 capabilities.secrets 声明该 key（当前：${declared(keys)}）`,
      key,
    )
  }
  return {
    async read(key) {
      check(key)
      return input.store.read(key)
    },
    async write(key, value) {
      check(key)
      await input.store.write(key, value)
    },
    async remove(key) {
      check(key)
      await input.store.remove(key)
    },
  }
}

/** `toolRuntime.execute` 的 allowlist（§5.4 最后一行）；第一方也要声明，L0 的强制方式就是声明 + 调用点检查。 */
export function checkTool(input: { pluginID: string; capabilities?: PluginCapabilities; tool: string }) {
  const tools = input.capabilities?.tools
  if (tools?.includes(input.tool)) return
  throw denied(
    input.pluginID,
    `执行工具 "${input.tool}" 需要 capabilities.tools 声明该工具（当前：${declared(tools)}）`,
    input.tool,
  )
}

export function createFiles(input: {
  pluginID: string
  capabilities?: PluginCapabilities
  roots: Roots
}): KernelApi["files"] {
  return {
    async read(target) {
      return fs.readFile(await locate(input, target, "read"), "utf-8")
    },
    async write(target, data) {
      await fs.writeFile(await locate(input, target, "write"), data, "utf-8")
    },
  }
}

/**
 * 三个 fs 能力各自授什么：`plugin-data` 是数据目录的读写，`workspace-read` / `workspace-write`
 * 是工作区的读 / 写，**不互相蕴含**——只声明 write 的插件读不回来，这是 §11.1「未声明即拒绝」的字面意思。
 */
async function locate(
  input: { pluginID: string; capabilities?: PluginCapabilities; roots: Roots },
  target: string,
  mode: "read" | "write",
) {
  const scopes = input.capabilities?.fs
  if (scopes === undefined || scopes.length === 0) {
    throw denied(input.pluginID, `访问文件需要 capabilities.fs（当前：${declared(scopes)}）`, target)
  }
  const resolved = await realTarget(path.resolve(input.roots.workspace, target))
  const data = await realRoot(input.roots.data)
  if (inside(data, resolved)) {
    if (scopes.includes("plugin-data")) return resolved
    throw denied(
      input.pluginID,
      `写入插件数据目录需要 capabilities.fs 声明 "plugin-data"（当前：${declared(scopes)}）`,
      target,
    )
  }
  const workspace = await realRoot(input.roots.workspace)
  if (inside(workspace, resolved)) {
    const needed = mode === "read" ? "workspace-read" : "workspace-write"
    if (scopes.includes(needed)) return resolved
    throw denied(
      input.pluginID,
      `${mode === "read" ? "读" : "写"}工作区需要 capabilities.fs 声明 "${needed}"（当前：${declared(scopes)}）`,
      target,
    )
  }
  throw denied(input.pluginID, `路径 "${target}" 落在已授权目录之外（capabilities.fs：${declared(scopes)}）`, target)
}

/**
 * 词法路径挡不住符号链接：`workspace/link → /etc` 时 `link/passwd` 看着仍在工作区里。
 * 所以根与目标都要落到真实路径再比。
 */
async function realTarget(target: string) {
  const hit = await fs.realpath(target).catch(() => undefined)
  if (hit !== undefined) return hit
  // 目标还不存在（写新文件）：退到父目录的真实路径。只回退到词法路径的话，父目录上的符号链接就绕过去了。
  const parent = path.dirname(target)
  return path.join(await realRoot(parent), path.basename(target))
}

async function realRoot(root: string) {
  return fs.realpath(path.resolve(root)).catch(() => path.resolve(root))
}

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  if (relative === "") return true
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}
