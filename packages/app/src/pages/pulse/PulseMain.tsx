import { For, Show } from "solid-js"
import { useDialog } from "@novaway/ui/context/dialog"
import { Icon } from "@novaway/ui/icon"
import { usePlatformAccounts } from "@/context/platform-accounts"
import { AddAccountModal } from "./AddAccountModal"
import { PlatformWebView } from "./PlatformWebView"
import { PublishModal } from "./PublishModal"

function ActionCard(props: {
  icon: "plus" | "circle-check" | "paper-plane"
  title: string
  description: string
  action: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      class="group flex min-h-[132px] flex-col rounded-xl border border-border bg-background p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-interactive-hover hover:shadow-[0_10px_30px_color-mix(in_srgb,var(--text-strong)_7%,transparent)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
      onClick={props.onClick}
    >
      <span class="mb-4 flex size-9 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--novaway-mode-color,var(--interactive-base))_12%,transparent)] text-[var(--novaway-mode-color,var(--interactive-base))] transition-transform duration-200 group-hover:scale-105">
        <Icon name={props.icon} size="small" />
      </span>
      <span class="text-13-medium text-foreground">{props.title}</span>
      <span class="mt-1 flex-1 text-11-regular leading-4 text-foreground-subtle">{props.description}</span>
      <span class="mt-3 text-11-medium text-[var(--novaway-mode-color,var(--interactive-base))]">{props.action} →</span>
    </button>
  )
}

function EmptyState() {
  const dialog = useDialog()
  const platform = usePlatformAccounts()
  const openAdd = () => dialog.show(() => <AddAccountModal />)
  const openPublish = () => dialog.show(() => <PublishModal />)

  return (
    <div class="size-full overflow-y-auto bg-background-alt/25">
      <div class="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 py-8">
        <div class="flex items-start justify-between gap-6">
          <div class="max-w-xl">
            <div class="mb-2 flex items-center gap-2 text-11-medium uppercase tracking-[0.14em] text-[var(--novaway-mode-color,var(--interactive-base))]">
              <span class="size-1.5 rounded-full bg-[var(--novaway-mode-color,var(--interactive-base))]" />
              Operations workspace
            </div>
            <h1 class="text-24-semibold tracking-tight text-foreground">先把账号矩阵接入起来</h1>
            <p class="mt-2 text-13-regular leading-6 text-foreground-subtle">
              统一管理多个平台账号、登录状态和发布任务。接入账号后，左侧会显示账号状态，右侧可以直接打开平台页面或安排运营任务。
            </p>
          </div>
          <div class="hidden size-16 shrink-0 items-center justify-center rounded-2xl border border-border bg-background shadow-sm md:flex">
            <Icon name="globe" class="size-7 text-[var(--novaway-mode-color,var(--interactive-base))]" />
          </div>
        </div>
        <div class="mt-8 grid grid-cols-1 gap-3 md:grid-cols-3">
          <ActionCard
            icon="plus"
            title="添加第一个账号"
            description="选择平台并完成登录，账号成功后会加入左侧矩阵。"
            action="开始接入"
            onClick={openAdd}
          />
          <ActionCard
            icon="circle-check"
            title="检查登录状态"
            description="接入账号后批量巡检，及时发现过期或异常账号。"
            action="接入后可用"
            disabled
            onClick={() => undefined}
          />
          <ActionCard
            icon="paper-plane"
            title="一键多平台发布"
            description="完成预检后一次提交，集中查看多个平台的发布结果。"
            action="接入后可用"
            disabled
            onClick={openPublish}
          />
        </div>
        <div class="mt-8 rounded-xl border border-border bg-background/70 p-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-12-medium text-foreground">支持的平台</div>
              <div class="mt-1 text-11-regular text-foreground-subtle">账号资料和登录态由 Desktop 安全管理</div>
            </div>
            <span class="rounded-full border border-border px-2 py-1 text-11-medium text-foreground-subtle">
              7 个平台
            </span>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <For
              each={
                platform.platformTags().length
                  ? platform.platformTags()
                  : ["小红书", "抖音", "B站", "快手", "视频号", "公众号", "闲鱼"]
              }
            >
              {(tag) => (
                <span class="rounded-full border border-border bg-background px-2.5 py-1 text-11-regular text-foreground-subtle">
                  {tag}
                </span>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}

function OverviewState() {
  const dialog = useDialog()
  const platform = usePlatformAccounts()
  const openAdd = () => dialog.show(() => <AddAccountModal />)
  const openPublish = () => dialog.show(() => <PublishModal />)

  return (
    <div class="size-full overflow-y-auto bg-background-alt/25">
      <div class="mx-auto w-full max-w-5xl px-8 py-7">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-11-medium uppercase tracking-[0.14em] text-[var(--novaway-mode-color,var(--interactive-base))]">
              Overview
            </div>
            <h1 class="mt-1 text-22-semibold tracking-tight text-foreground">运营总览</h1>
            <p class="mt-1 text-12-regular text-foreground-subtle">
              选择左侧账号查看平台页面，或直接安排一项运营任务。
            </p>
          </div>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-12-medium text-[var(--novaway-mode-foreground,var(--text-on-interactive-base))] shadow-sm transition-all duration-150 hover:-translate-y-px active:translate-y-0"
            style={{ background: "var(--novaway-mode-color, var(--interactive-base))" }}
            onClick={openPublish}
          >
            <Icon name="paper-plane" size="small" />
            发布内容
          </button>
        </div>
        <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="总账号" value={String(platform.store.accounts.length)} hint="已接入" />
          <StatCard label="在线账号" value={String(platform.onlineCount())} hint="可直接操作" tone="success" />
          <StatCard label="平台" value={String(platform.platformTags().length)} hint="已覆盖" />
          <StatCard
            label="登录异常"
            value={String(platform.store.accounts.filter((item) => item.status !== "valid").length)}
            hint="建议处理"
            tone="warning"
          />
        </div>
        <div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <section class="rounded-xl border border-border bg-background p-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-14-medium text-foreground">开始运营</h2>
                <p class="mt-1 text-11-regular text-foreground-subtle">从账号、内容和数据三个入口快速进入工作流</p>
              </div>
              <button
                type="button"
                class="text-11-medium text-[var(--novaway-mode-color,var(--interactive-base))]"
                onClick={openAdd}
              >
                添加账号 →
              </button>
            </div>
            <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MiniAction icon="plus" title="管理账号" description="添加、分组和巡检账号" onClick={openAdd} />
              <MiniAction
                icon="paper-plane"
                title="发布内容"
                description="选择多个平台统一发布"
                onClick={openPublish}
              />
              <MiniAction
                icon="circle-check"
                title="检查登录"
                description="确认账号是否可用"
                onClick={() => void platform.checkAllLogins()}
              />
            </div>
          </section>
          <section class="rounded-xl border border-border bg-background p-5">
            <div class="text-14-medium text-foreground">平台覆盖</div>
            <div class="mt-1 text-11-regular text-foreground-subtle">已接入的平台会显示在左侧账号列表</div>
            <div class="mt-4 flex flex-wrap gap-2">
              <For each={platform.platformTags()}>
                {(tag) => (
                  <span class="rounded-full border border-border px-2.5 py-1 text-11-regular text-foreground-subtle">
                    {tag}
                  </span>
                )}
              </For>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function StatCard(props: { label: string; value: string; hint: string; tone?: "success" | "warning" }) {
  return (
    <div class="rounded-xl border border-border bg-background p-4">
      <div class="text-11-regular text-foreground-subtle">{props.label}</div>
      <div
        class="mt-2 text-24-semibold"
        classList={{
          "text-success-base": props.tone === "success",
          "text-warning-base": props.tone === "warning",
          "text-foreground": !props.tone,
        }}
      >
        {props.value}
      </div>
      <div class="mt-1 text-11-regular text-foreground-subtlest">{props.hint}</div>
    </div>
  )
}

function MiniAction(props: {
  icon: "plus" | "circle-check" | "paper-plane"
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      class="rounded-lg border border-border p-3 text-left transition-colors hover:border-interactive-hover hover:bg-hover"
      onClick={props.onClick}
    >
      <Icon name={props.icon} size="small" class="text-[var(--novaway-mode-color,var(--interactive-base))]" />
      <div class="mt-3 text-12-medium text-foreground">{props.title}</div>
      <div class="mt-1 text-11-regular leading-4 text-foreground-subtle">{props.description}</div>
    </button>
  )
}

export function PulseMain() {
  const platform = usePlatformAccounts()
  const selectedAccount = () => platform.store.accounts.find((a) => a.id === platform.store.selectedAccountId)

  return (
    <Show
      when={selectedAccount()}
      keyed
      fallback={
        <Show when={platform.store.accounts.length > 0} fallback={<EmptyState />}>
          <OverviewState />
        </Show>
      }
    >
      {(account) => (
        <PlatformWebView
          accountId={account.id}
          platform={account.platform}
          cookies={account.cookies}
          uid={account.uid}
          nickname={account.nickname}
          avatar={account.avatar}
        />
      )}
    </Show>
  )
}
