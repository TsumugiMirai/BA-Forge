import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { thumbnailUrl } from '../assets'
import { UnitCategoryLocKey, UnitCategoryType } from '../data/enums'
import type { GameDb } from '../data/db'
import type { CloudCardMeta } from '../cloud/cloudCards'
import { CloudAuthError, CloudConflictError } from '../cloud/rest'
import type { SpecInput, SpecPoints, SpecRow, SpecUnitRef } from '../cloud/specs'
import { saveSpec } from '../cloud/specs'
import { cloudEnabled } from '../cloud/config'
import { AuthGate } from '../auth/AuthForm'
import { CardViewer } from '../ui/CardViewer'
import { t, type UiStringKey } from '../ui/i18n'
import './china.css'

type Notice = { kind: 'ok' | 'error'; key: UiStringKey; detail?: string }

const ICON_MAX = 256

/** The arsenal's unit categories in game order (Logistic has no units). */
const CATEGORIES = [0, 1, 2, 3, 5, 6]
/** pseudo-category for units whose template is unknown (deleted cards) */
const OTHER = -1

/** where the page was scrolled to, restored when coming back to it */
let savedScroll = 0

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
  return {
    name: row.name,
    icon: row.icon,
    description: row.description,
    units: row.units ?? [],
    points: row.points ?? {},
  }
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

function totalPoints(points: SpecPoints): number {
  return Object.values(points).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0)
}

interface ResolvedUnit {
  ref: SpecUnitRef
  name: string
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
 * The China specialization setup page (#china): each specialization as a
 * full-width row, collapsed to a summary until opened. An open one lists its
 * units by arsenal category as cards (drag left/right to reorder; a click
 * shows the unit's card on top of the page) with the category's points at
 * the end of the row. Saved online in the `specs` table, one specialization
 * at a time. Open rows and unsaved edits live in the store, so they are
 * still there after a trip to the card maker.
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
  const guardEdits = useAppStore((s) => s.guardEdits)
  const open = useAppStore((s) => s.chinaOpen)
  const setOpen = useAppStore((s) => s.setChinaOpen)
  const drafts = useAppStore((s) => s.chinaDrafts)
  const setDrafts = useAppStore((s) => s.setChinaDrafts)

  const [notices, setNotices] = useState<Record<number, Notice | undefined>>({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [picker, setPicker] = useState<{ specId: number; category: number | null } | null>(null)
  const [viewing, setViewing] = useState<SpecUnitRef | null>(null)

  useEffect(() => {
    if (!authed || !cloudEnabled()) return
    void refreshSpecs()
    void refreshCloud()
  }, [authed, refreshSpecs, refreshCloud])

  // come back to where the page was left
  const pageRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const scroller = pageRef.current?.closest('.page-full')
    if (!scroller) return
    scroller.scrollTop = savedScroll
    const remember = () => void (savedScroll = scroller.scrollTop)
    scroller.addEventListener('scroll', remember, { passive: true })
    return () => scroller.removeEventListener('scroll', remember)
  }, [authed, !!specs])

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

  const allOpen = !!specs && specs.every((s) => open[s.id])
  const pickerSpec = picker ? specs?.find((s) => s.id === picker.specId) : undefined
  const pickerInput = pickerSpec ? (drafts[pickerSpec.id]?.value ?? inputOf(pickerSpec)) : null

  return (
    <div className="china-page" ref={pageRef}>
      <div className="china-header">
        <h2>{t(lang, 'navChina')}</h2>
        <div className="china-header-actions">
          {specs && (
            <button onClick={() => setOpen(() => (allOpen ? {} : Object.fromEntries(specs.map((s) => [s.id, true]))))}>
              {allOpen ? t(lang, 'collapseAll') : t(lang, 'expandAll')}
            </button>
          )}
          <button disabled={loading} onClick={() => void refreshSpecs()}>
            {t(lang, 'refresh')}
          </button>
        </div>
      </div>

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
            onOpenUnit={(ref) => guardEdits(() => setViewing(ref))}
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
      {viewing && <CardViewer unitRef={viewing} returnTo="china" onClose={() => setViewing(null)} />}
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
  const points = totalPoints(value.points)

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
  const setPoints = (cat: number, text: string) => {
    const next = { ...value.points }
    const n = Math.round(Number(text))
    if (text.trim() === '' || !Number.isFinite(n) || n < 0) delete next[cat]
    else next[cat] = n
    onChange({ ...value, points: next })
  }

  const name = value.name || `#${row.id}`

  return (
    <section className={`spec-row ${open ? 'open' : ''} ${dirty ? 'dirty' : ''}`}>
      <div className="spec-summary">
        <button className="spec-summary-main" aria-expanded={open} onClick={props.onToggle}>
          <svg className="spec-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path fill="currentColor" d="M5.5 3.5 10 8l-4.5 4.5-1-1L8 8 4.5 4.5z" />
          </svg>
          <SpecEmblem name={value.name} icon={value.icon} size={44} />
          <span className="spec-summary-text">
            <span className="spec-summary-name">
              {name}
              {dirty && <span className="spec-dirty">{t(lang, 'specUnsaved')}</span>}
            </span>
            {value.description && <span className="spec-summary-desc">{value.description}</span>}
          </span>
          <span className="spec-summary-counts">
            {groups.map(([cat, units]) => (
              <span key={cat} className={`spec-count ${units.length ? '' : 'zero'}`}>
                {categoryName(db, lang, cat)} <b>{units.length}</b>
              </span>
            ))}
          </span>
          <span className="spec-total">
            <b>{value.units.length}</b>
            {points > 0 && (
              <small>
                {points} {t(lang, 'pointsUnit')}
              </small>
            )}
          </span>
        </button>
        {open && (
          <button className="spec-edit-info" onClick={() => setEditingInfo(!editingInfo)}>
            {editingInfo ? t(lang, 'done') : t(lang, 'editSpecInfo')}
          </button>
        )}
      </div>

      {open && (
        <div className="spec-body">
          {editingInfo && (
            <div className="spec-info-edit">
              <button className="spec-emblem-button" title={t(lang, 'changeIcon')} onClick={() => fileInput.current?.click()}>
                <SpecEmblem name={value.name} icon={value.icon} size={72} />
                <span>{t(lang, 'changeIcon')}</span>
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
                </div>
                <textarea
                  className="cloud-input spec-description"
                  aria-label={t(lang, 'specDescription')}
                  placeholder={t(lang, 'specDescriptionHint')}
                  value={value.description}
                  rows={3}
                  onChange={(e) => onChange({ ...value, description: e.target.value })}
                />
              </div>
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
            </div>
          )}

          {/* one row per arsenal category: its units left to right (drag, or
              ‹ › to reorder), its points at the end */}
          <div className="spec-cat-rows">
            {groups.map(([cat, units]) => (
              <div key={cat} className="spec-cat-row">
                <div className="spec-cat-label">
                  <span className="spec-cat-name">{categoryName(db, lang, cat)}</span>
                  <span className="spec-cat-count">{units.length}</span>
                  {cat !== OTHER && (
                    <button className="spec-cat-add" title={t(lang, 'addUnits')} onClick={() => props.onAddUnits(cat)}>
                      +
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
                          title={u.name}
                          disabled={u.missing}
                          onClick={() => props.onOpenUnit(u.ref)}
                        >
                          <span className="spec-unit-thumb">
                            {u.thumb ? <img src={u.thumb} alt="" draggable={false} /> : <span className="spec-unit-noimg" />}
                          </span>
                          <span className="spec-unit-card-name">{u.name}</span>
                        </button>
                        {!u.custom && !u.missing && <span className="spec-unit-tag">{t(lang, 'gameUnitShort')}</span>}
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
                {cat !== OTHER && (
                  <label className="spec-cat-points">
                    <span>{t(lang, 'points')}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={50}
                      placeholder="—"
                      value={value.points[cat] ?? ''}
                      onChange={(e) => setPoints(cat, e.target.value)}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>

          {(dirty || notice) && (
            <div className={`spec-actions ${dirty ? 'dirty' : ''}`}>
              <span className="spec-actions-status">
                {notice ? (
                  <span className={notice.kind === 'error' ? 'saved-error' : 'cloud-ok'}>
                    {t(lang, notice.key)}
                    {notice.detail ? `: ${notice.detail}` : ''}
                  </span>
                ) : (
                  <span className="spec-dirty-text">{t(lang, 'specUnsaved')}</span>
                )}
              </span>
              {dirty && (
                <>
                  <button className="spec-button" disabled={saving} onClick={props.onRevert}>
                    {t(lang, 'revertChanges')}
                  </button>
                  <button className="spec-button primary" disabled={saving} onClick={props.onSave}>
                    {saving ? t(lang, 'cloudWorking') : t(lang, 'save')}
                  </button>
                </>
              )}
            </div>
          )}
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
          sub: c.author,
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
