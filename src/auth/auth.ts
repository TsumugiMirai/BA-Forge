// Accounts in front of the online features (card library, China
// specialization setup). People register with an invite code or log in; the
// server (POST /rpc/register, /rpc/login, see server/schema.sql) answers with
// a token that every API request then carries, plus who the account is.
// Without a token the server hands out no data. Both are remembered in this
// browser until the token expires (30 days); making cards and saving them in
// this browser needs no account.

import { CLOUD_URL } from '../cloud/config'

const STORAGE_KEY = 'ba-recard.token'
/** what the former in-page password check remembered; no longer valid */
const OLD_STORAGE_KEY = 'ba-recard.auth'
const TIMEOUT_MS = 20000

export type Role = 'admin' | 'member'

export interface Account {
  username: string
  /** shown on cards; empty means the username is shown */
  displayName: string
  role: Role
}

interface Session {
  token: string
  /** ms since epoch */
  expiresAt: number
  /** null for a token remembered before accounts had names; the store asks
   *  the server (/rpc/me) then */
  account: Account | null
}

export type LoginResult = 'ok' | 'wrong' | 'busy' | 'error'
export type RegisterResult = 'ok' | 'username' | 'password' | 'invite' | 'taken' | 'busy' | 'error'

export interface RegisterInput {
  username: string
  password: string
  inviteCode: string
  displayName: string
}

let session: Session | null = readSession()
let onExpired: (() => void) | null = null

/** the account fields of a server answer ({username, display_name, role}) */
export function parseAccount(value: unknown): Account | null {
  const v = value as { username?: unknown; display_name?: unknown; role?: unknown } | null
  if (!v || typeof v.username !== 'string') return null
  return {
    username: v.username,
    displayName: typeof v.display_name === 'string' ? v.display_name : '',
    role: v.role === 'admin' ? 'admin' : 'member',
  }
}

function readSession(): Session | null {
  try {
    localStorage.removeItem(OLD_STORAGE_KEY)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Session>
    if (typeof s.token !== 'string' || typeof s.expiresAt !== 'number') return null
    if (s.expiresAt <= Date.now()) return null
    return { token: s.token, expiresAt: s.expiresAt, account: parseAccount(s.account && toWire(s.account)) }
  } catch {
    return null
  }
}

function toWire(a: Account): Record<string, unknown> {
  return { username: a.username, display_name: a.displayName, role: a.role }
}

function keep(s: Session | null): void {
  session = s
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // not fatal: the login just isn't remembered
  }
}

/** keep the token of a login/register answer; false when it is malformed */
function keepAnswer(body: unknown): boolean {
  const b = body as { token?: unknown; expires_at?: unknown } | null
  if (!b || typeof b.token !== 'string' || typeof b.expires_at !== 'number') return false
  keep({ token: b.token, expiresAt: b.expires_at * 1000, account: parseAccount(body) })
  return true
}

async function post(path: string, body: unknown): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${CLOUD_URL}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Ask the server to check the account and password; remembers the token. */
export async function login(account: string, password: string): Promise<LoginResult> {
  try {
    const res = await post('rpc/login', { username: account.trim(), password })
    if (res.status === 401 || res.status === 403) return 'wrong'
    if (res.status === 429) return 'busy'
    if (!res.ok) return 'error'
    return keepAnswer(await res.json()) ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

/** Create an account (needs a valid invite code) and log in with it. */
export async function register(input: RegisterInput): Promise<RegisterResult> {
  try {
    const res = await post('rpc/register', {
      username: input.username.trim(),
      password: input.password,
      invite_code: input.inviteCode.trim(),
      display_name: input.displayName.trim(),
    })
    if (res.status === 429) return 'busy'
    if (!res.ok) {
      const reason = ((await res.json().catch(() => null)) as { message?: string } | null)?.message
      if (reason === 'username' || reason === 'password' || reason === 'invite' || reason === 'taken')
        return reason
      return 'error'
    }
    return keepAnswer(await res.json()) ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

/** logged in earlier in this browser and the token has not expired */
export function isLoggedIn(): boolean {
  return !!session && session.expiresAt > Date.now()
}

/** who is logged in, as last heard from the server (null when logged out,
 *  or for an old token until /rpc/me answers) */
export function currentAccount(): Account | null {
  return isLoggedIn() ? (session?.account ?? null) : null
}

/** remember new account details (display name changed, or /rpc/me answered) */
export function rememberAccount(account: Account): void {
  if (session) keep({ ...session, account })
}

export function logout(): void {
  keep(null)
}

/** the Authorization header for API requests (empty when logged out) */
export function authHeader(): Record<string, string> {
  return session ? { Authorization: `Bearer ${session.token}` } : {}
}

/** called once by the store: what to do when the server rejects the token */
export function onLoginExpired(handler: () => void): void {
  onExpired = handler
}

/** the server answered 401: the token expired or the password changed */
export function loginRejected(): void {
  keep(null)
  onExpired?.()
}
