import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { thumbnailUrl } from '../assets'
import { UnitCategoryLocKey, UnitCategoryType } from '../data/enums'
import type { GameDb } from '../data/db'
import type { CloudCardMeta } from '../cloud/cloudCards'
import { CloudConflictError, CloudMissingTableError } from '../cloud/rest'
import type { SpecInput, SpecRow, SpecUnitRef } from '../cloud/specs'
import { ensureSpecs, listSpecs, saveSpec } from '../cloud/specs'
import { cloudEnabled } from '../cloud/config'
import { LoginForm } from '../ui/LoginForm'
import { t, type UiStringKey } from '../ui/i18n'
import './china.css'

type Notice = { kind: 'ok' | 'error'; key: UiStringKey; detail?: string }

const ICON_MAX = 256

/** The arsenal's unit categories in game order (Logistic has no units). */
const CATEGORIES = [0, 1, 2, 3, 5, 6]
/** pseudo-category for units whose template is unknown (deleted cards) */
const OTHER = -1

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

/**
 * The China specialization setup page (#china): six preset specializations
 * as full-width rows, collapsed to a summary until opened. An open one edits
 * its name, icon and description and lists its units in the game's arsenal
 * categories; everything is saved online in the `specs` table.
 */
export function ChinaSpecsPage() {
  const lang = useAppStore((s) => s.lang)
  const db = useAppStore((s) => s.db)
  const authed = useAppStore((s) => s.authed)
  const cloudCards = useAppStore((s) => s.cloudCards)
  const refreshCloud = useAppStore((s) => s.refreshCloud)
  const setView = useAppStore((s) => s.setView)
  const guardEdits = useAppStore((s) => s.guardEdits)
  const loadCloudCard = useAppStore((s) => s.loadCloudCard)
  const selectUnit = useAppStore((s) => s.selectUnit)

  const [specs, setSpecs] = useState<SpecRow[] | null>(null)
  const [drafts, setDrafts] = useState<Record<number, SpecInput>>({})
  const [notices, setNotices] = useState<Record<number, Notice | undefined>>({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [pageNotice, setPageNotice] = useState<Notice | null>(null)
  const [picker, setPicker] = useState<{ specId: number; category: number | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setPageNotice(null)
    try {
      setSpecs(await ensureSpecs(await listSpecs()))
    } catch (e) {
      setPageNotice(
        e instanceof CloudMissingTableError
          ? { kind: 'error', key: 'specsMissing' }
          : { kind: 'error', key: 'cloudFailed', detail: e instanceof Error ? e.message : String(e) },
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authed || !cloudEnabled()) return
    void load()
    void refreshCloud()
  }, [authed, load, refreshCloud])

  const cardsById = useMemo(() => new Map(cloudCards.map((c) => [c.id, c])), [cloudCards])

  if (!authed)
    return (
      <div className="china-page">
        <div className="china-login">
          <LoginForm />
        </div>
      </div>
    )
  if (!db) return null

  const edit = (id: number, next: SpecInput) => {
    setDrafts((d) => ({ ...d, [id]: next }))
    setNotices((n) => ({ ...n, [id]: undefined }))
  }
  const revert = (id: number) => {
    setDrafts((d) => {
      const { [id]: _, ...rest } = d
      return rest
    })
    setNotices((n) => ({ ...n, [id]: undefined }))
    // pick up whatever was saved meanwhile
    void load()
  }
  const save = async (row: SpecRow) => {
    const draft = drafts[row.id]
    if (!draft) return
    setSaving((s) => ({ ...s, [row.id]: true }))
    try {
      const saved = await saveSpec(row.id, row.version, { ...draft, name: draft.name.trim() || row.name })
      setSpecs((list) => list?.map((r) => (r.id === saved.id ? saved : r)) ?? null)
      setDrafts((d) => {
        const { [row.id]: _, ...rest } = d
        return rest
      })
      setNotices((n) => ({ ...n, [row.id]: { kind: 'ok', key: 'specSaved' } }))
    } catch (e) {
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
      if (ref.source === 'card') void loadCloudCard(ref.id)
      else selectUnit(ref.id)
      setView('card')
    })

  const allOpen = !!specs && specs.every((s) => open[s.id])
  const pickerSpec = picker ? specs?.find((s) => s.id === picker.specId) : undefined
  const pickerInput = pickerSpec ? (drafts[pickerSpec.id] ?? inputOf(pickerSpec)) : null

  return (
    <div className="china-page">
      <div className="china-header">
        <div>
          <h2>{t(lang, 'chinaTitle')}</h2>
          <div className="saved-hint">{t(lang, 'chinaHint')}</div>
        </div>
        <div className="china-header-actions">
          {specs && (
            <button
              onClick={() =>
                setOpen(allOpen ? {} : Object.fromEntries(specs.map((s) => [s.id, true])))
              }
            >
              {allOpen ? t(lang, 'collapseAll') : t(lang, 'expandAll')}
            </button>
          )}
          <button disabled={loading} onClick={() => void load()}>
            {t(lang, 'refresh')}
          </button>
          <button onClick={() => setView('card')}>{t(lang, 'backToCards')}</button>
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
            value={drafts[row.id] ?? inputOf(row)}
            open={!!open[row.id]}
            dirty={!!drafts[row.id]}
            saving={!!saving[row.id]}
            notice={notices[row.id]}
            db={db}
            cardsById={cardsById}
            onToggle={() => setOpen((o) => ({ ...o, [row.id]: !o[row.id] }))}
            onChange={(next) => edit(row.id, next)}
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
          selected={pickerInput.units}
          initialCategory={picker.category}
          onToggle={(ref) => {
            const has = pickerInput.units.some((u) => sameRef(u, ref))
            edit(pickerSpec.id, {
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

  // assigned units by arsenal category, in game order
  const byCategory = useMemo(() => {
    const map = new Map<number, ResolvedUnit[]>(CATEGORIES.map((c) => [c, []]))
    for (const ref of value.units) {
      const u = resolveRef(db, cardsById, ref, lang)
      const key = map.has(u.category) ? u.category : OTHER
      const list = map.get(key)
      if (list) list.push(u)
      else map.set(key, [u])
    }
    return map
  }, [value.units, db, cardsById, lang])
  const columns = [...byCategory.entries()].filter(([cat, units]) => cat !== OTHER || units.length > 0)

  const icon = value.icon ? (
    <img src={value.icon} alt="" />
  ) : (
    <span>{(value.name || '?').slice(0, 1)}</span>
  )

  return (
    <section className={`spec-row ${open ? 'open' : ''} ${dirty ? 'dirty' : ''}`}>
      {/* summary bar: always shown, toggles the body */}
      <button className="spec-summary" aria-expanded={open} onClick={props.onToggle}>
        <span className="spec-chevron">{open ? '▾' : '▸'}</span>
        <span className="spec-icon small">{icon}</span>
        <span className="spec-summary-text">
          <span className="spec-summary-name">{value.name || `#${row.id}`}</span>
          {value.description && <span className="spec-summary-desc">{value.description}</span>}
        </span>
        <span className="spec-summary-counts">
          {columns.map(([cat, units]) => (
            <span key={cat} className={`spec-count ${units.length ? '' : 'zero'}`}>
              {categoryName(db, lang, cat)} <b>{units.length}</b>
            </span>
          ))}
        </span>
        {dirty && <span className="spec-dirty">{t(lang, 'specUnsaved')}</span>}
      </button>

      {open && (
        <div className="spec-body">
          <div className="spec-head">
            <button className="spec-icon" title={t(lang, 'changeIcon')} onClick={() => fileInput.current?.click()}>
              {icon}
            </button>
            <div className="spec-head-fields">
              <div className="spec-name-row">
                <input
                  className="cloud-input spec-name"
                  aria-label={t(lang, 'specName')}
                  value={value.name}
                  maxLength={40}
                  onChange={(e) => onChange({ ...value, name: e.target.value })}
                />
                <button className="cloud-link" onClick={() => fileInput.current?.click()}>
                  {t(lang, 'changeIcon')}
                </button>
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
                rows={2}
                onChange={(e) => onChange({ ...value, description: e.target.value })}
              />
            </div>
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

          {/* units in the game's arsenal categories, one column each */}
          <div className="spec-columns">
            {columns.map(([cat, units]) => (
              <div key={cat} className="spec-column">
                <div className="spec-column-head">
                  <span>
                    {categoryName(db, lang, cat)} <span className="picker-count">{units.length}</span>
                  </span>
                  {cat !== OTHER && (
                    <button
                      className="spec-column-add"
                      title={t(lang, 'addUnits')}
                      onClick={() => props.onAddUnits(cat)}
                    >
                      +
                    </button>
                  )}
                </div>
                <div className="spec-column-units">
                  {units.map((u) => (
                    <div key={`${u.ref.source}:${u.ref.id}`} className={`spec-unit ${u.missing ? 'missing' : ''}`}>
                      <button
                        className="spec-unit-open"
                        title={t(lang, 'openInEditor')}
                        disabled={u.missing}
                        onClick={() => props.onOpenUnit(u.ref)}
                      >
                        {u.thumb ? <img src={u.thumb} alt="" /> : <span className="spec-unit-noimg" />}
                        <span className="spec-unit-name">{u.name}</span>
                        {u.custom && <span className="spec-unit-badge">{t(lang, 'customUnit')}</span>}
                      </button>
                      <button
                        className="spec-unit-remove"
                        title={t(lang, 'remove')}
                        onClick={() => onChange({ ...value, units: value.units.filter((r) => !sameRef(r, u.ref)) })}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {units.length === 0 && cat !== OTHER && (
                    <button className="spec-column-empty" onClick={() => props.onAddUnits(cat)}>
                      {t(lang, 'addUnits')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="spec-actions">
            {notice && (
              <span className={notice.kind === 'error' ? 'saved-error' : 'cloud-ok'}>
                {t(lang, notice.key)}
                {notice.detail ? `: ${notice.detail}` : ''}
              </span>
            )}
            <span className="spec-actions-spacer" />
            <button disabled={!dirty || saving} onClick={props.onRevert}>
              {t(lang, 'revertChanges')}
            </button>
            <button className="primary" disabled={!dirty || saving} onClick={props.onSave}>
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
          <div className="picker-tabs">
            <button className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}>
              {t(lang, 'cloudTitle')} <span className="picker-count">{cards.length}</span>
            </button>
            <button className={tab === 'units' ? 'active' : ''} onClick={() => setTab('units')}>
              {t(lang, 'pickerGameUnits')}
            </button>
          </div>
          <button className="primary" onClick={props.onClose}>
            {t(lang, 'done')}
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
                {it.thumb ? <img src={it.thumb} alt="" /> : <span className="spec-unit-noimg" />}
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
