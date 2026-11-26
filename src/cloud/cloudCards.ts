// Client for the shared online card library: the `cards` table on the
// project's server, reached through its PostgREST API with plain fetch. Only
// logged-in requests (src/auth) may read or change it. Who created and who
// last saved a card is filled in by the server from the login. Schema:
// server/schema.sql.

import { CloudConflictError, endpoint, headers, request } from './rest'

export { CloudConflictError } from './rest'

/** a library entry without its (possibly large) card payload */
export interface CloudCardMeta {
  id: string
  name: string
  /** display name of whoever created it (older cards: the nickname typed then) */
  author: string
  /** display name of whoever saved it last ('' on cards from before accounts) */
  editor: string
  /** account names behind author/editor (null on cards from before accounts) */
  created_by: string | null
  updated_by: string | null
  unit_id: number | null
  /** bumped by a trigger on every update; used to detect concurrent edits */
  version: number
  created_at: string
  updated_at: string
}

export interface CloudCardRow extends CloudCardMeta {
  /** the card in the exported-file format (see state/savedCards.ts) */
  data: unknown
}

export interface CloudCardInput {
  name: string
  unit_id: number | null
  data: unknown
}

const TABLE = 'cards'
const META_COLUMNS = 'id,name,author,editor,created_by,updated_by,unit_id,version,created_at,updated_at'

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
    endpoint(TABLE, `?select=${META_COLUMNS}`),
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
): Promise<CloudCardMeta> {
  const rows = await request<CloudCardMeta[]>(
    endpoint(TABLE, `?id=eq.${encodeURIComponent(id)}&version=eq.${version}&select=${META_COLUMNS}`),
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

/** Delete a card (the server allows it to its creator and to admins). */
export async function deleteCloudCard(id: string): Promise<void> {
  await request<null>(
    endpoint(TABLE, `?id=eq.${encodeURIComponent(id)}`),
    { method: 'DELETE', headers: headers() },
    TABLE,
  )
}
