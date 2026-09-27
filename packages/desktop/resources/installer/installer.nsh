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
# 0) 首次安装时的文案(欢迎页 / 完成页)
# ---------------------------------------------------------------------------
# electron-builder 默认给 26 种语言都注册了 MUI_LANGUAGE,并且用 -WX(警告即错误)编译,
# 所以任何自定义 LangString 都必须对这 26 个语言表都有定义,否则 makensis 直接报
# "warning 6040: LangString ... is not set in language table"(LCID 取值见 nsisLang 的 lcid 映射)。
# 下面用 _NOVAWAY_STR 一次性把 26 个语言都填满:英文兜底,简繁中文单独本地化。
!macro _NOVAWAY_STR name en zhCN zhTW
  LangString ${name} 1033 "${en}" # en_US
  LangString ${name} 1031 "${en}" # de_DE
  LangString ${name} 1036 "${en}" # fr_FR
  LangString ${name} 3082 "${en}" # es_ES
  LangString ${name} 2052 "${zhCN}" # zh_CN
  LangString ${name} 1028 "${zhTW}" # zh_TW
  LangString ${name} 1041 "${en}" # ja_JP
  LangString ${name} 1042 "${en}" # ko_KR
  LangString ${name} 1040 "${en}" # it_IT
  LangString ${name} 1043 "${en}" # nl_NL
  LangString ${name} 1030 "${en}" # da_DK
  LangString ${name} 1053 "${en}" # sv_SE
  LangString ${name} 1044 "${en}" # nb_NO
  LangString ${name} 1035 "${en}" # fi_FI
  LangString ${name} 1049 "${en}" # ru_RU
  LangString ${name} 2070 "${en}" # pt_PT
  LangString ${name} 1046 "${en}" # pt_BR
  LangString ${name} 1045 "${en}" # pl_PL
  LangString ${name} 1058 "${en}" # uk_UA
  LangString ${name} 1029 "${en}" # cs_CZ
  LangString ${name} 1051 "${en}" # sk_SK
  LangString ${name} 1038 "${en}" # hu_HU
  LangString ${name} 1025 "${en}" # ar_SA
  LangString ${name} 1055 "${en}" # tr_TR
  LangString ${name} 1054 "${en}" # th_TH
  LangString ${name} 1066 "${en}" # vi_VN
!macroend

!insertmacro _NOVAWAY_STR NOVAWAY_WELCOME_TITLE \
  "Welcome to NovaWay" "欢迎使用 NovaWay" "歡迎使用 NovaWay"
!insertmacro _NOVAWAY_STR NOVAWAY_WELCOME_TEXT \
  "This wizard will install NovaWay — your all-in-one AI workspace.$\r$\n$\r$\nClick Next to continue." \
  "本向导将为你安装 NovaWay —— 你的 AI 全能工作舱。$\r$\n$\r$\n点击「下一步」继续。" \
  "本精靈將為你安裝 NovaWay —— 你的 AI 全能工作艙。$\r$\n$\r$\n點擊「下一步」繼續。"
!insertmacro _NOVAWAY_STR NOVAWAY_FINISH_TITLE \
  "NovaWay is ready" "NovaWay 安装完成" "NovaWay 安裝完成"
!insertmacro _NOVAWAY_STR NOVAWAY_FINISH_TEXT \
  "NovaWay has been installed successfully.$\r$\nClick Finish to get started." \
  "NovaWay 已成功安装。$\r$\n点击「完成」即可开始使用。" \
  "NovaWay 已成功安裝。$\r$\n點擊「完成」即可開始使用。"
!insertmacro _NOVAWAY_STR NOVAWAY_FINISH_RUN \
  "Run NovaWay" "运行 NovaWay" "執行 NovaWay"

# ---------------------------------------------------------------------------
# 0b) 首次安装的欢迎页(更新时跳过)
# ---------------------------------------------------------------------------
# electron-builder 的 assisted installer 只有在定义了 customWelcomePage 时才插入欢迎页
# (见 templates/nsis/assistedInstaller.nsh)。默认流程第一屏就是"为哪位用户安装",比较生硬;
# 这里补一个品牌欢迎页。注意它没有 skipPageIfUpdated,所以更新时要自己在 PRE 里 Abort。
!macro customWelcomePage
  !ifndef BUILD_UNINSTALLER
    Function NovaWayWelcomePre
      ${if} ${isUpdated}
        Abort
      ${endif}
    FunctionEnd

    !define MUI_PAGE_CUSTOMFUNCTION_PRE NovaWayWelcomePre
    !define MUI_WELCOMEPAGE_TITLE "$(NOVAWAY_WELCOME_TITLE)"
    !define MUI_WELCOMEPAGE_TEXT "$(NOVAWAY_WELCOME_TEXT)"
    !insertmacro MUI_PAGE_WELCOME
  !endif
!macroend

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
#   - 全新安装:保留"运行 NovaWay"复选框,但标题/正文/勾选项都换成上面的品牌文案。
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
    !define MUI_FINISHPAGE_TITLE "$(NOVAWAY_FINISH_TITLE)"
    !define MUI_FINISHPAGE_TEXT "$(NOVAWAY_FINISH_TEXT)"
    !define MUI_FINISHPAGE_TEXT_LARGE
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "$(NOVAWAY_FINISH_RUN)"
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
    !insertmacro MUI_PAGE_FINISH
  !endif
!macroend
