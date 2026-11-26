import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { iconUrl, thumbnailUrl } from '../assets'
import { UnitCategoryLocKey, UnitCategoryType } from '../data/enums'
import type { GameDb } from '../data/db'
import type { CloudCardMeta } from '../cloud/cloudCards'
import { CloudAuthError, CloudConflictError } from '../cloud/rest'
import type { SpecInput, SpecRow, SpecUnitRef } from '../cloud/specs'
import { saveSpec } from '../cloud/specs'
import { cloudEnabled } from '../cloud/config'
import { AuthGate } from '../auth/AuthForm'
import { t, type UiStringKey } from '../ui/i18n'
import './china.css'

type Notice = { kind: 'ok' | 'error'; key: UiStringKey; detail?: string }

const ICON_MAX = 256

/** The arsenal's unit categories in game order (Logistic has no units). */
const CATEGORIES = [0, 1, 2, 3, 5, 6]
/** pseudo-category for units whose template is unknown (deleted cards) */
const OTHER = -1
/** a stat sprite standing in for each category (the arsenal's own category
 *  tabs are text) */
const CATEGORY_ICON: Record<number, string> = {
  0: 'Optics',
  1: 'Forward speed.inf',
  2: 'Forward speed.car',
  3: 'Explosive charge',
  5: 'Forward speed.hel',
  6: 'Forward speed.air',
}

/** Read an image file as a square-bounded WebP data URL (≤256 px a side). */
async function readIcon(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, ICON_MAX / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const webp = canvas.toDataURL('image/webp', 0.9)
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

function inputOf(row: SpecRow): SpecInput {
  return { name: row.name, icon: row.icon, description: row.description, units: row.units ?? [] }
}

const sameRef = (a: SpecUnitRef, b: SpecUnitRef) => a.source === b.source && a.id === b.id
const refKey = (r: SpecUnitRef) => `${r.source}:${r.id}`

/** `units` with `moved` taken out and put just before/after `target` */
function moveRef(
  units: SpecUnitRef[],
  moved: SpecUnitRef,
  target: SpecUnitRef,
  side: 'before' | 'after',
): SpecUnitRef[] {
  const rest = units.filter((u) => !sameRef(u, moved))
  const at = rest.findIndex((u) => sameRef(u, target))
  if (at < 0) return units
  rest.splice(side === 'before' ? at : at + 1, 0, moved)
  return rest
}

interface ResolvedUnit {
  ref: SpecUnitRef
  name: string
  /** custom cards: the game unit they are built on */
  base: string
  thumb: string | null
  category: number
  custom: boolean
  missing: boolean
}

function resolveRef(
  db: GameDb,
  cards: Map<string, CloudCardMeta>,
  ref: SpecUnitRef,
  lang: 'eng' | 'chi',
): ResolvedUnit {
  if (ref.source === 'card') {
    const meta = cards.get(ref.id)
    const unit = meta?.unit_id != null ? db.units.get(meta.unit_id) : undefined
    return {
      ref,
      name: meta?.name ?? t(lang, 'deletedCard'),
      base: unit?.HUDName ?? unit?.Name ?? '',
      thumb: thumbnailUrl(unit?.ThumbnailFileName ?? null),
      category: unit?.CategoryType ?? OTHER,
      custom: true,
      missing: !meta,
    }
  }
  const unit = db.units.get(ref.id)
  return {
    ref,
    name: unit?.HUDName ?? unit?.Name ?? `#${ref.id}`,
    base: '',
    thumb: thumbnailUrl(unit?.ThumbnailFileName ?? null),
    category: unit?.CategoryType ?? OTHER,
    custom: false,
    missing: !unit,
  }
}

function categoryName(db: GameDb, lang: 'eng' | 'chi', cat: number): string {
  return cat === OTHER
    ? t(lang, 'categoryOther')
    : db.locOr(UnitCategoryLocKey[cat], UnitCategoryType[cat] ?? String(cat))
}

/** units per category, in game order (Other only when it has some) */
function groupUnits(db: GameDb, cards: Map<string, CloudCardMeta>, units: SpecUnitRef[], lang: 'eng' | 'chi') {
  const map = new Map<number, ResolvedUnit[]>(CATEGORIES.map((c) => [c, []]))
  for (const ref of units) {
    const u = resolveRef(db, cards, ref, lang)
    const key = map.has(u.category) ? u.category : OTHER
    const list = map.get(key)
    if (list) list.push(u)
    else map.set(key, [u])
  }
  return [...map.entries()].filter(([cat, list]) => cat !== OTHER || list.length > 0)
}

/** a specialization's emblem: its icon, else its first letter */
function SpecEmblem({ name, icon, size }: { name: string; icon: string | null; size: number }) {
  return (
    <span className="spec-emblem" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {icon ? <img src={icon} alt="" draggable={false} /> : (name || '?').slice(0, 1)}
    </span>
  )
}

/**
 * The China specialization setup page (#china): a strip of the six
 * specializations to jump between, and each one as a full-width row,
 * collapsed to a summary until opened. An open one shows its emblem, name and
 * description (editable on demand) and its units by arsenal category as
 * cards that drag left/right to reorder. Saved online in the `specs` table,
 * one specialization at a time.
 */
export function ChinaSpecsPage() {
  const lang = useAppStore((s) => s.lang)
  const db = useAppStore((s) => s.db)
  const authed = useAppStore((s) => s.authed)
  const cloudCards = useAppStore((s) => s.cloudCards)
  const refreshCloud = useAppStore((s) => s.refreshCloud)
  const specs = useAppStore((s) => s.specs)
  const loading = useAppStore((s) => s.specsLoading)
  const pageNotice = useAppStore((s) => s.specsNotice)
  const refreshSpecs = useAppStore((s) => s.refreshSpecs)
  const replaceSpec = useAppStore((s) => s.replaceSpec)
  const setView = useAppStore((s) => s.setView)
  const guardEdits = useAppStore((s) => s.guardEdits)
  const loadCloudCard = useAppStore((s) => s.loadCloudCard)
  const selectUnit = useAppStore((s) => s.selectUnit)

  // unsaved edits per specialization, with the version they started from:
  // saving checks that version, so a newer save by someone else (or a card
  // assigned from the card maker) is never overwritten unnoticed
  const [drafts, setDrafts] = useState<Record<number, { value: SpecInput; version: number }>>({})
  const [notices, setNotices] = useState<Record<number, Notice | undefined>>({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [picker, setPicker] = useState<{ specId: number; category: number | null } | null>(null)

  useEffect(() => {
    if (!authed || !cloudEnabled()) return
    void refreshSpecs()
    void refreshCloud()
  }, [authed, refreshSpecs, refreshCloud])

  const cardsById = useMemo(() => new Map(cloudCards.map((c) => [c.id, c])), [cloudCards])

  if (!authed)
    return (
      <div className="china-page">
        <AuthGate reason="authGateChina" />
      </div>
    )
  if (!db) return null

  const edit = (row: SpecRow, next: SpecInput) => {
    setDrafts((d) => ({ ...d, [row.id]: { value: next, version: d[row.id]?.version ?? row.version } }))
    setNotices((n) => ({ ...n, [row.id]: undefined }))
  }
  const revert = (id: number) => {
    setDrafts((d) => {
      const { [id]: _, ...rest } = d
      return rest
    })
    setNotices((n) => ({ ...n, [id]: undefined }))
    // pick up whatever was saved meanwhile
    void refreshSpecs()
  }
  const save = async (row: SpecRow) => {
    const draft = drafts[row.id]
    if (!draft) return
    setSaving((s) => ({ ...s, [row.id]: true }))
    try {
      const saved = await saveSpec(row.id, draft.version, { ...draft.value, name: draft.value.name.trim() || row.name })
      replaceSpec(saved)
      setDrafts((d) => {
        const { [row.id]: _, ...rest } = d
        return rest
      })
      setNotices((n) => ({ ...n, [row.id]: { kind: 'ok', key: 'specSaved' } }))
    } catch (e) {
      // the draft stays; it can be saved again after logging in
      if (e instanceof CloudAuthError) return
      setNotices((n) => ({
        ...n,
        [row.id]:
          e instanceof CloudConflictError
            ? { kind: 'error', key: 'specConflict' }
            : { kind: 'error', key: 'cloudFailed', detail: e instanceof Error ? e.message : String(e) },
      }))
    } finally {
      setSaving((s) => ({ ...s, [row.id]: false }))
    }
  }
  const openUnit = (ref: SpecUnitRef) =>
    guardEdits(() => {
      if (ref.source === 'card') void loadCloudCard(ref.id).then((ok) => ok && setView('card'))
      else {
        selectUnit(ref.id)
        setView('card')
      }
    })
  // the strip at the top: open that specialization and bring it into view
  const jumpTo = (id: number) => {
    setOpen((o) => ({ ...o, [id]: true }))
    requestAnimationFrame(() =>
      document.getElementById(`spec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }

  const allOpen = !!specs && specs.every((s) => open[s.id])
  const pickerSpec = picker ? specs?.find((s) => s.id === picker.specId) : undefined
  const pickerInput = pickerSpec ? (drafts[pickerSpec.id]?.value ?? inputOf(pickerSpec)) : null

  return (
    <div className="china-page">
      <div className="china-hero">
        <div className="china-hero-text">
          <h2>{t(lang, 'chinaTitle')}</h2>
          <p>{t(lang, 'chinaHint')}</p>
        </div>
        <div className="china-hero-actions">
          {specs && (
            <button onClick={() => setOpen(allOpen ? {} : Object.fromEntries(specs.map((s) => [s.id, true])))}>
              {allOpen ? t(lang, 'collapseAll') : t(lang, 'expandAll')}
            </button>
          )}
          <button disabled={loading} onClick={() => void refreshSpecs()}>
            {loading ? t(lang, 'cloudLoading') : t(lang, 'refresh')}
          </button>
        </div>
      </div>

      {specs && (
        <nav className="spec-switcher" aria-label={t(lang, 'chinaTitle')}>
          {specs.map((row) => {
            const value = drafts[row.id]?.value ?? inputOf(row)
            return (
              <button
                key={row.id}
                className={`spec-switch ${open[row.id] ? 'open' : ''} ${drafts[row.id] ? 'dirty' : ''}`}
                title={value.description || value.name}
                onClick={() => jumpTo(row.id)}
              >
                <SpecEmblem name={value.name} icon={value.icon} size={34} />
                <span className="spec-switch-text">
                  <span className="spec-switch-name">{value.name || `#${row.id}`}</span>
                  <span className="spec-switch-count">
                    {value.units.length} {t(lang, 'unitsUnit')}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>
      )}

      {pageNotice && (
        <div className="saved-error china-page-notice">
          {t(lang, pageNotice.key)}
          {pageNotice.detail ? `: ${pageNotice.detail}` : ''}
        </div>
      )}
      {loading && !specs && <div className="saved-hint">{t(lang, 'cloudLoading')}</div>}
      <div className="spec-list">
        {specs?.map((row) => (
          <SpecEditor
            key={row.id}
            row={row}
            value={drafts[row.id]?.value ?? inputOf(row)}
            open={!!open[row.id]}
            dirty={!!drafts[row.id]}
            saving={!!saving[row.id]}
            notice={notices[row.id]}
            db={db}
            cardsById={cardsById}
            onToggle={() => setOpen((o) => ({ ...o, [row.id]: !o[row.id] }))}
            onChange={(next) => edit(row, next)}
            onSave={() => void save(row)}
            onRevert={() => revert(row.id)}
            onAddUnits={(category) => setPicker({ specId: row.id, category })}
            onOpenUnit={openUnit}
          />
        ))}
      </div>
      {pickerSpec && pickerInput && picker && (
        <AddUnitsDialog
          db={db}
          cards={cloudCards}
          specName={pickerInput.name}
          selected={pickerInput.units}
          initialCategory={picker.category}
          onToggle={(ref) => {
            const has = pickerInput.units.some((u) => sameRef(u, ref))
            edit(pickerSpec, {
              ...pickerInput,
              units: has ? pickerInput.units.filter((u) => !sameRef(u, ref)) : [...pickerInput.units, ref],
            })
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

function SpecEditor(props: {
  row: SpecRow
  value: SpecInput
  open: boolean
  dirty: boolean
  saving: boolean
  notice: Notice | undefined
  db: GameDb
  cardsById: Map<string, CloudCardMeta>
  onToggle(): void
  onChange(next: SpecInput): void
  onSave(): void
  onRevert(): void
  onAddUnits(category: number | null): void
  onOpenUnit(ref: SpecUnitRef): void
}) {
  const { row, value, open, dirty, saving, notice, db, cardsById, onChange } = props
  const lang = useAppStore((s) => s.lang)
  const fileInput = useRef<HTMLInputElement>(null)
  const [editingInfo, setEditingInfo] = useState(false)

  const groups = useMemo(() => groupUnits(db, cardsById, value.units, lang), [value.units, db, cardsById, lang])

  // drag to reorder: units move only within their own category row; the
  // order is the order of `units`, so it is saved with the specialization
  const drag = useRef<{ ref: SpecUnitRef; category: number } | null>(null)
  const [dropAt, setDropAt] = useState<{ key: string; side: 'before' | 'after' } | null>(null)
  const endDrag = () => {
    drag.current = null
    setDropAt(null)
  }
  const reorder = (moved: SpecUnitRef, target: SpecUnitRef, side: 'before' | 'after') =>
    onChange({ ...value, units: moveRef(value.units, moved, target, side) })

  const name = value.name || `#${row.id}`

  return (
    <section id={`spec-${row.id}`} className={`spec-row ${open ? 'open' : ''} ${dirty ? 'dirty' : ''}`}>
      {/* summary bar: always shown, toggles the body */}
      <button className="spec-summary" aria-expanded={open} onClick={props.onToggle}>
        <svg className="spec-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M5.5 3.5 10 8l-4.5 4.5-1-1L8 8 4.5 4.5z" />
        </svg>
        <SpecEmblem name={value.name} icon={value.icon} size={52} />
        <span className="spec-summary-text">
          <span className="spec-summary-name">
            {name}
            {dirty && <span className="spec-dirty">{t(lang, 'specUnsaved')}</span>}
          </span>
          <span className={`spec-summary-desc ${value.description ? '' : 'empty'}`}>
            {value.description || t(lang, 'specNoDescription')}
          </span>
        </span>
        <span className="spec-summary-counts">
          {groups.map(([cat, units]) => (
            <span
              key={cat}
              className={`spec-count ${units.length ? '' : 'zero'}`}
              title={`${categoryName(db, lang, cat)} ${units.length}`}
            >
              {CATEGORY_ICON[cat] ? <img src={iconUrl(CATEGORY_ICON[cat]) ?? undefined} alt="" /> : null}
              <span className="spec-count-name">{categoryName(db, lang, cat)}</span>
              <b>{units.length}</b>
            </span>
          ))}
        </span>
        <span className="spec-total">
          <b>{value.units.length}</b>
          <small>{t(lang, 'unitsUnit')}</small>
        </span>
      </button>

      {open && (
        <div className="spec-body">
          {/* who it is: shown as a header, edited on demand */}
          {editingInfo ? (
            <div className="spec-info editing">
              <button className="spec-emblem-button" title={t(lang, 'changeIcon')} onClick={() => fileInput.current?.click()}>
                <SpecEmblem name={value.name} icon={value.icon} size={84} />
                <span className="spec-emblem-hint">{t(lang, 'changeIcon')}</span>
              </button>
              <div className="spec-info-fields">
                <div className="spec-name-row">
                  <input
                    className="cloud-input spec-name"
                    aria-label={t(lang, 'specName')}
                    placeholder={t(lang, 'specName')}
                    value={value.name}
                    maxLength={40}
                    onChange={(e) => onChange({ ...value, name: e.target.value })}
                  />
                  {value.icon && (
                    <button className="cloud-link" onClick={() => onChange({ ...value, icon: null })}>
                      {t(lang, 'removeIcon')}
                    </button>
                  )}
                  <span className="spec-number">#{row.id}</span>
                </div>
                <textarea
                  className="cloud-input spec-description"
                  aria-label={t(lang, 'specDescription')}
                  placeholder={t(lang, 'specDescriptionHint')}
                  value={value.description}
                  rows={3}
                  onChange={(e) => onChange({ ...value, description: e.target.value })}
                />
                <div className="spec-info-actions">
                  <button className="spec-button" onClick={() => setEditingInfo(false)}>
                    {t(lang, 'done')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="spec-info">
              <SpecEmblem name={value.name} icon={value.icon} size={84} />
              <div className="spec-info-text">
                <div className="spec-info-title">
                  <h3>{name}</h3>
                  <span className="spec-number">#{row.id}</span>
                </div>
                <p className={value.description ? '' : 'empty'}>
                  {value.description || t(lang, 'specNoDescription')}
                </p>
              </div>
              <button className="spec-button" onClick={() => setEditingInfo(true)}>
                {t(lang, 'editSpecInfo')}
              </button>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) onChange({ ...value, icon: await readIcon(file) })
            }}
          />

          {/* one row per arsenal category; its units are cards laid out
              left to right, dragged (or nudged with ‹ ›) to reorder */}
          <div className="spec-cat-rows">
            {groups.map(([cat, units]) => (
              <div key={cat} className={`spec-cat-row ${units.length ? '' : 'empty'}`}>
                <div className="spec-cat-label">
                  <span className="spec-cat-title">
                    {CATEGORY_ICON[cat] && <img src={iconUrl(CATEGORY_ICON[cat]) ?? undefined} alt="" />}
                    <span className="spec-cat-name">{categoryName(db, lang, cat)}</span>
                  </span>
                  <span className="spec-cat-count">{units.length}</span>
                  {cat !== OTHER && (
                    <button className="spec-cat-add" title={t(lang, 'addUnits')} onClick={() => props.onAddUnits(cat)}>
                      {t(lang, 'addUnits')}
                    </button>
                  )}
                </div>
                <div
                  className="spec-cat-cards"
                  onDragOver={(e) => {
                    // empty space after the last card: drop at the row's end
                    const dragged = drag.current
                    if (!dragged || dragged.category !== cat || e.target !== e.currentTarget) return
                    e.preventDefault()
                    setDropAt(null)
                  }}
                  onDrop={(e) => {
                    const dragged = drag.current
                    if (!dragged || dragged.category !== cat || e.target !== e.currentTarget) return
                    e.preventDefault()
                    const last = units[units.length - 1]
                    if (last && !sameRef(last.ref, dragged.ref)) reorder(dragged.ref, last.ref, 'after')
                    endDrag()
                  }}
                >
                  {units.map((u, i) => {
                    const key = refKey(u.ref)
                    const dropSide = dropAt?.key === key ? dropAt.side : null
                    return (
                      <div
                        key={key}
                        className={[
                          'spec-unit-card',
                          u.custom ? 'custom' : '',
                          u.missing ? 'missing' : '',
                          drag.current && refKey(drag.current.ref) === key ? 'dragging' : '',
                          dropSide ? `drop-${dropSide}` : '',
                        ].join(' ')}
                        draggable
                        onDragStart={(e) => {
                          drag.current = { ref: u.ref, category: cat }
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', key) // Firefox needs data
                        }}
                        onDragOver={(e) => {
                          const dragged = drag.current
                          if (!dragged || dragged.category !== cat) return
                          e.preventDefault()
                          e.stopPropagation()
                          if (sameRef(dragged.ref, u.ref)) return setDropAt(null)
                          const r = e.currentTarget.getBoundingClientRect()
                          const side = e.clientX < r.left + r.width / 2 ? 'before' : 'after'
                          if (dropAt?.key !== key || dropAt.side !== side) setDropAt({ key, side })
                        }}
                        onDrop={(e) => {
                          const dragged = drag.current
                          if (!dragged || dragged.category !== cat) return
                          e.preventDefault()
                          e.stopPropagation()
                          if (dropSide && !sameRef(dragged.ref, u.ref)) reorder(dragged.ref, u.ref, dropSide)
                          endDrag()
                        }}
                        onDragEnd={endDrag}
                      >
                        <button
                          className="spec-unit-card-open"
                          title={t(lang, 'openInEditor')}
                          disabled={u.missing}
                          onClick={() => props.onOpenUnit(u.ref)}
                        >
                          <span className="spec-unit-thumb">
                            {u.thumb ? <img src={u.thumb} alt="" draggable={false} /> : <span className="spec-unit-noimg" />}
                          </span>
                          <span className="spec-unit-card-name">{u.name}</span>
                          <span className="spec-unit-card-sub">
                            {u.custom ? (u.base ? `${t(lang, 'basedOn')} ${u.base}` : t(lang, 'customUnit')) : t(lang, 'gameUnit')}
                          </span>
                        </button>
                        {u.custom && <span className="spec-unit-badge">{t(lang, 'customUnit')}</span>}
                        <button
                          className="spec-unit-remove"
                          title={t(lang, 'remove')}
                          onClick={() => onChange({ ...value, units: value.units.filter((r) => !sameRef(r, u.ref)) })}
                        >
                          ×
                        </button>
                        <div className="spec-unit-move">
                          <button
                            title={t(lang, 'moveLeft')}
                            disabled={i === 0}
                            onClick={() => reorder(u.ref, units[i - 1]!.ref, 'before')}
                          >
                            ‹
                          </button>
                          <button
                            title={t(lang, 'moveRight')}
                            disabled={i === units.length - 1}
                            onClick={() => reorder(u.ref, units[i + 1]!.ref, 'after')}
                          >
                            ›
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {units.length === 0 && cat !== OTHER && (
                    <button className="spec-cat-empty" onClick={() => props.onAddUnits(cat)}>
                      {t(lang, 'addUnits')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* save bar: sticks to the bottom of the window while the
              specialization is in view */}
          <div className={`spec-actions ${dirty ? 'dirty' : ''}`}>
            <span className="spec-actions-status">
              {notice ? (
                <span className={notice.kind === 'error' ? 'saved-error' : 'cloud-ok'}>
                  {t(lang, notice.key)}
                  {notice.detail ? `: ${notice.detail}` : ''}
                </span>
              ) : dirty ? (
                <span className="spec-dirty">{t(lang, 'specUnsaved')}</span>
              ) : (
                <span className="saved-hint">{t(lang, 'specAllSaved')}</span>
              )}
            </span>
            <button className="spec-button" disabled={!dirty || saving} onClick={props.onRevert}>
              {t(lang, 'revertChanges')}
            </button>
            <button className="spec-button primary" disabled={!dirty || saving} onClick={props.onSave}>
              {saving ? t(lang, 'cloudWorking') : t(lang, 'save')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** Pick units for a specialization: custom cards from the online library or
 *  stock game units, narrowed by arsenal category; clicking toggles a unit. */
function AddUnitsDialog(props: {
  db: GameDb
  cards: CloudCardMeta[]
  specName: string
  selected: SpecUnitRef[]
  initialCategory: number | null
  onToggle(ref: SpecUnitRef): void
  onClose(): void
}) {
  const { db, cards, selected } = props
  const lang = useAppStore((s) => s.lang)
  const [tab, setTab] = useState<'cards' | 'units'>(cards.length > 0 ? 'cards' : 'units')
  const [category, setCategory] = useState<number | null>(props.initialCategory)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const items = useMemo(() => {
    if (tab === 'cards')
      return cards
        .map((c) => ({ c, unit: c.unit_id != null ? db.units.get(c.unit_id) : undefined }))
        .filter(({ unit }) => category == null || unit?.CategoryType === category)
        .filter(({ c }) => !q || `${c.name}\n${c.author}`.toLowerCase().includes(q))
        .map(({ c, unit }) => ({
          ref: { source: 'card', id: c.id } as SpecUnitRef,
          name: c.name,
          sub: [c.author, unit?.HUDName].filter(Boolean).join(' · '),
          thumb: thumbnailUrl(unit?.ThumbnailFileName ?? null),
        }))
    return db
      .armoryUnits()
      .filter((u) => category == null || u.CategoryType === category)
      .filter((u) => !q || db.unitSearchText(u.Id).includes(q))
      .sort((a, b) => a.CategoryType - b.CategoryType || (a.HUDName ?? '').localeCompare(b.HUDName ?? ''))
      .map((u) => ({
        ref: { source: 'unit', id: u.Id } as SpecUnitRef,
        name: u.HUDName ?? u.Name ?? `#${u.Id}`,
        sub: categoryName(db, lang, u.CategoryType),
        thumb: thumbnailUrl(u.ThumbnailFileName),
      }))
  }, [tab, q, category, cards, db, lang])

  return (
    <div className="crop-overlay" onClick={props.onClose}>
      <div className="add-units-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="add-units-head">
          <h3>
            {t(lang, 'addUnits')} · {props.specName}
          </h3>
          <button className="spec-button primary" onClick={props.onClose}>
            {t(lang, 'done')}
          </button>
        </div>
        <div className="picker-tabs">
          <button className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}>
            {t(lang, 'cloudTitle')} <span className="picker-count">{cards.length}</span>
          </button>
          <button className={tab === 'units' ? 'active' : ''} onClick={() => setTab('units')}>
            {t(lang, 'pickerGameUnits')}
          </button>
        </div>
        <div className="picker-tabs">
          <button className={category == null ? 'active' : ''} onClick={() => setCategory(null)}>
            {t(lang, 'allCategories')}
          </button>
          {CATEGORIES.map((c) => (
            <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
              {categoryName(db, lang, c)}
            </button>
          ))}
        </div>
        <input
          className="picker-search"
          autoFocus
          placeholder={t(lang, 'search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="add-units-list">
          {items.length === 0 && <div className="saved-hint">{t(lang, 'noMatches')}</div>}
          {items.map((it) => {
            const on = selected.some((s) => sameRef(s, it.ref))
            return (
              <button
                key={`${it.ref.source}:${it.ref.id}`}
                className={`add-units-item ${on ? 'on' : ''}`}
                onClick={() => props.onToggle(it.ref)}
              >
                <span className="add-units-thumb">
                  {it.thumb ? <img src={it.thumb} alt="" /> : <span className="spec-unit-noimg" />}
                </span>
                <span className="add-units-text">
                  <span className="saved-name">{it.name}</span>
                  {it.sub && <span className="cloud-meta">{it.sub}</span>}
                </span>
                <span className="add-units-mark">{on ? `✓ ${t(lang, 'added')}` : '+'}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
