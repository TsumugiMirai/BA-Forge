// Page login with one shared account, in front of the online features (card
// library, China specialization setup).
//
// The server checks the password (POST /rpc/login, see server/schema.sql) and
// answers with a token that every API request then carries; without it the
// server hands out no data. The token is remembered in this browser until it
// expires (30 days) or the password is changed on the server, which signs
// everyone out.

import { CLOUD_URL } from '../cloud/config'

const STORAGE_KEY = 'ba-recard.token'
/** what the former in-page password check remembered; no longer valid */
const OLD_STORAGE_KEY = 'ba-recard.auth'
const TIMEOUT_MS = 20000

interface Session {
  token: string
  /** ms since epoch */
  expiresAt: number
}

export type LoginResult = 'ok' | 'wrong' | 'busy' | 'error'

let session: Session | null = readSession()
let onExpired: (() => void) | null = null

function readSession(): Session | null {
  try {
    localStorage.removeItem(OLD_STORAGE_KEY)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Session>
    if (typeof s.token !== 'string' || typeof s.expiresAt !== 'number') return null
    return s.expiresAt > Date.now() ? { token: s.token, expiresAt: s.expiresAt } : null
  } catch {
    return null
  }
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

/** Ask the server to check the account and password; remembers the token. */
export async function login(account: string, password: string): Promise<LoginResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${CLOUD_URL}/rpc/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: account.trim(), password }),
      signal: ctrl.signal,
    })
    if (res.status === 401 || res.status === 403) return 'wrong'
    if (res.status === 429) return 'busy'
    if (!res.ok) return 'error'
    const body = (await res.json()) as { token?: unknown; expires_at?: unknown }
    if (typeof body.token !== 'string' || typeof body.expires_at !== 'number') return 'error'
    keep({ token: body.token, expiresAt: body.expires_at * 1000 })
    return 'ok'
  } catch {
    return 'error'
  } finally {
    clearTimeout(timer)
  }
}

/** logged in earlier in this browser and the token has not expired */
export function isLoggedIn(): boolean {
  return !!session && session.expiresAt > Date.now()
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
