// Client for the shared online card library: the `cards` table of a Supabase
// project, reached through its PostgREST API with plain fetch (no SDK). The
// table is open to everyone who has the page — no accounts, by design.
// Schema and policies: docs/cloud-setup.sql.

import { CLOUD_KEY, CLOUD_URL } from './config'

/** a library entry without its (possibly large) card payload */
export interface CloudCardMeta {
  id: string
  name: string
  author: string
  unit_id: number | null
  /** bumped by a trigger on every update; used to detect concurrent edits */
  version: number
  updated_at: string
}

export interface CloudCardRow extends CloudCardMeta {
  /** the card in the exported-file format (see state/savedCards.ts) */
  data: unknown
  created_at: string
}

export interface CloudCardInput {
  name: string
  author: string
  unit_id: number | null
  data: unknown
}

/** someone else saved the card after it was loaded here */
export class CloudConflictError extends Error {
  constructor() {
    super('conflict')
  }
}

const META_COLUMNS = 'id,name,author,unit_id,version,updated_at'
const TIMEOUT_MS = 30000

function endpoint(query = ''): string {
  return `${CLOUD_URL.trim().replace(/\/+$/, '')}/rest/v1/cards${query}`
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = CLOUD_KEY.trim()
  const h: Record<string, string> = { apikey: key, 'Content-Type': 'application/json', ...extra }
  // Legacy anon keys are JWTs and also go in Authorization; the newer
  // publishable keys (sb_publishable_…) must only be sent as `apikey`.
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`
  return h
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const text = await res.text()
    if (!res.ok) {
      let detail = text
      try {
        const body = JSON.parse(text) as { message?: string; hint?: string }
        detail = [body.message, body.hint].filter(Boolean).join(' — ') || text
      } catch {
        // keep the raw text
      }
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
    }
    return (text ? JSON.parse(text) : null) as T
  } finally {
    clearTimeout(timer)
  }
}

export function listCloudCards(): Promise<CloudCardMeta[]> {
  return request<CloudCardMeta[]>(
    endpoint(`?select=${META_COLUMNS}&order=updated_at.desc&limit=2000`),
    { headers: headers() },
  )
}

export async function getCloudCard(id: string): Promise<CloudCardRow | null> {
  const rows = await request<CloudCardRow[]>(
    endpoint(`?id=eq.${encodeURIComponent(id)}&select=*`),
    { headers: headers() },
  )
  return rows[0] ?? null
}

export async function createCloudCard(input: CloudCardInput): Promise<CloudCardRow> {
  const rows = await request<CloudCardRow[]>(endpoint(), {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(input),
  })
  if (!rows[0]) throw new Error('empty response')
  return rows[0]
}

/** Update a card only if nobody saved it since `version` was loaded. */
export async function updateCloudCard(
  id: string,
  version: number,
  input: CloudCardInput,
): Promise<CloudCardRow> {
  const rows = await request<CloudCardRow[]>(
    endpoint(`?id=eq.${encodeURIComponent(id)}&version=eq.${version}`),
    {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(input),
    },
  )
  if (!rows[0]) throw new CloudConflictError()
  return rows[0]
}

export async function deleteCloudCard(id: string): Promise<void> {
  await request<null>(endpoint(`?id=eq.${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: headers(),
  })
}
