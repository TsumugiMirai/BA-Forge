import { useMemo, useState } from 'react'
import { useAppStore } from '../state/store'
import { flagUrl, thumbnailUrl } from '../assets'
import { UnitCategoryLocKey, UnitCategoryType } from '../data/enums'
import type { GameDb } from '../data/db'
import type { CountryRow } from '../data/types'
import { t } from './i18n'

/** Category tab that lists every category at once, grouped. */
const ALL_CATEGORIES = -1

/** Arsenal-style unit browser: nation and specialization filters, category
 *  tabs and a searchable thumbnail grid. */
export function UnitPicker() {
  const db = useAppStore((s) => s.db)
  const lang = useAppStore((s) => s.lang)
  const selectedUnitId = useAppStore((s) => s.selectedUnitId)
  const selectUnit = useAppStore((s) => s.selectUnit)
  const guardEdits = useAppStore((s) => s.guardEdits)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const [category, setCategory] = useState<number>(2) // Vehicles tab
  const [query, setQuery] = useState('')
  const [countryId, setCountryId] = useState<number | null>(null)
  const [specId, setSpecId] = useState<number | null>(null)

  // Units left after the nation/specialization filters; search and the
  // category tabs narrow this further.
  const pool = useMemo(() => {
    if (!db) return []
    return db
      .armoryUnits()
      .filter((u) => countryId == null || u.CountryId === countryId)
      .filter((u) => specId == null || (db.unitSpecs.get(u.Id)?.has(specId) ?? false))
  }, [db, countryId, specId])

  const units = useMemo(() => {
    if (!db) return []
    const q = query.trim().toLowerCase()
    return pool
      .filter((u) => (q || category === ALL_CATEGORIES ? true : u.CategoryType === category))
      .filter((u) => !q || db.unitSearchText(u.Id).includes(q))
      .sort(
        (a, b) =>
          (category === ALL_CATEGORIES && !q ? a.CategoryType - b.CategoryType : 0) ||
          (a.HUDName ?? '').localeCompare(b.HUDName ?? ''),
      )
  }, [db, pool, category, query])

  // Hide tabs with no armory units at all (e.g. Logistic in the current
  // data); the others show how many units the nation/spec filters leave.
  const categories = useMemo(() => {
    if (!db) return []
    const all = new Set(db.armoryUnits().map((u) => u.CategoryType))
    const counts = new Map<number, number>()
    for (const u of pool) counts.set(u.CategoryType, (counts.get(u.CategoryType) ?? 0) + 1)
    return Object.entries(UnitCategoryType)
      .filter(([id]) => all.has(Number(id)))
      .map(([id, label]) => ({ id: Number(id), label, count: counts.get(Number(id)) ?? 0 }))
  }, [db, pool])

  if (!db) return null

  const countries = db.armoryCountries()
  const specs = db.armorySpecs(countryId)
  const searching = query.trim() !== ''
  const categoryName = (id: number) =>
    db.locOr(UnitCategoryLocKey[id], UnitCategoryType[id] ?? String(id))

  const pickCountry = (id: number | null) => {
    setCountryId(id)
    // a specialization of another nation no longer applies
    if (specId != null && id != null && db.specializations.get(specId)?.CountryId !== id) setSpecId(null)
  }
  const pickSpec = (id: number | null) => {
    setSpecId(id)
    if (id != null) {
      // a specialization's roster reads best all at once, like its deck view
      setCategory(ALL_CATEGORIES)
      const spec = db.specializations.get(id)
      if (spec && countryId != null && spec.CountryId !== countryId) setCountryId(spec.CountryId)
    }
  }

  return (
    <div className="unit-picker">
      <input
        className="picker-search"
        placeholder={t(lang, 'searchUnits')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="picker-filters">
        <div className="picker-nations" role="group" aria-label={t(lang, 'nationFilter')}>
          <button
            className={countryId == null ? 'active' : ''}
            onClick={() => pickCountry(null)}
            title={t(lang, 'allNations')}
          >
            {t(lang, 'allNations')}
          </button>
          {countries.map((c) => (
            <button
              key={c.Id}
              className={countryId === c.Id ? 'active' : ''}
              onClick={() => pickCountry(c.Id)}
              title={countryName(db, c)}
            >
              <FlagIcon file={c.FlagFileName} />
              {countryName(db, c)}
            </button>
          ))}
        </div>
        <select
          className={`picker-spec ${specId != null ? 'active' : ''}`}
          aria-label={t(lang, 'specFilter')}
          value={specId ?? ''}
          onChange={(e) => pickSpec(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">{t(lang, 'allSpecs')}</option>
          {countryId != null
            ? specs.map((s) => (
                <option key={s.Id} value={s.Id}>
                  {db.locOr(s.UIName, s.Name ?? String(s.Id))}
                </option>
              ))
            : countries.map((c) => (
                <optgroup key={c.Id} label={countryName(db, c)}>
                  {specs
                    .filter((s) => s.CountryId === c.Id)
                    .map((s) => (
                      <option key={s.Id} value={s.Id}>
                        {db.locOr(s.UIName, s.Name ?? String(s.Id))}
                      </option>
                    ))}
                </optgroup>
              ))}
        </select>
      </div>
      <div className="picker-tabs">
        <button
          className={category === ALL_CATEGORIES && !searching ? 'active' : ''}
          onClick={() => {
            setCategory(ALL_CATEGORIES)
            setQuery('')
          }}
        >
          {t(lang, 'allCategories')} <span className="picker-count">{pool.length}</span>
        </button>
        {categories.map(({ id, count }) => (
          <button
            key={id}
            className={`${id === category && !searching ? 'active' : ''} ${count === 0 ? 'empty' : ''}`}
            onClick={() => {
              setCategory(id)
              setQuery('')
            }}
          >
            {categoryName(id)} <span className="picker-count">{count}</span>
          </button>
        ))}
      </div>
      <div className="picker-grid">
        {units.length === 0 && <div className="picker-empty">{t(lang, 'noUnits')}</div>}
        {units.map((u, i) => {
          // section headings when every category is listed at once
          const heading =
            category === ALL_CATEGORIES && !searching && units[i - 1]?.CategoryType !== u.CategoryType
          return [
            heading && (
              <div key={`h${u.CategoryType}`} className="picker-group-label">
                {categoryName(u.CategoryType)}
              </div>
            ),
            <button
              key={u.Id}
              className={`picker-item ${u.Id === selectedUnitId ? 'active' : ''}`}
              onClick={() =>
                guardEdits(() => {
                  selectUnit(u.Id)
                  // from the China setup page, picking a unit opens its card
                  if (view === 'china') setView('card')
                })
              }
              title={u.HUDName ?? undefined}
            >
              <UnitThumb file={u.ThumbnailFileName} name={u.HUDName ?? u.Name ?? ''} />
              <span className="picker-item-name">{u.HUDName ?? u.Name}</span>
            </button>,
          ]
        })}
      </div>
    </div>
  )
}

/** In-game nation name ("nation_russia" → 俄罗斯), falling back to the row. */
function countryName(db: GameDb, c: CountryRow): string {
  return db.locOr(`nation_${c.Name.toLowerCase()}`, c.UIName || c.Name)
}

function FlagIcon({ file }: { file: string | null }) {
  const [failed, setFailed] = useState(false)
  const url = flagUrl(file)
  if (!url || failed) return null
  return <img className="picker-flag" src={url} alt="" onError={() => setFailed(true)} />
}

function UnitThumb({ file, name }: { file: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  const url = thumbnailUrl(file)
  if (!url || failed) return <span className="picker-thumb placeholder">{name.slice(0, 2)}</span>
  return <img className="picker-thumb" src={url} alt={name} onError={() => setFailed(true)} />
}
