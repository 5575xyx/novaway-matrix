import { createContext, createMemo, useContext } from "solid-js"
import { createStore } from "solid-js/store"
import { precheckPublish } from "@novaway/core/publish-precheck"
import type { PrecheckResult, PublishBatch, PublishBatchInput, PublishProgressEvent } from "@/pages/pulse/publish-types"
import { accountDisplayName } from "@/pages/pulse/account-name"
import xhsIcon from "@/assets/platform-icons/xhs.svg"
import douyinIcon from "@/assets/platform-icons/douyin.svg"
import bilibiliIcon from "@/assets/platform-icons/bilibili.svg"
import ksIcon from "@/assets/platform-icons/ks.svg"
import wxSphIcon from "@/assets/platform-icons/wx-sph.svg"
import wxGzhIcon from "@/assets/platform-icons/wx-gzh.svg"
import xianyuIcon from "@/assets/platform-icons/xianyu.svg"

export interface PlatformAccount {
  id: string
  platform: string
  uid: string
  account: string
  nickname: string
  avatar: string
  cookies: string
  token: string
  loginTime: number
  status: "valid" | "expired" | "login_failed"
  fansCount: number
  readCount: number
  likeCount: number
  collectCount: number
  forwardCount: number
  commentCount: number
  workCount: number
  income: number
  abnormalStatus: Record<string, any> | null
  groupId: number
  lastStatsTime: number | null
}

export interface AccountGroup {
  id: number
  name: string
  rank: number
  proxyIp: string
  proxyOpen: boolean
}

export interface PlatformInfo {
  id: string
  name: string
  icon: string
  color: string
  loginUrl: string
  viewUrl: string
}

export const PLATFORM_LIST: PlatformInfo[] = [
  {
    id: "xhs",
    name: "小红书",
    icon: xhsIcon,
    color: "#FF2442",
    loginUrl: "https://www.xiaohongshu.com/",
    viewUrl: "https://creator.xiaohongshu.com/login?source=official",
  },
  {
    id: "douyin",
    name: "抖音",
    icon: douyinIcon,
    color: "#000000",
    loginUrl: "https://creator.douyin.com/",
    viewUrl: "https://creator.douyin.com/creator-micro/content/upload?enter_from=dou_web",
  },
  {
    id: "bilibili",
    name: "B站",
    icon: bilibiliIcon,
    color: "#00A1D6",
    loginUrl: "https://member.bilibili.com/",
    viewUrl: "https://member.bilibili.com/",
  },
  {
    id: "kwai",
    name: "快手",
    icon: ksIcon,
    color: "#FF4906",
    loginUrl: "https://cp.kuaishou.com/profile",
    viewUrl: "https://cp.kuaishou.com/profile",
  },
  {
    id: "wxSph",
    name: "视频号",
    icon: wxSphIcon,
    color: "#07C160",
    loginUrl: "https://channels.weixin.qq.com/",
    viewUrl:
      "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/hepler_merlin_mmdata?_rid=67b30b55-6e3ea588",
  },
  {
    id: "wxGzh",
    name: "公众号",
    icon: wxGzhIcon,
    color: "#07C160",
    loginUrl: "https://mp.weixin.qq.com/",
    viewUrl: "https://mp.weixin.qq.com/",
  },
  {
    id: "xianyu",
    name: "闲鱼",
    icon: xianyuIcon,
    color: "#FF6A00",
    loginUrl: "https://www.goofish.com/",
    viewUrl: "https://www.goofish.com/im",
  },
]

const DEFAULT_GROUP_ID = 1

const DEFAULT_GROUP: AccountGroup = {
  id: DEFAULT_GROUP_ID,
  name: "默认列表",
  rank: 0,
  proxyIp: "",
  proxyOpen: false,
}

interface PlatformStore {
  accounts: PlatformAccount[]
  groups: AccountGroup[]
  selectedAccountId: string | null
  loading: boolean
}

const initialStore: PlatformStore = {
  accounts: [],
  groups: [DEFAULT_GROUP],
  selectedAccountId: null,
  loading: false,
}

interface PlatformAccountsContextValue {
  store: PlatformStore
  refreshAccounts: () => Promise<void>
  refreshGroups: () => Promise<void>
  addAccount: (platform: string) => Promise<{ success: boolean; account?: PlatformAccount; error?: string }>
  removeAccount: (id: string) => Promise<void>
  removeAccounts: (ids: string[]) => Promise<void>
  selectAccount: (id: string | null) => void
  moveAccountToGroup: (accountId: string, groupId: number) => Promise<void>
  createGroup: (name: string) => Promise<number>
  renameGroup: (id: number, name: string) => Promise<void>
  deleteGroup: (id: number) => Promise<void>
  accountsInGroup: (groupId: number) => PlatformAccount[]
  onlineCount: () => number
  platformTags: () => string[]
  checkAllLogins: () => Promise<{ id: string; platform: string; nickname: string; avatar: string; valid: boolean }[]>
  checkSingleLogin: (id: string) => Promise<boolean>
  /** 补全缺失的昵称/头像（迁移过来的老记录常见），完成后刷新列表。 */
  refreshProfiles: (ids?: string[]) => Promise<void>
  /** 账号显示名：昵称 → 平台账号 → 平台名，避免列表出现空白行。 */
  displayName: (account: PlatformAccount) => string
  publish: (accountId: string, input: any) => Promise<any>
  /** 一站式发布：多账号（可跨平台）一次提交，进度从 onPublishProgress 回来。 */
  publishBatch: (accountIds: string[], input: PublishBatchInput) => Promise<{ ok: boolean; error?: string }>
  /** 发布前预检：有问题先展示给用户，别等平台拒稿。 */
  publishPrecheck: (platforms: string[], input: PublishBatchInput) => Promise<PrecheckResult>
  cancelPublish: () => Promise<void>
  publishBatches: () => Promise<PublishBatch[]>
  onPublishProgress: (cb: (event: PublishProgressEvent) => void) => () => void
  onPublishFinished: (cb: (batch: PublishBatch | { error: string }) => void) => () => void
}

const PlatformAccountsContext = createContext<PlatformAccountsContextValue>(null!)

export function PlatformAccountsProvider(props: { children: any }) {
  const [store, setStore] = createStore<PlatformStore>(initialStore)

  const refreshAccounts = async () => {
    if ((window as any).api?.platform?.getAccounts) {
      const accounts = await (window as any).api.platform.getAccounts()
      setStore("accounts", accounts || [])
    }
  }

  const refreshGroups = async () => {
    if ((window as any).api?.platform?.getGroups) {
      const groups = await (window as any).api.platform.getGroups()
      setStore("groups", groups || [DEFAULT_GROUP])
    }
  }

  const addAccount = async (
    platform: string,
  ): Promise<{ success: boolean; account?: PlatformAccount; error?: string }> => {
    if (!(window as any).api?.platform?.addAccount) return { success: false, error: "API not available" }
    const result = await (window as any).api.platform.addAccount(platform)
    if (result?.success) {
      await refreshAccounts()
    }
    return result || { success: false, error: "No response" }
  }

  const removeAccount = async (id: string) => {
    if (!(window as any).api?.platform?.removeAccount) return
    await (window as any).api.platform.removeAccount(id)
    await refreshAccounts()
    if (store.selectedAccountId === id) {
      setStore("selectedAccountId", null)
    }
  }

  const removeAccounts = async (ids: string[]) => {
    for (const id of ids) {
      await removeAccount(id)
    }
  }

  const selectAccount = (id: string | null) => {
    setStore("selectedAccountId", id)
  }

  const moveAccountToGroup = async (accountId: string, groupId: number) => {
    if ((window as any).api?.platform?.moveAccountGroup) {
      await (window as any).api.platform.moveAccountGroup({ accountId, groupId })
      await refreshAccounts()
    }
  }

  const createGroup = async (name: string): Promise<number> => {
    if ((window as any).api?.platform?.addGroup) {
      const result = await (window as any).api.platform.addGroup({ name })
      await refreshGroups()
      return result.id
    }
    return Date.now()
  }

  const renameGroup = async (id: number, name: string) => {
    if ((window as any).api?.platform?.editGroup) {
      await (window as any).api.platform.editGroup({ id, name })
      await refreshGroups()
    }
  }

  const deleteGroup = async (id: number) => {
    if (id === DEFAULT_GROUP_ID) return
    if ((window as any).api?.platform?.deleteGroup) {
      await (window as any).api.platform.deleteGroup(id)
      await refreshGroups()
      await refreshAccounts()
    }
  }

  const accountsInGroup = (groupId: number) => {
    return store.accounts.filter((a) => a.groupId === groupId)
  }

  const onlineCount = createMemo(() => store.accounts.filter((a) => a.status === "valid").length)

  const platformTags = createMemo(() => {
    const tags = new Set<string>()
    for (const acc of store.accounts) {
      const info = PLATFORM_LIST.find((p) => p.id === acc.platform)
      if (info) tags.add(info.name)
    }
    return Array.from(tags)
  })

  const checkAllLogins = async () => {
    const currentAccounts = store.accounts
    if (!(window as any).api?.platform?.batchCheckLogin) {
      if (!(window as any).api?.platform?.checkLogin) return []
      setStore("loading", true)
      const output: { id: string; platform: string; nickname: string; avatar: string; valid: boolean }[] = []
      for (const account of currentAccounts) {
        try {
          const result = await (window as any).api.platform.checkLogin(account.id)
          setStore("accounts", (a) => a.id === account.id, "status", result.valid ? "valid" : "expired")
          output.push({
            id: account.id,
            platform: account.platform,
            nickname: result.nickname ?? account.nickname,
            avatar: result.avatar ?? account.avatar,
            valid: result.valid,
          })
        } catch {
          setStore("accounts", (a) => a.id === account.id, "status", "login_failed")
          output.push({
            id: account.id,
            platform: account.platform,
            nickname: account.nickname,
            avatar: account.avatar,
            valid: false,
          })
        }
      }
      // 巡检时主进程会顺手补昵称/头像：拉一遍，列表才能立刻显示新资料。
      await refreshAccounts()
      setStore("loading", false)
      return output
    }
    setStore("loading", true)
    try {
      const ids = currentAccounts.map((a) => a.id)
      const results: { id: string; valid: boolean }[] = await (window as any).api.platform.batchCheckLogin(ids)
      for (const r of results) {
        setStore("accounts", (a) => a.id === r.id, "status", r.valid ? "valid" : "expired")
      }
      await refreshAccounts()
      setStore("loading", false)
      return results.map((r) => {
        const acc = currentAccounts.find((a) => a.id === r.id)
        return {
          id: r.id,
          platform: acc?.platform || "",
          nickname: acc?.nickname || "",
          avatar: acc?.avatar || "",
          valid: r.valid,
        }
      })
    } catch {
      for (const acc of currentAccounts) {
        setStore("accounts", (a) => a.id === acc.id, "status", "login_failed")
      }
      setStore("loading", false)
      return currentAccounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        nickname: a.nickname,
        avatar: a.avatar,
        valid: false,
      }))
    }
  }

  const checkSingleLogin = async (id: string): Promise<boolean> => {
    if (!(window as any).api?.platform?.checkLogin) return false
    const result = await (window as any).api.platform.checkLogin(id)
    setStore("accounts", (a) => a.id === id, "status", result.valid ? "valid" : "expired")
    // 单账号巡检同样会补资料，拉一遍让头像/昵称立即出现。
    await refreshAccounts()
    return result.valid
  }

  /**
   * 补全缺失的昵称/头像。
   *
   * 旧版本（XYMT-AUTO 迁移）存下来的账号可能只有 cookie、没有名字和头像：
   * 这些资料要靠"接口/页面"再抓一次才能补上。做成幂等 + 后台跑，不阻塞界面。
   */
  const refreshProfiles = async (ids?: string[]) => {
    const api = (window as any).api?.platform
    if (!api?.refreshProfiles) return
    const targets = ids ?? store.accounts.filter((a) => !a.nickname || !a.avatar).map((a) => a.id)
    if (targets.length === 0) return
    try {
      const result = await api.refreshProfiles(targets)
      if (Array.isArray(result?.accounts)) setStore("accounts", result.accounts)
      else await refreshAccounts()
    } catch {
      // 补资料是增强，失败保持原样
    }
  }

  const displayName = (account: PlatformAccount) =>
    accountDisplayName(account, PLATFORM_LIST.find((p) => p.id === account.platform)?.name)

  const publish = async (accountId: string, input: any) => {
    if (!(window as any).api?.platform?.publish) return null
    return (window as any).api.platform.publish({ accountId, publishInput: input })
  }

  const publishBatch = async (accountIds: string[], input: PublishBatchInput) => {
    const api = (window as any).api?.platform
    if (!api?.publishBatch) return { ok: false, error: "当前环境不支持发布（需要桌面端）" }
    return api.publishBatch({ accountIds, input })
  }

  const publishPrecheck = async (platforms: string[], input: PublishBatchInput): Promise<PrecheckResult> => {
    const api = (window as any).api?.platform
    // 桌面端走主进程（那里还能顺带做发布前的兜底检查）；Web 版没有主进程，
    // 就用同一份规则在本地跑 —— 规则来自 @novaway/core，不会两边结论不一致。
    if (api?.publishPrecheck) return api.publishPrecheck({ platforms, input })
    return precheckPublish(input, platforms)
  }

  const cancelPublish = async () => {
    await (window as any).api?.platform?.cancelPublish?.()
  }

  const publishBatches = async (): Promise<PublishBatch[]> => {
    const api = (window as any).api?.platform
    if (!api?.getPublishBatches) return []
    const batches = await api.getPublishBatches()
    return Array.isArray(batches) ? batches : []
  }

  const onPublishProgress = (cb: (event: PublishProgressEvent) => void) => {
    const api = (window as any).api?.platform
    if (!api?.onPublishProgress) return () => {}
    return api.onPublishProgress(cb)
  }

  const onPublishFinished = (cb: (batch: PublishBatch | { error: string }) => void) => {
    const api = (window as any).api?.platform
    if (!api?.onPublishFinished) return () => {}
    return api.onPublishFinished(cb)
  }

  return (
    <PlatformAccountsContext.Provider
      value={{
        store,
        refreshAccounts,
        refreshGroups,
        addAccount,
        removeAccount,
        removeAccounts,
        selectAccount,
        moveAccountToGroup,
        createGroup,
        renameGroup,
        deleteGroup,
        accountsInGroup,
        onlineCount,
        platformTags,
        checkAllLogins,
        checkSingleLogin,
        refreshProfiles,
        displayName,
        publish,
        publishBatch,
        publishPrecheck,
        cancelPublish,
        publishBatches,
        onPublishProgress,
        onPublishFinished,
      }}
    >
      {props.children}
    </PlatformAccountsContext.Provider>
  )
}

export function usePlatformAccounts() {
  return useContext(PlatformAccountsContext)!
}
