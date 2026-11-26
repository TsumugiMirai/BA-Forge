// Client for the China specialization setup: the `specs` table (six rows,
// ids 1–6) on the same server as the card library. Each row holds a
// specialization's name, icon (image data URL), description and assigned
// units. Schema: server/schema.sql; missing rows are created by ensureSpecs.

import { CloudConflictError, endpoint, headers, request } from './rest'

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
  /** bumped by a trigger on every update; used to detect concurrent edits */
  version: number
  updated_at: string
}

export type SpecInput = Pick<SpecRow, 'name' | 'icon' | 'description' | 'units'>

const TABLE = 'specs'

export const SPEC_COUNT = 6

/** names of the six preset specializations (the first two are the China
 *  Mod's existing ones) */
export const DEFAULT_SPEC_NAMES = ['重型合成旅', '空降军', '专精三', '专精四', '专精五', '专精六']

export function listSpecs(): Promise<SpecRow[]> {
  return request<SpecRow[]>(endpoint(TABLE, '?select=*&order=id.asc'), { headers: headers() }, TABLE)
}

/** Create whichever of the six preset rows are missing (never overwrites). */
export async function ensureSpecs(existing: SpecRow[]): Promise<SpecRow[]> {
  const have = new Set(existing.map((r) => r.id))
  const missing = DEFAULT_SPEC_NAMES.map((name, i) => ({ id: i + 1, name })).filter((r) => !have.has(r.id))
  if (missing.length === 0) return existing
  await request<unknown>(
    endpoint(TABLE, '?on_conflict=id'),
    {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify(missing),
    },
    TABLE,
  )
  return listSpecs()
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
