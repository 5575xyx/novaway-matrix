import { afterEach, describe, expect, test } from "bun:test"
import { githubMirrors, withGithubMirrors } from "../../src/util/github"

const previous = process.env.NOVAWAY_GITHUB_MIRROR

afterEach(() => {
  if (previous === undefined) delete process.env.NOVAWAY_GITHUB_MIRROR
  else process.env.NOVAWAY_GITHUB_MIRROR = previous
})

describe("util.github", () => {
  test("defaults to the public mirrors", () => {
    delete process.env.NOVAWAY_GITHUB_MIRROR
    expect(githubMirrors()).toEqual(["https://ghfast.top/", "https://ghproxy.net/"])
  })

  test("normalises a comma separated override", () => {
    process.env.NOVAWAY_GITHUB_MIRROR = " https://a.example , https://b.example/ "
    expect(githubMirrors()).toEqual(["https://a.example/", "https://b.example/"])
  })

  test("keeps the direct url first and appends mirrored copies", () => {
    process.env.NOVAWAY_GITHUB_MIRROR = "https://m.example/"
    expect(withGithubMirrors("https://github.com/o/r/archive/refs/heads/main.zip")).toEqual([
      "https://github.com/o/r/archive/refs/heads/main.zip",
      "https://m.example/https://github.com/o/r/archive/refs/heads/main.zip",
    ])
  })
})
