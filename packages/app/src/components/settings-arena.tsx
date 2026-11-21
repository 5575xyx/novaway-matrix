import type { Config } from "@novaway/sdk/v2/client"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Popover } from "@novaway/ui/popover"
import { Switch } from "@novaway/ui/switch"
import { showToast } from "@novaway/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { createMemo, For, Show, type Component } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { SettingsGroup, SettingsNumberField, SettingsPage, SettingsRow } from "./settings-parts"

type ModelOption = { key: string; label: string; providerID: string; providerName: string }

/**
 * 参赛模型多选：选项来自当前已连接供应商的模型目录，值为 `provider/model`，
 * 与 arena.models 的存储格式一致。按已选顺序保存 —— 运行时按这个顺序创建 contender。
 */
const ModelMultiSelect: Component<{
  value: string[]
  disabled?: boolean
  onChange: (next: string[]) => void
}> = (props) => {
  const models = useModels()

  const options = createMemo<ModelOption[]>(() =>
    models.list().map((model) => ({
      key: `${model.provider.id}/${model.id}`,
      label: model.name,
      providerID: model.provider.id,
      providerName: model.provider.name ?? model.provider.id,
    })),
  )

  const groups = createMemo(() => {
    const result = new Map<string, { name: string; items: ModelOption[] }>()
    for (const option of options()) {
      const group = result.get(option.providerID) ?? { name: option.providerName, items: [] }
      group.items.push(option)
      result.set(option.providerID, group)
    }
    return [...result.values()]
  })

  // 配置里可能有已经断开/下线的供应商模型：仍然列出来，否则用户没法把它们去掉。
  const missing = createMemo(() => props.value.filter((key) => !options().some((option) => option.key === key)))

  const labelOf = (key: string) => {
    const option = options().find((item) => item.key === key)
    return option ? `${option.providerName} · ${option.label}` : key
  }

  const toggle = (key: string, checked: boolean) => {
    if (checked) {
      if (props.value.includes(key)) return
      props.onChange([...props.value, key])
      return
    }
    props.onChange(props.value.filter((item) => item !== key))
  }

  const summary = createMemo(() => {
    const value = props.value
    if (value.length === 0) return "选择参赛模型"
    if (value.length === 1) return labelOf(value[0])
    return `已选 ${value.length} 个模型`
  })

  const checkRow = (option: ModelOption) => {
    const checked = () => props.value.includes(option.key)
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked()}
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
        onClick={() => toggle(option.key, !checked())}
      >
        <span
          aria-hidden="true"
          classList={{
            "grid size-4 shrink-0 place-items-center rounded-sm border transition-colors": true,
            "border-surface-interactive-base bg-surface-interactive-base text-[var(--text-on-interactive-base)]":
              checked(),
            "border-border bg-background text-transparent": !checked(),
          }}
        >
          <Show when={checked()}>
            <Icon name="check-small" size="small" />
          </Show>
        </span>
        <span class="min-w-0 flex-1 truncate text-12-regular text-foreground">{option.label}</span>
        <span class="shrink-0 text-11-regular text-foreground-subtlest">{option.key}</span>
      </button>
    )
  }

  return (
    <Popover
      placement="bottom-end"
      gutter={6}
      triggerAs={Button}
      triggerProps={{
        variant: "secondary",
        class: "w-full min-w-0 justify-between gap-2",
        disabled: props.disabled,
        "data-action": "arena-models-open",
      }}
      trigger={
        <>
          <span
            classList={{
              "min-w-0 flex-1 truncate text-left text-12-regular": true,
              "text-foreground-subtle": props.value.length === 0,
              "text-foreground": props.value.length > 0,
            }}
          >
            {summary()}
          </span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-foreground-subtle" />
        </>
      }
      class="w-[320px]"
    >
      <div class="flex max-h-80 flex-col overflow-y-auto no-scrollbar">
        <Show
          when={options().length > 0}
          fallback={
            <div class="px-2 py-3 text-12-regular leading-5 text-foreground-subtle">
              还没有可用模型。先在「模型」设置里连接供应商，这里就会出现可勾选的模型。
            </div>
          }
        >
          <For each={groups()}>
            {(group) => (
              <div class="flex flex-col py-1">
                <div class="px-2 pb-1 text-11-medium text-foreground-subtlest">{group.name}</div>
                <For each={group.items}>{(option) => checkRow(option)}</For>
              </div>
            )}
          </For>
        </Show>
        <Show when={missing().length > 0}>
          <div class="flex flex-col border-t border-border/80 py-1">
            <div class="px-2 pb-1 pt-1 text-11-medium text-foreground-subtlest">不在当前模型列表中</div>
            <For each={missing()}>{(key) => checkRow({ key, label: key, providerID: "", providerName: "" })}</For>
          </div>
        </Show>
      </div>
    </Popover>
  )
}

/**
 * Arena 竞技：同一任务在多个独立 worktree 中并行运行，结束后对比产出。
 *
 * 只有 Arena 自己的配置放在这里；程序入口在「竞技场」页面与会话内的 arena_run 工具，
 * 不在设置页里重复执行。
 */
export const SettingsArena: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()

  const arena = createMemo(() => globalSync.data.config.arena ?? {})
  const selectedModels = createMemo(() => arena().models ?? [])

  const save = useMutation(() => ({
    mutationFn: (config: Config) => globalSync.updateConfig(config),
    onError: (err) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))

  const update = (patch: Partial<Config["arena"]>) => save.mutate({ arena: { ...arena(), ...patch } } as Config)

  return (
    <SettingsPage
      title={language.t("settings.arena.settingsTitle" as never)}
      description={language.t("settings.arena.settingsDescription" as never)}
    >
      <div class="flex flex-col gap-2">
        <h3 class="text-14-medium text-foreground">运行配置</h3>
        <SettingsGroup>
          <SettingsRow
            label="启用 Arena"
            description="关闭时 arena_run 工具不会注入模型，运行接口也会直接拒绝。"
            control={
              <Switch
                checked={arena().enabled === true}
                disabled={save.isPending}
                onChange={(value) => update({ enabled: value })}
                hideLabel
              >
                启用 Arena
              </Switch>
            }
          />
          <SettingsRow
            label="参赛模型"
            description="从已连接的模型里多选；运行时按勾选顺序创建 contender。"
            layout="wide"
            control={
              <ModelMultiSelect
                value={selectedModels()}
                disabled={save.isPending}
                onChange={(models) => update({ models })}
              />
            }
          />
          <SettingsRow
            label="并行数"
            description="同时运行的 contender 数量。"
            control={
              <SettingsNumberField
                value={arena().concurrency}
                fallback={2}
                min={1}
                disabled={save.isPending || arena().enabled !== true}
                onSave={(value) => update({ concurrency: Math.max(1, value) })}
              />
            }
          />
          <SettingsRow
            label="每次最大模型数"
            description="单次运行允许的 contender 上限；超出会被拒绝。"
            control={
              <SettingsNumberField
                value={arena().max_contenders}
                fallback={4}
                min={1}
                disabled={save.isPending || arena().enabled !== true}
                onSave={(value) => update({ max_contenders: Math.max(1, value) })}
              />
            }
          />
          <SettingsRow
            label="保留运行 worktree"
            description="运行结束后保留各 contender 的 worktree，便于手动检查差异。"
            control={
              <Switch
                checked={arena().keep_worktrees === true}
                disabled={save.isPending || arena().enabled !== true}
                onChange={(value) => update({ keep_worktrees: value })}
                hideLabel
              >
                保留 worktree
              </Switch>
            }
          />
        </SettingsGroup>
      </div>

      <div class="rounded-xl border border-border bg-surface px-4 py-3">
        <div class="text-13-medium text-foreground">怎么运行</div>
        <ol class="mt-1.5 flex list-decimal flex-col gap-1 pl-4 text-12-regular text-foreground-subtle">
          <li>先在上方勾选参赛模型，并在左栏「竞技场」页面提交任务。</li>
          <li>每个 contender 在独立 worktree 中执行同一任务，互不影响当前工作区。</li>
          <li>结束后在「竞技场」页面并排查看产出与差异；也可以让助手直接调用 arena_run。</li>
        </ol>
        <div class="mt-2 text-12-regular text-foreground-subtlest">
          每次运行都会创建临时 worktree 并产生多次模型调用，注意 Token 成本。
        </div>
      </div>
    </SettingsPage>
  )
}
