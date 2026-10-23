import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { globalInstallArgs } from "@/tool/installation-doctor"
import { findPackageDir, inspectInstall, isPostinstallStub, platformSuffix } from "@/installation/diagnose"

const temps: string[] = []

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-doctor-"))
  temps.push(dir)
  return dir
}

afterEach(async () => {
  while (temps.length) await fs.rm(temps.pop()!, { recursive: true, force: true })
})

describe("installation diagnose", () => {
  test("derives the platform suffix from os and arch", () => {
    expect(platformSuffix("win32", "x64")).toBe("windows-x64")
    expect(platformSuffix("darwin", "arm64")).toBe("darwin-arm64")
    expect(platformSuffix("linux", "x64")).toBe("linux-x64")
  })

  test("detects the postinstall placeholder instead of a real binary", async () => {
    const dir = await tempDir()
    const stub = path.join(dir, "novaway.exe")
    await fs.writeFile(stub, 'echo "Error: xymt-novaway\'s postinstall script was not run." >&2\nexit 1\n')
    expect(isPostinstallStub(stub)).toBe(true)
  })

  test("treats a large file as a real binary", async () => {
    const dir = await tempDir()
    const binary = path.join(dir, "novaway.exe")
    await fs.writeFile(binary, Buffer.alloc(128 * 1024))
    expect(isPostinstallStub(binary)).toBe(false)
  })

  test("finds a package by walking up node_modules", async () => {
    const root = await tempDir()
    const pkg = path.join(root, "node_modules", "xymt-novaway-windows-x64")
    await fs.mkdir(pkg, { recursive: true })
    expect(findPackageDir(path.join(root, "bin"), "xymt-novaway-windows-x64")).toBe(pkg)
    expect(findPackageDir(path.join(root, "bin"), "missing")).toBeUndefined()
  })

  test("inspects a broken install with a postinstall placeholder", async () => {
    const root = await tempDir()
    const wrapper = path.join(root, "node_modules", "xymt-novaway")
    await fs.mkdir(path.join(wrapper, "bin"), { recursive: true })
    await fs.writeFile(path.join(wrapper, "package.json"), JSON.stringify({ name: "xymt-novaway" }))
    await fs.writeFile(path.join(wrapper, "bin", "novaway.exe"), 'echo "postinstall script was not run"\nexit 1')
    const layout = inspectInstall({
      execPath: path.join(wrapper, "bin", "novaway.exe"),
      platform: "win32",
      platformPackagePrefix: "xymt-novaway",
    })
    expect(layout.development).toBe(false)
    expect(layout.wrapperName).toBe("xymt-novaway")
    expect(layout.postinstallStub).toBe(true)
    expect(layout.platformPackage).toBe("xymt-novaway-windows-x64")
    expect(layout.platformPackagePresent).toBe(false)
  })

  test("inspects a healthy install", async () => {
    const root = await tempDir()
    const wrapper = path.join(root, "node_modules", "xymt-novaway")
    const platform = path.join(root, "node_modules", "xymt-novaway-windows-x64")
    await fs.mkdir(path.join(wrapper, "bin"), { recursive: true })
    await fs.mkdir(path.join(platform, "bin"), { recursive: true })
    await fs.writeFile(path.join(wrapper, "package.json"), JSON.stringify({ name: "xymt-novaway" }))
    await fs.writeFile(path.join(wrapper, "bin", "novaway.exe"), Buffer.alloc(128 * 1024))
    const layout = inspectInstall({
      execPath: path.join(wrapper, "bin", "novaway.exe"),
      platform: "win32",
      platformPackagePrefix: "xymt-novaway",
    })
    expect(layout.binaryPath).toBeDefined()
    expect(layout.postinstallStub).toBe(false)
    expect(layout.platformPackagePresent).toBe(true)
  })

  test("recognizes a development runtime", () => {
    const layout = inspectInstall({ execPath: "/usr/local/bin/bun", platform: "linux" })
    expect(layout.development).toBe(true)
    expect(layout.postinstallStub).toBe(false)
  })

  test("builds npm-family install commands with an optional registry", () => {
    expect(globalInstallArgs("npm", "1.2.3")).toEqual(["install", "-g", "xymt-novaway@1.2.3"])
    expect(globalInstallArgs("npm", "1.2.3", "https://registry.npmmirror.com")).toEqual([
      "install",
      "-g",
      "xymt-novaway@1.2.3",
      "--registry",
      "https://registry.npmmirror.com",
    ])
    expect(globalInstallArgs("pnpm", "1.2.3")).toEqual(["add", "-g", "xymt-novaway@1.2.3"])
    expect(globalInstallArgs("yarn", "1.2.3")).toEqual(["global", "add", "xymt-novaway@1.2.3"])
    expect(globalInstallArgs("bun", "1.2.3")).toEqual(["add", "-g", "xymt-novaway@1.2.3"])
  })
})
