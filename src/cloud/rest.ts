// Shared plumbing for the server's REST API (PostgREST, see server/): the
// `cards` (online card library) and `specs` (China specialization setup)
// tables and the account functions under /rpc. Every request carries the
// login token from src/auth.

import { authHeader, loginRejected } from '../auth/auth'
import { CLOUD_URL } from './config'

/** someone else saved the row after it was loaded here */
export class CloudConflictError extends Error {
  constructor() {
    super('conflict')
  }
}

/** the table does not exist yet (server/schema.sql has not been run) */
export class CloudMissingTableError extends Error {
  constructor(table: string) {
    super(`missing table ${table}`)
  }
}

/** the server refused the login token; the page shows the login again */
export class CloudAuthError extends Error {
  constructor() {
    super('login expired')
  }
}

/** any other refused request; `reason` is the server's short code, e.g.
 *  "not_owner" or "admin" (the message of a PTxxx error in server/schema.sql) */
export class CloudHttpError extends Error {
  readonly status: number
  readonly reason: string
  constructor(status: number, reason: string, detail: string) {
    super(`HTTP ${status}${detail ? `: ${detail}` : ''}`)
    this.status = status
    this.reason = reason
  }
}

const TIMEOUT_MS = 30000

export function endpoint(table: string, query = ''): string {
  return `${CLOUD_URL}/${table}${query}`
}

export function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeader(), ...extra }
}

export async function request<T>(url: string, init: RequestInit, table = ''): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const text = await res.text()
    if (res.status === 401) {
      loginRejected()
      throw new CloudAuthError()
    }
    if (!res.ok) {
      let detail = text
      let code = ''
      let message = ''
      try {
        const body = JSON.parse(text) as { message?: string; hint?: string; code?: string }
        code = body.code ?? ''
        message = body.message ?? ''
        detail = [body.message, body.hint].filter(Boolean).join(' — ') || text
      } catch {
        // keep the raw text
      }
      // PGRST205: "Could not find the table … in the schema cache"
      if (table && (code === 'PGRST205' || code === '42P01')) throw new CloudMissingTableError(table)
      throw new CloudHttpError(res.status, message, detail)
    }
    return (text ? JSON.parse(text) : null) as T
  } finally {
    clearTimeout(timer)
  }
}

/** Call a server function (POST /rpc/<name>) with named arguments. */
export function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return request<T>(endpoint(`rpc/${name}`), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args),
  })
}
