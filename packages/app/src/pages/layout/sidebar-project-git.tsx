import { Show, createSignal, type JSX } from "solid-js"
import { Button } from "@novaway/ui/button"
import { Icon } from "@novaway/ui/icon"
import { Popover } from "@novaway/ui/popover"
import { Spinner } from "@novaway/ui/spinner"
import { showToast } from "@novaway/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import type { LocalProject } from "@/context/layout"

/**
 * 「这个项目还没有 Git 仓库」的入口。
 *
 * 以前它挂在会话右上角的状态面板里：一张常驻的「Git 工具 / 该目录不是 Git 仓库」卡，
 * 跟本次会话无关，还一直占着位置。项目级的属性放在项目行上更合理 —— 左栏项目名
 * 右侧本来就有悬停才出现的按钮（新建任务 / 更多），在这里补一个 branch 图标，
 * 点开是一个小浮层：一句说明 + 一个按钮，不做成整张卡。
 *
 * 只对非 Git 项目渲染。
 * 初始化成功后立刻收起图标，并重新拉一次项目元数据（vcs 变成 git 之后，工作区、
 * 变更面板等按 vcs 分支的入口才会跟着出现）。
 */
export function ProjectGitInit(props: { project: LocalProject }): JSX.Element {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const [busy, setBusy] = createSignal(false)
  // 初始化成功后立刻收起图标：侧栏的项目元数据来自一次 bootstrap 快照，
  // 刷新回来之前不能还留着一个"没初始化"的入口。
  const [initialized, setInitialized] = createSignal(false)

  const init = async () => {
    if (busy()) return
    setBusy(true)
    try {
      await globalSDK.createClient({ directory: props.project.worktree }).project.initGit()
      setInitialized(true)
      globalSync.project.refresh()
      showToast({ variant: "success", icon: "circle-check", title: language.t("git.init.success") })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : language.t("git.init.failed")
      showToast({ variant: "error", title: language.t("git.init.failed"), description: message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={!initialized() && props.project.vcs !== "git"}>
      <Popover
        gutter={6}
        placement="bottom-end"
        triggerAs="button"
        triggerProps={
          {
            type: "button",
            "data-action": "project-git-init",
            "aria-label": language.t("git.init.action"),
            title: language.t("git.init.action"),
            // 与「新建任务」「更多」保持同一套悬停显隐：默认不抢视觉，鼠标进到这一行才出现。
            class:
              "flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle opacity-0 " +
              "transition-colors hover:bg-hover hover:text-foreground focus-visible:opacity-100 " +
              "group-hover:opacity-100",
          } as Record<string, unknown>
        }
        trigger={<Icon name="branch" size="small" />}
        class="w-64"
        title={language.t("git.init.action")}
        description={language.t("git.init.description")}
      >
        <div class="flex items-center justify-end">
          <Button variant="primary" size="small" disabled={busy()} onClick={() => void init()}>
            <Show when={busy()}>
              <Spinner class="mr-1 size-3" />
            </Show>
            {language.t("git.init.action")}
          </Button>
        </div>
      </Popover>
    </Show>
  )
}
