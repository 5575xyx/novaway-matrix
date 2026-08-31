// 取 SDK 底层的 hey-api 原始客户端。
//
// 生成的 NovawayClient 只暴露类型化方法,没有通用 get/post/patch/delete;
// 服务端已注册但 SDK 尚未生成方法的路由(检查点/目标/工作流/编排、
// experimental 工具调用)只能走底层客户端。
//
// 属性名坑:基类 HeyApiClient 里这个字段叫 `client`(TS 的 protected 只在编译期有效,
// 运行时就是普通属性)。之前这里写的是 `_client`,那是不存在的字段,取到 undefined,
// 于是所有走这条路的面板要么静默空列表、要么报
// "undefined is not an object (evaluating 'raw(client).post')"。
// 两个名字都试一遍,再取不到就明确报错,不再静默失败。
import type { NovawayClient } from "@novaway/sdk-v2-latest/v2"

export type RawClient = {
  get: (opts: { url: string }) => Promise<{ data?: unknown; error?: unknown }>
  post: (opts: { url: string; body?: unknown }) => Promise<{ data?: unknown; error?: unknown }>
  patch: (opts: { url: string; body?: unknown }) => Promise<{ data?: unknown; error?: unknown }>
  delete: (opts: { url: string }) => Promise<{ data?: unknown; error?: unknown }>
}

export function rawClient(client: NovawayClient): RawClient {
  const holder = client as unknown as { client?: RawClient; _client?: RawClient }
  const raw = holder.client ?? holder._client
  if (!raw || typeof raw.post !== "function") {
    throw new Error("SDK 底层客户端不可用(NovawayClient 结构变了?)")
  }
  return raw
}
