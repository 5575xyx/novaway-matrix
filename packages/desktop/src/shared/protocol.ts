export const RENDERER_PROTOCOL = "oc"
export const RENDERER_HOST = "renderer"

// 渲染进程本身跑在自定义协议上，iframe 无法直接嵌 file://：
// file 是非标准协议、origin 不透明，跨源嵌入在导航层就被拒绝，拦不住。
// 本地文件预览因此用这个标准协议代理本机文件。
export const LOCAL_FILE_PROTOCOL = "oc-file"
export const LOCAL_FILE_HOST = "local"

// 放在无 electron 依赖的模块里：沙箱 preload 拿不到 app，不能 import main/constants。
export function toLocalFileUrl(url: string): string {
  if (!url.startsWith("file:")) return url
  // file:///D:/x 与 file://D:/x 的前导斜杠数量不一致，必须全剥掉再拼，
  // 否则会得到 oc-file://local//D:/x，pathname 变双斜杠，下游 fileURLToPath 直接抛错
  const path = url.slice("file:".length).replace(/^\/+/, "")
  return `${LOCAL_FILE_PROTOCOL}://${LOCAL_FILE_HOST}/${path}`
}
