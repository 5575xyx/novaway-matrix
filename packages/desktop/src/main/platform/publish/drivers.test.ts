import { describe, expect, test } from "bun:test"
import { DRIVERS, getDriver } from "./drivers"

describe("publish drivers", () => {
  test("公众号的编辑页要用登录后地址栏里的 token 拼出来", () => {
    const driver = getDriver("wxGzh")!
    expect(driver.hosts).toEqual(["mp.weixin.qq.com"])
    // 首页只是入口：直接打开首页填不了任何东西，之前就是卡在这里。
    expect(driver.url.article).toBe("https://mp.weixin.qq.com/")
    const editor = driver.editorUrl!("123456")
    expect(editor).toContain("/cgi-bin/appmsg")
    expect(editor).toContain("action=edit")
    expect(editor).toContain("token=123456")
  })

  test("公众号只自动点「保存为草稿」，绝不自动群发", () => {
    const driver = getDriver("wxGzh")!
    for (const pattern of driver.submitText ?? []) {
      expect(pattern).not.toContain("群发")
    }
    expect(driver.submitText).toContain("^保存为草稿$")
    // 群发不可撤销、还有次数限制；成功文案也不能让人误以为已经群发出去。
    expect(driver.successMessage).toContain("草稿")
  })

  test("每个平台的发布页都声明了域名，发布才能复用运营工作台里已登录的页面", () => {
    for (const [id, driver] of Object.entries(DRIVERS)) {
      expect({ id, ok: (driver.hosts?.length ?? 0) > 0 }).toEqual({ id, ok: true })
    }
  })

  test("公众号正文要能命中同源 iframe 里的编辑器", () => {
    const driver = getDriver("wxGzh")!
    expect(driver.descriptionEditor?.some((selector) => selector.includes("ueditor"))).toBe(true)
  })
})
