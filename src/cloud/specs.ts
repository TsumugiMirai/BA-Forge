// Client for the custom specializations: the `specs` table on the same
// server as the card library (ids 1–6 are the China Mod's; new ones get the
// next id). Each row holds a specialization's name, nation/side, icon (image
// data URL), description, points per category and assigned units. Schema:
// server/schema.sql.

import { CloudConflictError, endpoint, headers, request, rpc } from './rest'

/** a unit assigned to a specialization: an online library card (custom
 *  unit) or a stock game unit */
export type SpecUnitRef = { source: 'card'; id: string } | { source: 'unit'; id: number }

export interface SpecRow {
  id: number
  name: string
  /** image data URL; null shows the default badge */
  icon: string | null
  description: string
  units: SpecUnitRef[]
  /** points per arsenal category, keyed by UnitCategoryType id ("0" recon …
   *  "6" aircraft), like the game's Specializations.ReconPoints etc. */
  points?: SpecPoints
  /** bumped by a trigger on every update; used to detect concurrent edits */
  version: number
  updated_at: string
  /** display name of whoever saved it last (set by the server) */
  editor?: string
  /** nation or side, e.g. "中国"; specializations are listed by it */
  faction?: string
  /** place in the list (smaller first, then by id) */
  sort?: number
  /** account that added it (set by the server; null for the first six) */
  created_by?: string | null
}

export type SpecPoints = Record<string, number>

export type SpecInput = Pick<SpecRow, 'name' | 'icon' | 'description' | 'units'> & {
  points: SpecPoints
  faction: string
}

const TABLE = 'specs'

export function listSpecs(): Promise<SpecRow[]> {
  return request<SpecRow[]>(endpoint(TABLE, '?select=*&order=sort.asc,id.asc'), { headers: headers() }, TABLE)
}

/** Add a specialization; the server picks its id. */
export async function createSpec(input: SpecInput): Promise<SpecRow> {
  const rows = await request<SpecRow[]>(
    endpoint(TABLE, ''),
    { method: 'POST', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(input) },
    TABLE,
  )
  if (!rows[0]) throw new Error('empty response')
  return rows[0]
}

/** Delete a specialization (its creator or an admin only: 403 "not_owner"). */
export async function deleteSpec(id: number): Promise<void> {
  await request<null>(endpoint(TABLE, `?id=eq.${id}`), { method: 'DELETE', headers: headers() }, TABLE)
}

/** Save a specialization only if nobody saved it since `version` was loaded. */
export async function saveSpec(id: number, version: number, input: SpecInput): Promise<SpecRow> {
  const rows = await request<SpecRow[]>(
    endpoint(TABLE, `?id=eq.${id}&version=eq.${version}`),
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

/** Put an online card into exactly these specializations (none = []); the
 *  server changes the rows in one go, so nothing else edited is lost. */
export async function setCardSpecs(cardId: string, specIds: number[]): Promise<void> {
  await rpc<unknown>('set_card_specs', { card_id: cardId, spec_ids: specIds })
}

export const isCardRef = (ref: SpecUnitRef, cardId: string) =>
  ref.source === 'card' && ref.id.toLowerCase() === cardId.toLowerCase()

/** the specializations an online card is in, by card id */
export function specsByCard(specs: SpecRow[] | null): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const spec of specs ?? [])
    for (const ref of spec.units ?? [])
      if (ref.source === 'card') {
        const key = ref.id.toLowerCase()
        const list = map.get(key)
        if (list) {
          if (!list.includes(spec.id)) list.push(spec.id)
        } else map.set(key, [spec.id])
      }
  return map
}
