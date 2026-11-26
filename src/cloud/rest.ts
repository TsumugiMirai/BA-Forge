// Shared plumbing for the Supabase REST (PostgREST) tables the app uses:
// `cards` (online card library) and `specs` (China specialization setup).

import { CLOUD_KEY, CLOUD_URL } from './config'

/** someone else saved the row after it was loaded here */
export class CloudConflictError extends Error {
  constructor() {
    super('conflict')
  }
}

/** the table does not exist yet (its setup SQL has not been run) */
export class CloudMissingTableError extends Error {
  constructor(table: string) {
    super(`missing table ${table}`)
  }
}

const TIMEOUT_MS = 30000

export function endpoint(table: string, query = ''): string {
  return `${CLOUD_URL.trim().replace(/\/+$/, '')}/rest/v1/${table}${query}`
}

export function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = CLOUD_KEY.trim()
  const h: Record<string, string> = { apikey: key, 'Content-Type': 'application/json', ...extra }
  // Legacy anon keys are JWTs and also go in Authorization; the newer
  // publishable keys (sb_publishable_…) must only be sent as `apikey`.
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`
  return h
}

export async function request<T>(url: string, init: RequestInit, table = ''): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const text = await res.text()
    if (!res.ok) {
      let detail = text
      let code = ''
      try {
        const body = JSON.parse(text) as { message?: string; hint?: string; code?: string }
        code = body.code ?? ''
        detail = [body.message, body.hint].filter(Boolean).join(' — ') || text
      } catch {
        // keep the raw text
      }
      // PGRST205: "Could not find the table … in the schema cache"
      if (table && (code === 'PGRST205' || code === '42P01')) throw new CloudMissingTableError(table)
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
    }
    return (text ? JSON.parse(text) : null) as T
  } finally {
    clearTimeout(timer)
  }
}
