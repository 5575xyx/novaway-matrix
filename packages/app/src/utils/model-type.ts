/**
 * 模型类型选择器的选项。
 *
 * 文案走 i18n：之前三个弹窗各自写了一份中文常量，切到英文界面时
 * 「文本模型 / 图片生成」这些标签仍然是中文。
 */
export type ModelType = "text" | "image" | "video" | "audio"

type Translator = (key: string) => string

export function modelTypeOptions(t: Translator): { value: ModelType; label: string }[] {
  return [
    { value: "text", label: t("provider.custom.models.type.text") },
    { value: "image", label: t("provider.custom.models.type.image") },
    { value: "video", label: t("provider.custom.models.type.video") },
    { value: "audio", label: t("provider.custom.models.type.audio") },
  ]
}
