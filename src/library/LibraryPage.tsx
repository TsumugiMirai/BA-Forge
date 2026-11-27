import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { thumbnailUrl } from '../assets'
import type { GameDb } from '../data/db'
import { UnitCategoryLocKey, UnitCategoryType } from '../data/enums'
import type { CloudCardMeta } from '../cloud/cloudCards'
import { cardCategory } from '../cloud/cloudCards'
import { cloudEnabled } from '../cloud/config'
import type { SpecRow } from '../cloud/specs'
import { specsByCard } from '../cloud/specs'
import { parseSavedCardFile } from '../state/savedCards'
import type { SavedCard } from '../state/savedCards'
import { exportSavedCardJson } from '../export/exportJson'
import { AuthGate } from '../auth/AuthForm'
import { SpecBadge, SpecChips } from '../ui/SpecChips'
import { t } from '../ui/i18n'
import './library.css'

type Tab = 'online' | 'local'
/** 'all', a specialization id, or the cards in none */
type SpecFilter = 'all' | 'none' | number
/** the game's arsenal order (category, then name), or newest first */
type Sort = 'game' | 'updated'

const TAB_KEY = 'ba-recard.libraryTab'

function initialTab(): Tab {
  try {
    if (localStorage.getItem(TAB_KEY) === 'local') return 'local'
  } catch {
    // fall through
  }
  return 'online'
}

/** the game unit a card is built on: its name, category and arsenal picture */
function unitInfo(db: GameDb, unitId: number | null) {
  const unit = unitId != null ? db.units.get(unitId) : undefined
  return {
    unitName: unit?.HUDName ?? unit?.Name ?? '',
    category: unit?.CategoryType ?? OTHER,
    thumb: thumbnailUrl(unit?.ThumbnailFileName ?? null),
  }
}

/** arsenal categories in the game's order: recon first, aircraft last */
const CATEGORY_ORDER = [0, 1, 2, 3, 4, 5, 6]
/** cards whose game unit is unknown go last */
const OTHER = 99

interface Group<T> {
  /** category id, or null for one ungrouped list */
  category: number | null
  items: T[]
}

/** Lay cards out like the game's arsenal (by category, then by name, with a
 *  heading per category), or newest first in one list. */
function arrange<T>(
  db: GameDb,
  items: T[],
  sort: Sort,
  key: (item: T) => { unitId: number | null; name: string; time: number; category?: number | null },
): Group<T>[] {
  if (sort === 'updated') return [{ category: null, items: [...items].sort((a, b) => key(b).time - key(a).time) }]
  const groups = new Map<number, T[]>()
  for (const item of items) {
    const k0 = key(item)
    const cat = k0.category ?? unitInfo(db, k0.unitId).category
    const k = CATEGORY_ORDER.includes(cat) ? cat : OTHER
    const list = groups.get(k)
    if (list) list.push(item)
    else groups.set(k, [item])
  }
  return [...CATEGORY_ORDER, OTHER]
    .filter((cat) => groups.has(cat))
    .map((cat) => ({
      category: cat,
      items: groups.get(cat)!.sort((a, b) => key(a).name.localeCompare(key(b).name, 'zh-Hans-CN', { numeric: true })),
    }))
}

function GroupHeading({ db, category, count }: { db: GameDb; category: number | null; count: number }) {
  const lang = useAppStore((s) => s.lang)
  if (category == null) return null
  const name =
    category === OTHER ? t(lang, 'categoryOther') : db.locOr(UnitCategoryLocKey[category], UnitCategoryType[category] ?? '')
  return (
    <div className="library-group">
      {name} <span>{count}</span>
    </div>
  )
}

/**
 * The card library page (#library): the shared online library (needs a
 * login), filtered by China specialization, and the cards saved in this
 * browser. Opening a card takes it to the card maker.
 */
export function LibraryPage() {
  const lang = useAppStore((s) => s.lang)
  const authed = useAppStore((s) => s.authed)
  const cloudCards = useAppStore((s) => s.cloudCards)
  const savedCards = useAppStore((s) => s.savedCards)
  const [tab, setTabState] = useState<Tab>(() => initialTab())
  const setTab = (next: Tab) => {
    setTabState(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // not remembered
    }
  }
  // cards are kept online now; cards an older version saved in this browser
  // stay reachable (to upload or export) until they are all gone
  const hasLocal = savedCards.length > 0
  const shownTab = hasLocal && (tab === 'local' || !cloudEnabled()) ? 'local' : 'online'

  return (
    <div className="library-page">
      {hasLocal && (
        <div className="library-head">
          <div className="library-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={shownTab === 'online'}
              className={shownTab === 'online' ? 'active' : ''}
              onClick={() => setTab('online')}
            >
              {t(lang, 'cloudTitle')}
              {authed && <span className="library-tab-count">{cloudCards.length}</span>}
            </button>
            <button
              role="tab"
              aria-selected={shownTab === 'local'}
              className={shownTab === 'local' ? 'active' : ''}
              onClick={() => setTab('local')}
            >
              {t(lang, 'libraryLocal')}
              <span className="library-tab-count">{savedCards.length}</span>
            </button>
          </div>
        </div>
      )}
      {shownTab === 'online' ? (
        authed ? (
          <OnlineLibrary />
        ) : (
          <AuthGate reason="authGateLibrary" />
        )
      ) : (
        <LocalLibrary />
      )}
    </div>
  )
}

function Notice() {
  const lang = useAppStore((s) => s.lang)
  const notice = useAppStore((s) => s.cloudNotice)
  if (!notice) return null
  return (
    <div className={`library-notice ${notice.kind === 'error' ? 'saved-error' : 'cloud-ok'}`}>
      {t(lang, notice.key)}
      {notice.detail ? `: ${notice.detail}` : ''}
    </div>
  )
}

function OnlineLibrary() {
  const lang = useAppStore((s) => s.lang)
  const db = useAppStore((s) => s.db)
  const account = useAppStore((s) => s.account)
  const cloudCards = useAppStore((s) => s.cloudCards)
  const cloudListing = useAppStore((s) => s.cloudListing)
  const cloudBusy = useAppStore((s) => s.cloudBusy)
  const cloudLinked = useAppStore((s) => s.cloudLinked)
  const specs = useAppStore((s) => s.specs)
  const specsNotice = useAppStore((s) => s.specsNotice)
  const refreshCloud = useAppStore((s) => s.refreshCloud)
  const refreshSpecs = useAppStore((s) => s.refreshSpecs)
  const loadCloudCard = useAppStore((s) => s.loadCloudCard)
  const removeCloudCard = useAppStore((s) => s.removeCloudCard)
  const guardEdits = useAppStore((s) => s.guardEdits)
  const setView = useAppStore((s) => s.setView)
  const [query, setQuery] = useState('')
  const [specFilter, setSpecFilter] = useState<SpecFilter>('all')
  const [mine, setMine] = useState(false)
  const [sort, setSort] = useState<Sort>('game')
  const uploadCardFile = useAppStore((s) => s.uploadCardFile)
  const exportCloudCard = useAppStore((s) => s.exportCloudCard)
  const importInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshCloud()
    void refreshSpecs()
  }, [refreshCloud, refreshSpecs])

  const bySpec = useMemo(() => specsByCard(specs), [specs])
  const specsOf = (c: CloudCardMeta) => bySpec.get(c.id.toLowerCase()) ?? []

  // search and "mine" narrow the pool; the spec chips show counts within it
  const pool = useMemo(() => {
    if (!db) return []
    const q = query.trim().toLowerCase()
    return cloudCards.filter((c) => {
      if (mine && c.created_by !== account?.username) return false
      if (!q) return true
      const { unitName } = unitInfo(db, c.unit_id)
      return `${c.name}\n${c.author}\n${c.editor}\n${unitName}`.toLowerCase().includes(q)
    })
  }, [db, cloudCards, query, mine, account])

  const counts = useMemo(() => {
    const m = new Map<SpecFilter, number>([['all', pool.length], ['none', 0]])
    for (const c of pool) {
      const ids = bySpec.get(c.id.toLowerCase()) ?? []
      if (ids.length === 0) m.set('none', (m.get('none') ?? 0) + 1)
      for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1)
    }
    return m
  }, [pool, bySpec])

  const shown = useMemo(
    () =>
      pool.filter((c) => {
        if (specFilter === 'all') return true
        const ids = bySpec.get(c.id.toLowerCase()) ?? []
        return specFilter === 'none' ? ids.length === 0 : ids.includes(specFilter)
      }),
    [pool, specFilter, bySpec],
  )
  const groups = useMemo(
    () =>
      db
        ? arrange(db, shown, sort, (c) => ({
            unitId: c.unit_id,
            name: c.name,
            time: Date.parse(c.updated_at),
            category: cardCategory(c, c.unit_id != null ? db.units.get(c.unit_id)?.CategoryType : undefined),
          }))
        : [],
    [db, shown, sort],
  )

  if (!db) return null

  const open = (id: string) =>
    guardEdits(() => {
      void loadCloudCard(id).then((ok) => ok && setView('card'))
    })
  const canDelete = (c: CloudCardMeta) =>
    account?.role === 'admin' || (!!c.created_by && c.created_by === account?.username)

  return (
    <div className="library-body">
      <div className="library-toolbar">
        <input
          className="picker-search library-search"
          placeholder={t(lang, 'libraryFilter')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="library-check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          {t(lang, 'filterMine')}
        </label>
        <SortSelect sort={sort} onChange={setSort} />
        <span className="library-spacer" />
        <span className="library-count">
          {shown.length} {t(lang, 'cardsUnit')}
        </span>
        <button className="library-button" disabled={cloudBusy} onClick={() => importInput.current?.click()}>
          {t(lang, 'importJson')}
        </button>
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            for (const f of files) {
              const entry = parseSavedCardFile(await f.text())
              if (entry) await uploadCardFile(entry)
              else window.alert(`${t(lang, 'importFailed')}\n${f.name}`)
            }
          }}
        />
        <button
          className="library-button"
          disabled={cloudListing}
          onClick={() => {
            void refreshCloud()
            void refreshSpecs()
          }}
        >
          {cloudListing ? t(lang, 'cloudLoading') : t(lang, 'refresh')}
        </button>
      </div>

      <div className="library-specs" role="group" aria-label={t(lang, 'cardSpecsTitle')}>
        <SpecFilterChip active={specFilter === 'all'} count={counts.get('all') ?? 0} onClick={() => setSpecFilter('all')}>
          {t(lang, 'filterAll')}
        </SpecFilterChip>
        {specs?.map((s) => (
          <SpecFilterChip
            key={s.id}
            active={specFilter === s.id}
            count={counts.get(s.id) ?? 0}
            title={s.description || s.name}
            onClick={() => setSpecFilter(s.id)}
          >
            <SpecBadge spec={s} />
            {s.name || `#${s.id}`}
          </SpecFilterChip>
        ))}
        <SpecFilterChip active={specFilter === 'none'} count={counts.get('none') ?? 0} onClick={() => setSpecFilter('none')}>
          {t(lang, 'filterUnassigned')}
        </SpecFilterChip>
      </div>
      {specsNotice && (
        <div className="saved-error">
          {t(lang, specsNotice.key)}
          {specsNotice.detail ? `: ${specsNotice.detail}` : ''}
        </div>
      )}
      <Notice />

      {cloudListing && cloudCards.length === 0 && <div className="saved-hint">{t(lang, 'cloudLoading')}</div>}
      {!cloudListing && cloudCards.length === 0 && <div className="saved-hint">{t(lang, 'cloudEmpty')}</div>}
      {cloudCards.length > 0 && shown.length === 0 && <div className="saved-hint">{t(lang, 'libraryNoMatch')}</div>}

      {groups.map((g) => (
        <div key={g.category ?? 'all'} className="library-section">
          <GroupHeading db={db} category={g.category} count={g.items.length} />
          <div className="library-grid">
            {g.items.map((c) => (
              <OnlineTile
                key={c.id}
                card={c}
                db={db}
                specs={specs}
                specIds={specsOf(c)}
                linked={cloudLinked?.id === c.id}
                busy={cloudBusy}
                canDelete={canDelete(c)}
                onOpen={() => open(c.id)}
                onExport={() => void exportCloudCard(c.id)}
                onDelete={() => {
                  if (window.confirm(`${t(lang, 'cloudDeleteConfirm')}\n${c.name}`)) void removeCloudCard(c.id)
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SortSelect({ sort, onChange }: { sort: Sort; onChange(next: Sort): void }) {
  const lang = useAppStore((s) => s.lang)
  return (
    <select className="library-sort" aria-label={t(lang, 'sortLabel')} value={sort} onChange={(e) => onChange(e.target.value as Sort)}>
      <option value="game">{t(lang, 'sortGame')}</option>
      <option value="updated">{t(lang, 'sortUpdated')}</option>
    </select>
  )
}

function SpecFilterChip(props: {
  active: boolean
  count: number
  title?: string
  onClick(): void
  children: ReactNode
}) {
  return (
    <button
      className={`library-spec-filter ${props.active ? 'active' : ''} ${props.count === 0 ? 'empty' : ''}`}
      aria-pressed={props.active}
      title={props.title}
      onClick={props.onClick}
    >
      {props.children}
      <span className="library-spec-count">{props.count}</span>
    </button>
  )
}

function OnlineTile(props: {
  card: CloudCardMeta
  db: GameDb
  specs: SpecRow[] | null
  specIds: number[]
  linked: boolean
  busy: boolean
  canDelete: boolean
  onOpen(): void
  onExport(): void
  onDelete(): void
}) {
  const { card: c, db, specs, specIds } = props
  const lang = useAppStore((s) => s.lang)
  const specBusy = useAppStore((s) => s.specBusy)
  const setCardSpecs = useAppStore((s) => s.setCardSpecs)
  const [picking, setPicking] = useState(false)
  const pickRef = useRef<HTMLDivElement>(null)
  const thumb = c.icon || unitInfo(db, c.unit_id).thumb
  const mySpecs = (specs ?? []).filter((s) => specIds.includes(s.id))

  useEffect(() => {
    if (!picking) return
    const close = (e: MouseEvent) => {
      if (!pickRef.current?.contains(e.target as Node)) setPicking(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [picking])

  return (
    <div className={`library-tile ${props.linked ? 'linked' : ''}`}>
      <button className="library-tile-main" title={t(lang, 'openCard')} disabled={props.busy} onClick={props.onOpen}>
        <span className="library-thumb">
          {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="library-thumb-empty" />}
        </span>
        <span className="library-tile-name">{c.name}</span>
      </button>
      {mySpecs.length > 0 && (
        <div className="library-tile-specs">
          {mySpecs.map((s) => (
            <span key={s.id} className="library-spec-tag" title={s.name}>
              <SpecBadge spec={s} size={14} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div className="library-tile-foot">
        <span className="library-tile-meta" title={c.editor && c.editor !== c.author ? `${t(lang, 'lastSavedBy')} ${c.editor}` : undefined}>
          {c.author || '—'} · {new Date(c.updated_at).toLocaleDateString()}
        </span>
        <div className="library-tile-actions" ref={pickRef}>
          {specs && (
            <button className="library-icon-button" title={t(lang, 'assignSpecs')} onClick={() => setPicking(!picking)}>
              {t(lang, 'assignSpecs')}
            </button>
          )}
          <button className="library-icon-button" title={t(lang, 'exportJson')} onClick={props.onExport}>
            ⤓
          </button>
          {props.canDelete && (
            <button className="library-icon-button danger" title={t(lang, 'delete')} disabled={props.busy} onClick={props.onDelete}>
              ×
            </button>
          )}
          {picking && specs && (
            <div className="library-spec-pop">
              <SpecChips
                specs={specs}
                selected={specIds}
                disabled={specBusy}
                onToggle={(id) =>
                  void setCardSpecs(c.id, specIds.includes(id) ? specIds.filter((x) => x !== id) : [...specIds, id])
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LocalLibrary() {
  const lang = useAppStore((s) => s.lang)
  const db = useAppStore((s) => s.db)
  const authed = useAppStore((s) => s.authed)
  const savedCards = useAppStore((s) => s.savedCards)
  const saveError = useAppStore((s) => s.saveError)
  const cloudBusy = useAppStore((s) => s.cloudBusy)
  const loadSavedCard = useAppStore((s) => s.loadSavedCard)
  const deleteSavedCard = useAppStore((s) => s.deleteSavedCard)
  const uploadSavedCard = useAppStore((s) => s.uploadSavedCard)
  const guardEdits = useAppStore((s) => s.guardEdits)
  const setView = useAppStore((s) => s.setView)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('game')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !db) return savedCards
    return savedCards.filter((s) => `${s.name}\n${unitInfo(db, s.card.unitId).unitName}`.toLowerCase().includes(q))
  }, [savedCards, query, db])
  const groups = useMemo(
    () => (db ? arrange(db, shown, sort, (s) => ({ unitId: s.card.unitId, name: s.name, time: s.savedAt })) : []),
    [db, shown, sort],
  )

  if (!db) return null

  const open = (s: SavedCard) =>
    guardEdits(() => {
      loadSavedCard(s.id)
      setView('card')
    })

  return (
    <div className="library-body">
      <div className="library-toolbar">
        <input
          className="picker-search library-search"
          placeholder={t(lang, 'search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SortSelect sort={sort} onChange={setSort} />
        <span className="library-spacer" />
        <span className="library-count">
          {shown.length} {t(lang, 'cardsUnit')}
        </span>
        {authed && (
          <button
            className="library-button"
            disabled={cloudBusy}
            onClick={async () => {
              for (const c of savedCards) await uploadSavedCard(c.id)
            }}
          >
            {t(lang, 'uploadAll')}
          </button>
        )}
      </div>
      {saveError && <div className="saved-error">{t(lang, 'saveFailed')}</div>}
      <Notice />
      {savedCards.length === 0 && <div className="saved-hint">{t(lang, 'savedEmpty')}</div>}
      {groups.map((g) => (
        <div key={g.category ?? 'all'} className="library-section">
          <GroupHeading db={db} category={g.category} count={g.items.length} />
          <div className="library-grid">
            {g.items.map((s) => {
              const { thumb } = unitInfo(db, s.card.unitId)
              return (
                <div key={s.id} className="library-tile">
                  <button className="library-tile-main" title={t(lang, 'openCard')} onClick={() => open(s)}>
                    <span className="library-thumb">
                      {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="library-thumb-empty" />}
                    </span>
                    <span className="library-tile-name">{s.name}</span>
                  </button>
                  <div className="library-tile-foot">
                    <span className="library-tile-meta">{new Date(s.savedAt).toLocaleDateString()}</span>
                    <div className="library-tile-actions">
                      {authed && (
                        <button
                          className="library-icon-button"
                          title={t(lang, 'uploadToCloud')}
                          disabled={cloudBusy}
                          onClick={() => void uploadSavedCard(s.id)}
                        >
                          ⤒
                        </button>
                      )}
                      <button
                        className="library-icon-button"
                        title={t(lang, 'exportJson')}
                        onClick={() => exportSavedCardJson(s)}
                      >
                        ⤓
                      </button>
                      <button
                        className="library-icon-button danger"
                        title={t(lang, 'delete')}
                        onClick={() => {
                          if (window.confirm(t(lang, 'deleteConfirm'))) deleteSavedCard(s.id)
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
