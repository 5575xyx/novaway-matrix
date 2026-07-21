import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  assertReleaseUrlsReady,
  evaluateStableProductionGate,
  parseReleaseList,
  resolveUpdatePolicy,
} from "../../src/config/powersnexus"

test("stable 策略拒绝占位发布端点", () => {
  expect(() =>
    assertReleaseUrlsReady({
      policy: "stable",
      releaseManifestUrls: ["https://<gitee-release-endpoint>/stable/manifest.json"],
    }),
  ).toThrow(/占位发布地址/)
  expect(() =>
    assertReleaseUrlsReady({
      policy: "stable",
      releaseManifestUrls: [],
    }),
  ).toThrow(/未配置真实/)
  expect(() =>
    assertReleaseUrlsReady({
      policy: "bundled",
      releaseManifestUrls: ["https://example.com/x"],
    }),
  ).not.toThrow()
  expect(() =>
    assertReleaseUrlsReady({
      policy: "stable",
      releaseManifestUrls: ["https://example.com/powersnexus/stable/manifest.json"],
    }),
  ).toThrow(/占位发布地址/)
})

test("stable 策略接受真实 HTTPS 端点形态", () => {
  expect(() =>
    assertReleaseUrlsReady({
      policy: "stable",
      releaseManifestUrls: ["https://cdn.novaway.ai/powersnexus/stable/manifest.json"],
    }),
  ).not.toThrow()
})

test("生产门禁：缺白名单/公钥时 ready=false", () => {
  const report = evaluateStableProductionGate({
    policy: "stable",
    releaseManifestUrls: ["https://cdn.novaway.ai/powersnexus/stable/manifest.json"],
    releaseAllowedHosts: [],
  })
  expect(report.ready).toBe(false)
  expect(report.blockers.some((b) => b.includes("releaseAllowedHosts") || b.includes("白名单"))).toBe(true)
})

test("生产门禁：完整配置时 ready=true", () => {
  const dir = path.join(os.tmpdir(), `pn-gate-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const keyPath = path.join(dir, "public.pem")
  writeFileSync(
    keyPath,
    "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAK9rF0QHrHX1LWmkq0LUi36nwFJtjjUM8sOfH7WXvku4=\n-----END PUBLIC KEY-----\n",
  )
  try {
    const report = evaluateStableProductionGate({
      policy: "stable",
      releaseManifestUrls: [
        "https://cdn.novaway.ai/powersnexus/stable/manifest.json",
        "https://releases.novaway.ai/powersnexus/stable/manifest.json",
      ],
      releaseAllowedHosts: ["cdn.novaway.ai", "releases.novaway.ai"],
      publicKeyPath: keyPath,
      keyID: "powersnexus-release-2026-01",
    })
    expect(report.ready).toBe(true)
    expect(report.blockers).toEqual([])
    const resolved = resolveUpdatePolicy({
      policy: "stable",
      releaseManifestUrls: report.checks.filter((c) => c.id.startsWith("url_ok")).length
        ? [
            "https://cdn.novaway.ai/powersnexus/stable/manifest.json",
            "https://releases.novaway.ai/powersnexus/stable/manifest.json",
          ]
        : [],
      releaseAllowedHosts: ["cdn.novaway.ai", "releases.novaway.ai"],
      publicKeyPath: keyPath,
      keyID: "powersnexus-release-2026-01",
      strictProductionGate: true,
    })
    expect(resolved.policy).toBe("stable")
    expect(resolved.degraded).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("生产门禁：localhost 默认拒绝，ALLOW_LOCAL 才放行形态", () => {
  const blocked = evaluateStableProductionGate({
    policy: "stable",
    releaseManifestUrls: ["https://localhost:8443/stable/manifest.json"],
    releaseAllowedHosts: ["localhost"],
    keyID: "powersnexus-release-2026-01",
  })
  expect(blocked.ready).toBe(false)
  const allowed = evaluateStableProductionGate({
    policy: "stable",
    releaseManifestUrls: ["https://localhost:8443/stable/manifest.json"],
    releaseAllowedHosts: ["localhost"],
    keyID: "powersnexus-release-2026-01",
    allowLocalEndpoints: true,
    publicKeyPath: undefined,
  })
  // 仍可能因公钥失败
  expect(allowed.checks.some((c) => c.id.startsWith("url_") && c.ok)).toBe(true)
})

test("resolveUpdatePolicy：无 URL 的 stable 降级 bundled", () => {
  const resolved = resolveUpdatePolicy({ policy: "stable", releaseManifestUrls: [] })
  expect(resolved.policy).toBe("bundled")
  expect(resolved.degraded).toBe(true)
})

test("解析桌面环境中的Gitee发布源", () => {
  expect(
    parseReleaseList(
      "https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json; gitee.com,foruda.gitee.com",
    ),
  ).toEqual([
    "https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json",
    "gitee.com",
    "foruda.gitee.com",
  ])
})

test("生产门禁接受Gitee入口和附件重定向域名", () => {
  const dir = path.join(os.tmpdir(), `pn-gitee-gate-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const keyPath = path.join(dir, "public.pem")
  writeFileSync(
    keyPath,
    "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAK9rF0QHrHX1LWmkq0LUi36nwFJtjjUM8sOfH7WXvku4=\n-----END PUBLIC KEY-----\n",
  )
  try {
    const report = evaluateStableProductionGate({
      policy: "stable",
      releaseManifestUrls: [
        "https://gitee.com/nova-way/powersnexus/releases/download/powersnexus-stable/manifest.json",
      ],
      releaseAllowedHosts: ["gitee.com", "foruda.gitee.com"],
      publicKeyPath: keyPath,
      keyID: "powersnexus-release-2026-01",
    })
    expect(report.ready).toBe(true)
    expect(report.blockers).toEqual([])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})