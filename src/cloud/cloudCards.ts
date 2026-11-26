// Client for the shared online card library: the `cards` table of a Supabase
// project, reached through its PostgREST API with plain fetch (no SDK). The
// table is open to everyone who has the page; the app only shows it after the
// simple login (src/auth). Schema and policies: docs/cloud-setup.sql.

import { CloudConflictError, endpoint, headers, request } from './rest'

export { CloudConflictError } from './rest'

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

const TABLE = 'cards'
const META_COLUMNS = 'id,name,author,unit_id,version,updated_at'

export function listCloudCards(): Promise<CloudCardMeta[]> {
  return request<CloudCardMeta[]>(
    endpoint(TABLE, `?select=${META_COLUMNS}&order=updated_at.desc&limit=2000`),
    { headers: headers() },
    TABLE,
  )
}

export async function getCloudCard(id: string): Promise<CloudCardRow | null> {
  const rows = await request<CloudCardRow[]>(
    endpoint(TABLE, `?id=eq.${encodeURIComponent(id)}&select=*`),
    { headers: headers() },
    TABLE,
  )
  return rows[0] ?? null
}

export async function createCloudCard(input: CloudCardInput): Promise<CloudCardRow> {
  const rows = await request<CloudCardRow[]>(
    endpoint(TABLE),
    {
      method: 'POST',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(input),
    },
    TABLE,
  )
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
    endpoint(TABLE, `?id=eq.${encodeURIComponent(id)}&version=eq.${version}`),
    {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(input),
    },
    TABLE,
  )
  if (!rows[0]) throw new CloudConflictError()
  return rows[0]
}

export async function deleteCloudCard(id: string): Promise<void> {
  await request<null>(
    endpoint(TABLE, `?id=eq.${encodeURIComponent(id)}`),
    { method: 'DELETE', headers: headers() },
    TABLE,
  )
}
