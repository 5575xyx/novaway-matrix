import { describe, expect, test } from "bun:test"
import { DRIVERS, getDriver } from "./drivers"

describe("publish drivers", () => {
  test("公众号：编辑页要用 token 拼，且只自动点「保存为草稿」", () => {
    const driver = getDriver("wxGzh")!
    expect(driver.hosts).toEqual(["mp.weixin.qq.com"])
    // 首页只是入口：直接打开首页填不了任何东西。
    expect(driver.url.article).toBe("https://mp.weixin.qq.com/")
    expect(driver.editorUrl!("123456")).toContain("token=123456")
    // 建草稿直接调后台接口，不碰编辑器 DOM。
    expect(driver.draftApi).toBe("wechat")
    for (const pattern of driver.submitText ?? []) expect(pattern).not.toContain("群发")
    expect(driver.successMessage).toContain("草稿")
  })

  test("小红书：发布按钮在 closed shadow root 里，只能按坐标点", () => {
    const driver = getDriver("xhs")!
    // 新版上传框是 input.upload-input，老版是裸的 input[type=file]。
    expect(driver.fileInput).toContain("input.upload-input")
    expect(driver.descriptionEditor).toContain("div.tiptap")
    expect(driver.submitClick?.host).toBe("xhs-publish-btn")
    // 上传/发布完成前宿主上是 submit-disabled="true"，等它变 false 再点。
    expect(driver.submitClick?.waitAttr).toEqual({ name: "submit-disabled", value: "false" })
  })

  test("抖音：「上传成功」一闪而过，必须看「取消上传」消失", () => {
    const driver = getDriver("douyin")!
    expect(driver.uploadingText).toEqual(["取消上传"])
    expect(driver.uploadedText).toContain("重新上传")
    expect(driver.descriptionEditor).toContain(".zone-container")
  })

  test("视频号：表单在 wujie 影子树里，成功判据是跳作品列表", () => {
    const driver = getDriver("wxSph")!
    expect(driver.descriptionEditor).toContain("div.input-editor")
    expect(driver.submitSelector?.[0]).toContain("form-btns")
    expect(driver.successUrl).toBe("/platform/post/list")
  })

  test("快手：点的必须是底部主按钮，不是左侧导航项", () => {
    const driver = getDriver("kwai")!
    expect(driver.submitSelector?.[0]).toContain("button-primary")
    expect(driver.submitSelector?.join(" ")).not.toContain("publish-button")
  })

  test("B站：简介是 Quill 编辑器", () => {
    expect(getDriver("bilibili")!.descriptionEditor).toContain(".desc-container .ql-editor")
  })

  test("每个平台都有域名、文件入口（需要时）和至少一种提交策略", () => {
    for (const [id, driver] of Object.entries(DRIVERS)) {
      const hasSubmit = Boolean(driver.submitClick || driver.submitSelector?.length || driver.submitText?.length)
      expect({ id, ok: (driver.hosts?.length ?? 0) > 0 && hasSubmit }).toEqual({ id, ok: true })
      const hasFiles = (driver.supports ?? []).some((kind) => kind !== "article")
      if (hasFiles) expect({ id, ok: (driver.fileInput?.length ?? 0) > 0 }).toEqual({ id, ok: true })
    }
  })
})
