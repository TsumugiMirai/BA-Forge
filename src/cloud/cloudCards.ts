// Client for the shared online card library: the `cards` table on the
// project's server, reached through its PostgREST API with plain fetch. Only
// logged-in requests (src/auth) may read or change it. Who created and who
// last saved a card is filled in by the server from the login. Schema:
// server/schema.sql.

import { CloudConflictError, CloudHttpError, endpoint, headers, request } from './rest'

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
  /** the card's cost and custom arsenal icon, read out of `data` for lists
   *  (absent when the server could not provide them) */
  cost?: string | null
  icon?: string | null
  /** the card's own arsenal category (JSON text of a number) */
  category?: string | number | null
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
const BASE_COLUMNS = 'id,name,author,editor,created_by,updated_by,unit_id,version,created_at,updated_at'
/** plus the card's cost and custom icon from inside the card JSON */
const META_COLUMNS = `${BASE_COLUMNS},cost:data->card->>cost,icon:data->card->>icon,category:data->card->>category`

export async function listCloudCards(): Promise<CloudCardMeta[]> {
  const list = (columns: string) =>
    request<CloudCardMeta[]>(endpoint(TABLE, `?select=${columns}&order=updated_at.desc&limit=2000`), { headers: headers() }, TABLE)
  try {
    return await list(META_COLUMNS)
  } catch (e) {
    // a server that cannot read inside the JSON still lists the cards
    if (e instanceof CloudHttpError && e.status === 400) return list(BASE_COLUMNS)
    throw e
  }
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
    endpoint(TABLE, `?select=${BASE_COLUMNS}`),
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
    endpoint(TABLE, `?id=eq.${encodeURIComponent(id)}&version=eq.${version}&select=${BASE_COLUMNS}`),
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

/** the arsenal category a library card is listed under: its own, else its
 *  game unit's; null when neither is known */
export function cardCategory(meta: Pick<CloudCardMeta, 'category'>, unitCategory: number | undefined): number | null {
  const own = meta.category == null || meta.category === '' ? NaN : Number(meta.category)
  if (Number.isInteger(own)) return own
  return unitCategory ?? null
}
