import { getStore } from "../store"

export interface StoredAccount {
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

const ACCOUNTS_KEY = "platform.accounts"
const ACCOUNT_GROUPS_KEY = "platform.accountGroups"
const PUBLISH_RECORDS_KEY = "platform.publishRecords"

const store = getStore("novaway.platform")

export function getAccounts(): StoredAccount[] {
  return (store.get(ACCOUNTS_KEY) as StoredAccount[]) || []
}

export function saveAccount(account: StoredAccount): void {
  const accounts = getAccounts()
  const existingIndex = accounts.findIndex((a) => a.id === account.id)
  if (existingIndex >= 0) {
    accounts[existingIndex] = { ...accounts[existingIndex], ...account }
  } else {
    accounts.push(account)
  }
  store.set(ACCOUNTS_KEY, accounts)
}

export function addOrUpdateAccount(
  query: { platform: string; uid: string },
  data: Partial<StoredAccount>,
): StoredAccount {
  const accounts = getAccounts()
  const existing = accounts.find((a) => a.platform === query.platform && a.uid === query.uid)
  if (existing) {
    Object.assign(existing, data, { loginTime: Date.now() })
    store.set(ACCOUNTS_KEY, accounts)
    return existing
  }
  const newAccount: StoredAccount = {
    id: `${query.platform}_${Date.now()}`,
    platform: query.platform,
    uid: query.uid,
    account: data.account || query.uid,
    nickname: data.nickname || "",
    avatar: data.avatar || "",
    cookies: data.cookies || "",
    token: data.token || "",
    loginTime: Date.now(),
    status: (data.status as StoredAccount["status"]) || "valid",
    fansCount: data.fansCount || 0,
    readCount: data.readCount || 0,
    likeCount: data.likeCount || 0,
    collectCount: data.collectCount || 0,
    forwardCount: data.forwardCount || 0,
    commentCount: data.commentCount || 0,
    workCount: data.workCount || 0,
    income: data.income || 0,
    abnormalStatus: data.abnormalStatus || null,
    groupId: data.groupId ?? 1,
    lastStatsTime: data.lastStatsTime || null,
  }
  accounts.push(newAccount)
  store.set(ACCOUNTS_KEY, accounts)
  return newAccount
}

export function removeAccount(id: string): void {
  const accounts = getAccounts().filter((a) => a.id !== id)
  store.set(ACCOUNTS_KEY, accounts)
}

export function getAccount(id: string): StoredAccount | undefined {
  return getAccounts().find((a) => a.id === id)
}

export function updateAccountStatus(id: string, status: StoredAccount["status"]): void {
  const accounts = getAccounts()
  const account = accounts.find((a) => a.id === id)
  if (account) {
    account.status = status
    store.set(ACCOUNTS_KEY, accounts)
  }
}

export function updateAccountInfo(id: string, data: Partial<StoredAccount>): void {
  const accounts = getAccounts()
  const account = accounts.find((a) => a.id === id)
  if (account) {
    Object.assign(account, data)
    store.set(ACCOUNTS_KEY, accounts)
  }
}

export interface AccountGroup {
  id: number
  name: string
  rank: number
  proxyIp: string
  proxyOpen: boolean
}

const DEFAULT_GROUP: AccountGroup = {
  id: 1,
  name: "默认列表",
  rank: 0,
  proxyIp: "",
  proxyOpen: false,
}

export function getAccountGroups(): AccountGroup[] {
  return (store.get(ACCOUNT_GROUPS_KEY) as AccountGroup[]) || [DEFAULT_GROUP]
}

export function saveAccountGroup(group: AccountGroup): void {
  const groups = getAccountGroups()
  const existingIndex = groups.findIndex((g) => g.id === group.id)
  if (existingIndex >= 0) {
    groups[existingIndex] = { ...groups[existingIndex], ...group }
  } else {
    groups.push(group)
  }
  store.set(ACCOUNT_GROUPS_KEY, groups)
}

export function deleteAccountGroup(id: number): void {
  const groups = getAccountGroups().filter((g) => g.id !== id)
  store.set(ACCOUNT_GROUPS_KEY, groups)

  const accounts = getAccounts()
  for (const account of accounts) {
    if (account.groupId === id) {
      account.groupId = 1
    }
  }
  store.set(ACCOUNTS_KEY, accounts)
}

export function editAccountGroup(data: Partial<AccountGroup>): void {
  if (!data.id) return
  const groups = getAccountGroups()
  const group = groups.find((g) => g.id === data.id)
  if (group) {
    Object.assign(group, data)
    store.set(ACCOUNT_GROUPS_KEY, groups)
  }
}
