import { expect, test } from "bun:test"
import { assertReleaseUrlsReady } from "../../src/config/powersnexus"

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
