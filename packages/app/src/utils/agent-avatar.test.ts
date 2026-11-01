import { expect, test } from "bun:test"
import { agentAvatar, agentAvatarSrc, agentAvatarSeeds } from "./agent-avatar"

const decoded = (src: string) => decodeURIComponent(src.slice(src.indexOf(",") + 1))

test("按名字生成的头像一定有五官", () => {
  // build 的哈希超过 2^31：早先用有符号右移取变体，下标会变成负数，
  // 眼睛 / 嘴巴直接以 undefined 写进 SVG，画出来是张没有五官的脸。
  const svg = decoded(agentAvatarSrc("build"))
  expect(svg).not.toContain("undefined")
  expect(svg.includes("<circle") || svg.includes("<path")).toBe(true)
})

test("挑过头像就按挑的种子生成", () => {
  expect(agentAvatar("build", { avatar: "plum" })).toBe(agentAvatarSrc("plum"))
})

test("没挑 / 空值 / 非字符串都退回按名字生成", () => {
  expect(agentAvatar("build")).toBe(agentAvatarSrc("build"))
  expect(agentAvatar("build", {})).toBe(agentAvatarSrc("build"))
  expect(agentAvatar("build", null)).toBe(agentAvatarSrc("build"))
  expect(agentAvatar("build", { avatar: "   " })).toBe(agentAvatarSrc("build"))
  expect(agentAvatar("build", { avatar: 42 })).toBe(agentAvatarSrc("build"))
})

test("候选头像互不相同", () => {
  const srcs = new Set(agentAvatarSeeds.map((seed) => agentAvatarSrc(seed)))
  expect(srcs.size).toBe(agentAvatarSeeds.length)
})
