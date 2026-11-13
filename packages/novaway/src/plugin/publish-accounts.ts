import { createHash } from "node:crypto"
import path from "node:path"
import { Global } from "@novaway/core/global"
import type { PublishAccount } from "@novaway/plugin-api"
import { createSecretStore } from "./runtime/secrets"

export type StoredPublishAccount = PublishAccount & {
  driverID: string
  createdAt: number
}

/**
 * Instance-scoped account storage for trusted publish drivers.
 * Tokens are encrypted at rest by the same local secret primitive used by the
 * Runtime Host. The directory hash prevents a project account from leaking
 * into another instance while keeping workspace paths out of filenames.
 */
function storeFor(directory: string, driverID: string) {
  const identity = createHash("sha256").update(`${directory}\0${driverID}`).digest("hex")
  return createSecretStore(path.join(Global.Path.data, "plugin-publish-accounts", identity))
}

async function readAll(directory: string, driverID: string): Promise<StoredPublishAccount[]> {
  const store = storeFor(directory, driverID)
  const raw = await store.read("accounts")
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isStoredAccount) : []
  } catch {
    return []
  }
}

async function writeAll(directory: string, driverID: string, accounts: StoredPublishAccount[]) {
  await storeFor(directory, driverID).write("accounts", JSON.stringify(accounts))
}

export async function listPublishAccounts(directory: string, driverID: string) {
  return readAll(directory, driverID)
}

export async function findPublishAccount(directory: string, driverID: string, accountID: string) {
  return (await readAll(directory, driverID)).find((account) => account.id === accountID)
}

export async function savePublishAccount(directory: string, driverID: string, account: PublishAccount) {
  const accounts = await readAll(directory, driverID)
  const stored: StoredPublishAccount = { ...account, driverID, createdAt: Date.now() }
  const next = [...accounts.filter((item) => item.id !== account.id), stored]
  await writeAll(directory, driverID, next)
  return stored
}

export async function removePublishAccount(directory: string, driverID: string, accountID: string) {
  const accounts = await readAll(directory, driverID)
  const next = accounts.filter((item) => item.id !== accountID)
  if (next.length !== accounts.length) await writeAll(directory, driverID, next)
  return next.length !== accounts.length
}

function isStoredAccount(value: unknown): value is StoredPublishAccount {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === "string" &&
    typeof item.driverID === "string" &&
    typeof item.label === "string" &&
    typeof item.token === "string" &&
    typeof item.createdAt === "number" &&
    !!item.profile &&
    typeof item.profile === "object" &&
    !Array.isArray(item.profile)
  )
}
