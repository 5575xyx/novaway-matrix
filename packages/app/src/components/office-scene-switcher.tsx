import { For, Show } from "solid-js"
import { Icon } from "@novaway/ui/icon"
import { useLanguage } from "@/context/language"
import { zenActions, type HomeActionId } from "@/pages/home/zen-office"

/**
 * 办公场景条 —— 对齐 ZCode 输入卡里的「插件头像 + 加号」那一排。
 *
 * 它原来是一个带文字的整宽 tab 列表（外加一圈 emerald 高亮），在首页占掉一整行；
 * ZCode 的同一位置只有一排**图标**，当前项浮起、其余压暗，说明交给 tooltip。
 * 场景是"这轮要干什么"的粗选，不值得为每个场景常驻一个文字标签。
 */
export function OfficeSceneSwitcher(props: {
  active: HomeActionId
  onSelect: (id: HomeActionId) => void
  class?: string
}) {
  const language = useLanguage()
  return (
    <div
      role="tablist"
      aria-label={language.t("office.home.scene.label")}
      class={`flex min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar ${props.class ?? ""}`}
    >
      <For each={zenActions}>
        {(action) => {
          const active = () => officeSceneIsActive(props.active, action.id)
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active()}
              title={action.title}
              aria-label={action.title}
              class="grid size-7 shrink-0 place-items-center rounded-[8px] transition-colors"
              classList={{
                "bg-surface text-foreground": active(),
                "text-foreground-subtlest hover:bg-hover hover:text-foreground": !active(),
              }}
              onClick={() => props.onSelect(action.id)}
            >
              <Icon name={action.icon} size="small" />
              <Show when={active()}>
                <span class="sr-only">{action.title}</span>
              </Show>
            </button>
          )
        }}
      </For>
    </div>
  )
}

export function officeSceneIsActive(active: HomeActionId, candidate: HomeActionId) {
  return active === candidate
}
