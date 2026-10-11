// 「自动批准权限」的二次确认闸门。
//
// 这东西只有一条理由存在:开了之后所有工具调用的权限请求都会被自动批掉,不再逐条询问 ——
// 包括删文件、执行命令这类危险动作。UI 上一个开关点下去就生效,是把「误触」直接变成
// 「误触 + 自动执行」,所以**关→开这一向必须过一次确认**;反过来关掉是安全动作,不弹。
//
// 文案只放这一处:输入框右上角的开关与命令面板的「启用自动批准权限」两条入口共用同一个闸门
// (见 component/prompt/index.tsx 与 app.tsx 的 permission.mode),文案分两份写就一定会漂。
import { DialogConfirm } from "./dialog-confirm"
import type { DialogContext } from "./dialog"

/**
 * 请求开启自动批准。用户点「确定」返回 true,取消或直接关掉对话框返回 false/undefined。
 *
 * 调用方自己负责 `permission.set("auto")` —— 这里不碰权限状态,免得 ui 层反向依赖
 * context 层;它只决定「这句话该不该问」。
 */
export async function requestAutoApprove(dialog: DialogContext): Promise<boolean> {
  const choice = await DialogConfirm.show(
    dialog,
    "开启自动批准权限",
    "开启后所有权限请求(改文件、执行命令、删除等)都会被自动批准,不再逐条询问。确认要开吗?输入框右上角的开关随时可以关掉。",
  )
  return choice === true
}
