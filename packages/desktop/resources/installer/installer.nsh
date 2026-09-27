# NovaWay NSIS 安装器自定义脚本(electron-builder nsis.include)
#
# 这个文件在共享头部被 !include —— 位置在 installer.nsi 之前,所以只有「宏定义」是
# 安全的,任何依赖 MUI2/multiUser 的内容都必须写在宏体里(宏体在展开处才求值)。
#
# 目标:
#   1) 更新(带 --updated)时不再问"为哪位用户安装":直接沿用上次的安装模式;
#   2) 更新装完直接重启新版本,不再让用户勾"运行 NovaWay";
#   3) 全新安装保持原行为(有安装模式选择页、有运行复选框)。

# 共享头部只 include 了 StdUtils.nsh;LogicLib 需要用 ${if} 系列,自己带上(有 guard,重复 include 安全)。
!include "LogicLib.nsh"

# ---------------------------------------------------------------------------
# 1) 更新时沿用上次的安装模式,跳过安装模式选择页
# ---------------------------------------------------------------------------
# multiUserUi.nsh 的 InstallModePre 会先置 $isForceMachineInstall/$isForceCurrentInstall
# 为 "0",再 `!insertmacro customInstallMode`,之后只要其中一个被置 "1" 就直接选定模式并
# Abort 掉本页 —— 用户不会再看到选择界面,装的位置/范围与上次完全一致。
# $hasPerMachineInstallation/$hasPerUserInstallation 由 onInit 的 initMultiUser 从注册表读出。
!macro customInstallMode
  ${if} ${isUpdated}
    ${if} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${elseif} $hasPerUserInstallation == "1"
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  ${endif}
!macroend

# ---------------------------------------------------------------------------
# 2) 更新装完直接重启,不再显示"运行 NovaWay"复选框
# ---------------------------------------------------------------------------
# 说明:electron-builder 的 assisted installer 只在 `isForceRun AND Silent` 时自动拉起应用
# (见 templates/nsis/installSection.nsh),而 electron-updater 的 quitAndInstall(false, true)
# 只传 --force-run、不传 /S,所以必须在安装完成时自己启动。
#
# 这里刻意不 `!insertmacro StartApp`:那个宏第一行是 `Var /GLOBAL startAppArgs`,而
# installSection.nsh 结尾的 doStartApp 会再插一次同一个宏,重复声明 Var 会让 makensis
# 直接报 "variable startAppArgs already declared"。所以直接调 StdUtils 起进程。
!macro customInstall
  ${if} ${isUpdated}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
  ${endif}
!macroend

# 用自定义完成页替换默认完成页(默认那份在有/无 runAfterFinish 时行为不同,这里统一接管):
#   - 更新:在 PRE 里直接 Abort 跳过完成页(应用已经在 customInstall 里拉起,无需再确认);
#   - 全新安装:保留"运行 NovaWay"复选框,行为与原先一致。
!macro customFinishPage
  !ifndef BUILD_UNINSTALLER
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    Function NovaWayFinishPre
      ${if} ${isUpdated}
        Abort
      ${endif}
    FunctionEnd

    !define MUI_PAGE_CUSTOMFUNCTION_PRE NovaWayFinishPre
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
    !insertmacro MUI_PAGE_FINISH
  !endif
!macroend
