import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { createSecretStore } from "@/plugin/runtime/secrets"
import { tmpdir } from "../fixture/fixture"

describe("plugin local secret store", () => {
  test("missing reads do not create a key or directory", async () => {
    await using tmp = await tmpdir()
    const directory = path.join(tmp.path, "secrets")
    expect(await createSecretStore(directory).read("missing")).toBeUndefined()
    expect(await fs.stat(directory).catch(() => undefined)).toBeUndefined()
  })

  test("persists encrypted values across store instances and hashes names", async () => {
    await using tmp = await tmpdir()
    const directory = path.join(tmp.path, "secrets")
    const store = createSecretStore(directory)
    await store.write("../../token", "a-sensitive-value")
    expect(await createSecretStore(directory).read("../../token")).toBe("a-sensitive-value")
    const files = await fs.readdir(directory)
    expect(files).toHaveLength(2)
    expect(files.filter((name) => name.endsWith(".secret"))).toHaveLength(1)
    for (const name of files) {
      expect((await fs.readFile(path.join(directory, name))).includes(Buffer.from("a-sensitive-value"))).toBe(false)
    }
    expect(await fs.stat(path.join(tmp.path, "token")).catch(() => undefined)).toBeUndefined()
    await store.write("../../token", "updated")
    expect(await store.read("../../token")).toBe("updated")
  })

  test("concurrent first writers share one fully written encryption key", async () => {
    await using tmp = await tmpdir()
    const directory = path.join(tmp.path, "secrets")
    const left = createSecretStore(directory)
    const right = createSecretStore(directory)
    await Promise.all([left.write("left", "one"), right.write("right", "two")])
    expect(await left.read("right")).toBe("two")
    expect(await right.read("left")).toBe("one")
    expect((await fs.readdir(directory)).filter((name) => name.startsWith(".key-"))).toEqual([])
  })

  test("corrupt keys fail without replacing or silently hiding encrypted data", async () => {
    await using tmp = await tmpdir()
    const directory = path.join(tmp.path, "secrets")
    const store = createSecretStore(directory)
    await store.write("token", "existing")
    await fs.writeFile(path.join(directory, ".key"), "invalid")
    await expect(store.read("token")).rejects.toThrow("密钥损坏")
    await expect(store.write("other", "new")).rejects.toThrow("密钥损坏")
    expect(await fs.readFile(path.join(directory, ".key"), "utf8")).toBe("invalid")
  })

  test("ciphertext tampering is detected and removing one secret leaves others intact", async () => {
    await using tmp = await tmpdir()
    const directory = path.join(tmp.path, "secrets")
    const store = createSecretStore(directory)
    await store.write("token", "sensitive")
    await store.write("keep", "retained")
    await store.remove("token")
    expect(await store.read("token")).toBeUndefined()
    expect(await store.read("keep")).toBe("retained")
    const name = (await fs.readdir(directory)).find((entry) => entry.endsWith(".secret"))!
    const file = path.join(directory, name)
    const bytes = await fs.readFile(file)
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1
    await fs.writeFile(file, bytes)
    await expect(store.read("keep")).rejects.toThrow()
  })
})
