import { Match, Switch } from "solid-js"
import { Navigate, useNavigate } from "@solidjs/router"
import { base64Encode } from "@novaway/core/util/encode"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@novaway/ui/context/dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useServer } from "@/context/server"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { HomeHeader } from "@/components/home-header"
import { OfficeHomeWorkspace } from "@/components/office-home-workspace"
import { officeWorkspaceSearch, type OfficeLaunchConfig } from "./home/office-home"
import type { HomeActionId } from "./home/zen-office"
import TaskCenterPage from "./task-center"

export default function Home() {
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const layout = useLayout()

  function registerProject(directory: string) {
    layout.projects.assign(directory)
    layout.projects.open(directory)
    server.projects.touch(directory)
  }

  function enterOfficeProject(
    directory: string,
    prompt: string,
    officeID: HomeActionId,
    pptTemplate?: string,
    launchConfig?: OfficeLaunchConfig,
    submit = false,
  ) {
    registerProject(directory)
    const query = officeWorkspaceSearch({ prompt, officeID, pptTemplate, launchConfig, submit })
    navigate(`/${base64Encode(directory)}/session?${query.toString()}`)
  }

  async function selectOfficeProject() {
    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog({
        title: language.t("command.project.open"),
        multiple: false,
      })
      return Array.isArray(result) ? result[0] : (result ?? undefined)
    }

    return new Promise<string | undefined>((resolve) => {
      void dialog.show(
        () => (
          <DialogSelectDirectory
            multiple={false}
            onSelect={(result) => resolve(Array.isArray(result) ? result[0] : (result ?? undefined))}
          />
        ),
        () => resolve(undefined),
      )
    })
  }

  // 桌面端移除了全局标题栏，`sidebar-top-band` 只在侧栏展开时显示 NovaWay + 折叠按钮，
  // 折叠后侧栏宽度归 0、整块顶带消失，用户失去「回首页 / 展开侧栏 / 关掉窗口」的全部入口。
  // 会话页有 WorkspaceHeader 承载这些职责，首页原本没有 —— HomeHeader 就是补它那一块。
  return (
    <div class="flex size-full flex-col">
      <HomeHeader />
      <div class="min-h-0 flex-1">
        <Switch>
          <Match when={layout.mode.current() === "pulse"}>
            <Navigate href="/pulse" />
          </Match>
          <Match when={layout.mode.current() === "zen"}>
            <OfficeHomeWorkspace onEnterProject={enterOfficeProject} onSelectProject={selectOfficeProject} />
          </Match>
          <Match when>
            <TaskCenterPage />
          </Match>
        </Switch>
      </div>
    </div>
  )
}
