import { useLanguage } from "@/context/language"

/**
 * 思考强度档位的显示名。
 *
 * 档位是**模型自己给的**（`model.variants` 的键）：有的模型只有低/中/高，
 * 有的还有「高+」，厂商也可能塞进自定义键。已知档位走 i18n，
 * 不认识的键原样显示，绝不吞掉 —— 少显示一档比显示错一档更糟。
 */
const VARIANT_LABEL_KEYS = {
  default: "workspace.header.variant.default",
  low: "workspace.header.variant.low",
  medium: "workspace.header.variant.medium",
  high: "workspace.header.variant.high",
  max: "workspace.header.variant.max",
} as const

export function useVariantLabel() {
  const language = useLanguage()
  return (value: string) => {
    const key = VARIANT_LABEL_KEYS[value as keyof typeof VARIANT_LABEL_KEYS]
    return key ? language.t(key) : value
  }
}
