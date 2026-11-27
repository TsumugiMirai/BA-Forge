import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { useAppStore } from '../state/store'
import { flagUrl, thumbnailUrl } from '../assets'
import { UnitCategoryLocKey, UnitCategoryType } from '../data/enums'
import type { GameDb } from '../data/db'
import type { VariantSelection } from '../data/resolve'
import { resolveCard } from '../data/resolve'
import { gameModSlots } from '../data/gameMods'
import type { UnitRow } from '../data/types'
import { UnitCard } from '../card/UnitCard'
import { CardView } from '../card/cardContext'
import { ScaledCard } from '../ui/ScaledCard'
import { ModificationsPanel } from '../ui/ModificationsPanel'
import { t } from '../ui/i18n'
import { normalizeSearch } from './search'
import './armory.css'

/** what the arsenal page shows; kept while visiting other pages */
interface ArmoryState {
  unitId: number | null
  selection: VariantSelection
  countryId: number | null
  specId: number | null
  query: string
  compact: boolean
  set(patch: Partial<Omit<ArmoryState, 'set'>>): void
}

const useArmory = create<ArmoryState>((set) => ({
  unitId: null,
  selection: {},
  countryId: null,
  specId: null,
  query: '',
  compact: true,
  set: (patch) => set(patch),
}))

/** arsenal categories in game order (Logistic has no units) */
const CATEGORIES = [0, 1, 2, 3, 5, 6]


const searchCache = new WeakMap<GameDb, Map<number, string>>()

/** every name a unit goes by (variants too), normalized, one per line */
function searchText(db: GameDb, id: number): string {
  let map = searchCache.get(db)
  if (!map) searchCache.set(db, (map = new Map()))
  let text = map.get(id)
  if (text == null) {
    text = db
      .unitSearchText(id)
      .split('\n')
      .map(normalizeSearch)
      .join('\n')
    map.set(id, text)
  }
  return text
}

/** the whole query (spaces and dashes ignored: "su 34" = "Su-34") is part
 *  of one of the unit's names */
function matchesWhole(db: GameDb, id: number, query: string): boolean {
  const q = normalizeSearch(query)
  return !q || searchText(db, id).includes(q)
}

/** every word of the query is part of the unit's names */
function matchesWords(db: GameDb, id: number, query: string): boolean {
  const words = query.split(/\s+/).map(normalizeSearch).filter(Boolean)
  const text = searchText(db, id)
  return words.every((w) => text.includes(w))
}

function categoryName(db: GameDb, cat: number): string {
  return db.locOr(UnitCategoryLocKey[cat], UnitCategoryType[cat] ?? String(cat))
}

/**
 * The arsenal (原版单位): the game's units as in its arsenal screen — nations
 * and their specializations along the top, a search box, categories down the
 * left and the units as silhouettes with their cost. Clicking one shows its
 * card on the right with its modification slots; Edit takes it to the card
 * maker.
 */
export function ArmoryPage() {
  const db = useAppStore((s) => s.db)
  const lang = useAppStore((s) => s.lang)
  const a = useArmory()
  const gridRef = useRef<HTMLDivElement>(null)
  const [activeCat, setActiveCat] = useState<number>(CATEGORIES[0]!)

  const units = useMemo(() => {
    if (!db) return []
    let whole: Set<number> | null = null
    const wholeHits = (all: UnitRow[]) =>
      (whole ??= new Set(all.filter((u) => matchesWhole(db, u.Id, a.query)).map((u) => u.Id)))
    return db
      .armoryUnits()
      .filter((u) => a.countryId == null || u.CountryId === a.countryId)
      .filter((u) => a.specId == null || (db.unitSpecs.get(u.Id)?.has(a.specId) ?? false))
      .filter((u, _, all) => {
        if (!a.query.trim()) return true
        // the query as a whole first; only when nothing matches that, any
        // unit whose names contain all its words ("vdv kornet")
        return wholeHits(all).size > 0 ? wholeHits(all).has(u.Id) : matchesWords(db, u.Id, a.query)
      })
      .sort(
        (x, y) =>
          CATEGORIES.indexOf(x.CategoryType) - CATEGORIES.indexOf(y.CategoryType) ||
          (x.HUDName ?? '').localeCompare(y.HUDName ?? '', 'en', { numeric: true }),
      )
  }, [db, a.countryId, a.specId, a.query])

  const groups = useMemo(() => {
    const map = new Map<number, UnitRow[]>()
    for (const u of units) {
      const list = map.get(u.CategoryType)
      if (list) list.push(u)
      else map.set(u.CategoryType, [u])
    }
    return CATEGORIES.filter((c) => map.has(c)).map((c) => ({ cat: c, units: map.get(c)! }))
  }, [units])

  // the category nav follows the scroll position
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const onScroll = () => {
      const top = grid.getBoundingClientRect().top
      let current = groups[0]?.cat
      for (const g of groups) {
        const el = grid.querySelector<HTMLElement>(`[data-cat="${g.cat}"]`)
        if (el && el.getBoundingClientRect().top - top <= 40) current = g.cat
      }
      if (current != null) setActiveCat(current)
    }
    onScroll()
    grid.addEventListener('scroll', onScroll, { passive: true })
    return () => grid.removeEventListener('scroll', onScroll)
  }, [groups])

  if (!db) return null

  const countries = db.armoryCountries()
  const scrollTo = (cat: number) => {
    const grid = gridRef.current
    const el = grid?.querySelector<HTMLElement>(`[data-cat="${cat}"]`)
    if (grid && el) grid.scrollTo({ top: el.offsetTop - grid.offsetTop, behavior: 'smooth' })
  }

  return (
    <div className="armory-page">
      <section className="armory-main">
        <div className="armory-filters">
          <button
            className={`armory-all ${a.countryId == null && a.specId == null ? 'active' : ''}`}
            onClick={() => a.set({ countryId: null, specId: null })}
          >
            {t(lang, 'allNations')}
          </button>
          {countries.map((c) => (
            <div key={c.Id} className="armory-nation">
              <button
                className={`armory-flag ${a.countryId === c.Id && a.specId == null ? 'active' : ''}`}
                title={db.locOr(`nation_${c.Name.toLowerCase()}`, c.UIName || c.Name)}
                onClick={() => a.set({ countryId: c.Id, specId: null })}
              >
                {flagUrl(c.FlagFileName) ? (
                  <img src={flagUrl(c.FlagFileName)!} alt="" />
                ) : (
                  db.locOr(`nation_${c.Name.toLowerCase()}`, c.UIName || c.Name)
                )}
              </button>
              {db.armorySpecs(c.Id).map((s) => (
                <button
                  key={s.Id}
                  className={`armory-spec ${a.specId === s.Id ? 'active' : ''}`}
                  onClick={() => a.set({ countryId: c.Id, specId: a.specId === s.Id ? null : s.Id })}
                >
                  {db.locOr(s.UIName, s.Name ?? String(s.Id))}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="armory-search">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              fill="currentColor"
              d="M6.5 1a5.5 5.5 0 0 1 4.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 1 1 6.5 1Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
            />
          </svg>
          <input
            placeholder={t(lang, 'searchUnits')}
            value={a.query}
            onChange={(e) => a.set({ query: e.target.value })}
          />
          {a.query && (
            <button className="armory-search-clear" title={t(lang, 'clear')} onClick={() => a.set({ query: '' })}>
              ×
            </button>
          )}
          <span className="armory-count">{units.length}</span>
        </div>

        <div className="armory-body">
          <nav className="armory-cats">
            {CATEGORIES.map((c) => {
              const has = groups.some((g) => g.cat === c)
              return (
                <button
                  key={c}
                  className={`${activeCat === c && has ? 'active' : ''} ${has ? '' : 'empty'}`}
                  disabled={!has}
                  onClick={() => scrollTo(c)}
                >
                  {categoryName(db, c)}
                </button>
              )
            })}
          </nav>
          <div className="armory-grid" ref={gridRef}>
            {groups.length === 0 && <div className="armory-empty">{t(lang, 'noUnits')}</div>}
            {groups.map((g) => (
              <div key={g.cat} className="armory-group" data-cat={g.cat}>
                <div className="armory-group-label">{categoryName(db, g.cat)}</div>
                <div className="armory-tiles">
                  {g.units.map((u) => (
                    <button
                      key={u.Id}
                      className={`armory-tile ${u.Id === a.unitId ? 'active' : ''}`}
                      onClick={() => a.set({ unitId: u.Id, selection: {} })}
                    >
                      <span className="armory-tile-cost">{u.Cost}</span>
                      <Thumb file={u.ThumbnailFileName} />
                      <span className="armory-tile-name">{u.HUDName ?? u.Name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="armory-side">
        {a.unitId != null && db.units.has(a.unitId) ? (
          <ArmoryCard unitId={a.unitId} />
        ) : (
          <div className="armory-side-empty">{t(lang, 'pickUnitHint')}</div>
        )}
      </aside>
    </div>
  )
}

function ArmoryCard({ unitId }: { unitId: number }) {
  const db = useAppStore((s) => s.db)!
  const lang = useAppStore((s) => s.lang)
  const openInMaker = useAppStore((s) => s.openInMaker)
  const { selection, compact, set } = useArmory()
  const card = useMemo(() => resolveCard(db, unitId, selection), [db, unitId, selection])
  const slots = useMemo(() => gameModSlots(db, unitId, selection), [db, unitId, selection])

  return (
    <div className="armory-card">
      <div className="armory-card-bar">
        <div className="seg">
          <button className={compact ? 'active' : ''} onClick={() => set({ compact: true })}>
            {t(lang, 'compact')}
          </button>
          <button className={!compact ? 'active' : ''} onClick={() => set({ compact: false })}>
            {t(lang, 'expanded')}
          </button>
        </div>
        <span className="armory-card-spacer" />
        <button className="primary" onClick={() => openInMaker(unitId, selection)}>
          {t(lang, 'edit')}
        </button>
      </div>
      <div className="armory-card-scroll">
        <ScaledCard zoom="width" max={1.25}>
          <CardView value={{ readOnly: true, compact, colors: card.textColors ?? {} }}>
            <UnitCard card={card} />
          </CardView>
        </ScaledCard>
        <ModificationsPanel
          className="armory-mods"
          slots={slots}
          onSelect={(slot, option) => set({ selection: { ...selection, [Number(slot)]: Number(option) } })}
        />
      </div>
    </div>
  )
}

function Thumb({ file }: { file: string | null }) {
  const [failed, setFailed] = useState(false)
  const url = thumbnailUrl(file)
  if (!url || failed) return <span className="armory-tile-img placeholder" />
  return <img className="armory-tile-img" src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
}
