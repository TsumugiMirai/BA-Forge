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

function resolveRef(db: GameDb, cards: Map<string, CloudCardMeta>, ref: SpecUnitRef, lang: 'eng' | 'chi'): ResolvedUnit {
  if (ref.source === 'card') {
    const meta = cards.get(ref.id)
    const unit = meta?.unit_id != null ? db.units.get(meta.unit_id) : undefined
    return {
      ref,
      name: meta?.name ?? t(lang, 'deletedCard'),
      thumb: thumbnailUrl(unit?.ThumbnailFileName ?? null),
      category: unit?.CategoryType ?? -1,
      custom: true,
      missing: !meta,
    }
  }
  const unit = db.units.get(ref.id)
  return {
    ref,
    name: unit?.HUDName ?? unit?.Name ?? `#${ref.id}`,
    thumb: thumbnailUrl(unit?.ThumbnailFileName ?? null),
    category: unit?.CategoryType ?? -1,
    custom: false,
    missing: !unit,
  }
}

/**
 * The China specialization setup page (#china): six preset specializations,
 * each with a name, icon, description and assigned units (online library
 * cards or stock game units), saved online in the `specs` table.
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
  const [loading, setLoading] = useState(false)
  const [pageNotice, setPageNotice] = useState<Notice | null>(null)
  const [pickerFor, setPickerFor] = useState<number | null>(null)

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

  const pickerSpec = specs?.find((s) => s.id === pickerFor)
  const pickerInput = pickerSpec ? (drafts[pickerSpec.id] ?? inputOf(pickerSpec)) : null

  return (
    <div className="china-page">
      <div className="china-header">
        <div>
          <h2>{t(lang, 'chinaTitle')}</h2>
          <div className="saved-hint">{t(lang, 'chinaHint')}</div>
        </div>
        <div className="china-header-actions">
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
      <div className="spec-grid">
        {specs?.map((row) => (
          <SpecEditor
            key={row.id}
            row={row}
            value={drafts[row.id] ?? inputOf(row)}
            dirty={!!drafts[row.id]}
            saving={!!saving[row.id]}
            notice={notices[row.id]}
            db={db}
            cardsById={cardsById}
            onChange={(next) => edit(row.id, next)}
            onSave={() => void save(row)}
            onRevert={() => revert(row.id)}
            onAddUnits={() => setPickerFor(row.id)}
            onOpenUnit={openUnit}
          />
        ))}
      </div>
      {pickerSpec && pickerInput && (
        <AddUnitsDialog
          db={db}
          cards={cloudCards}
          selected={pickerInput.units}
          onToggle={(ref) => {
            const has = pickerInput.units.some((u) => sameRef(u, ref))
            edit(pickerSpec.id, {
              ...pickerInput,
              units: has ? pickerInput.units.filter((u) => !sameRef(u, ref)) : [...pickerInput.units, ref],
            })
          }}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  )
}

function SpecEditor(props: {
  row: SpecRow
  value: SpecInput
  dirty: boolean
  saving: boolean
  notice: Notice | undefined
  db: GameDb
  cardsById: Map<string, CloudCardMeta>
  onChange(next: SpecInput): void
  onSave(): void
  onRevert(): void
  onAddUnits(): void
  onOpenUnit(ref: SpecUnitRef): void
}) {
  const { row, value, dirty, saving, notice, db, cardsById, onChange } = props
  const lang = useAppStore((s) => s.lang)
  const fileInput = useRef<HTMLInputElement>(null)

  // assigned units grouped by arsenal category, like a deck's columns
  const groups = useMemo(() => {
    const resolved = value.units.map((ref) => resolveRef(db, cardsById, ref, lang))
    const byCat = new Map<number, ResolvedUnit[]>()
    for (const u of resolved) {
      const list = byCat.get(u.category)
      if (list) list.push(u)
      else byCat.set(u.category, [u])
    }
    return [...byCat.entries()].sort(([a], [b]) => (a < 0 ? 99 : a) - (b < 0 ? 99 : b))
  }, [value.units, db, cardsById, lang])

  return (
    <section className={`spec-card ${dirty ? 'dirty' : ''}`}>
      <div className="spec-head">
        <button
          className="spec-icon"
          title={t(lang, 'changeIcon')}
          onClick={() => fileInput.current?.click()}
        >
          {value.icon ? <img src={value.icon} alt="" /> : <span>{(value.name || '?').slice(0, 1)}</span>}
        </button>
        <div className="spec-head-fields">
          <input
            className="cloud-input spec-name"
            aria-label={t(lang, 'specName')}
            value={value.name}
            maxLength={40}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
          <div className="spec-icon-actions">
            <button className="cloud-link" onClick={() => fileInput.current?.click()}>
              {t(lang, 'changeIcon')}
            </button>
            {value.icon && (
              <button className="cloud-link" onClick={() => onChange({ ...value, icon: null })}>
                {t(lang, 'removeIcon')}
              </button>
            )}
          </div>
        </div>
        <span className="spec-number">#{row.id}</span>
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
      <textarea
        className="cloud-input spec-description"
        aria-label={t(lang, 'specDescription')}
        placeholder={t(lang, 'specDescriptionHint')}
        value={value.description}
        rows={3}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
      />
      <div className="spec-units-head">
        <span>
          {t(lang, 'specUnits')} <span className="picker-count">{value.units.length}</span>
        </span>
        <button className="cloud-link" onClick={props.onAddUnits}>
          {t(lang, 'addUnits')}
        </button>
      </div>
      {groups.length === 0 && <div className="saved-hint">{t(lang, 'specNoUnits')}</div>}
      {groups.map(([cat, units]) => (
        <div key={cat} className="spec-group">
          <div className="spec-group-label">
            {cat >= 0 ? db.locOr(UnitCategoryLocKey[cat], UnitCategoryType[cat] ?? String(cat)) : t(lang, 'categoryOther')}
          </div>
          <div className="spec-unit-grid">
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
                  onClick={() =>
                    onChange({ ...value, units: value.units.filter((r) => !sameRef(r, u.ref)) })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="spec-actions">
        {dirty && <span className="spec-dirty">{t(lang, 'specUnsaved')}</span>}
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
    </section>
  )
}

/** Pick units for a specialization: custom cards from the online library or
 *  stock game units; clicking toggles a unit in or out. */
function AddUnitsDialog(props: {
  db: GameDb
  cards: CloudCardMeta[]
  selected: SpecUnitRef[]
  onToggle(ref: SpecUnitRef): void
  onClose(): void
}) {
  const { db, cards, selected } = props
  const lang = useAppStore((s) => s.lang)
  const [tab, setTab] = useState<'cards' | 'units'>(cards.length > 0 ? 'cards' : 'units')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const items = useMemo(() => {
    if (tab === 'cards')
      return cards
        .filter((c) => !q || `${c.name}\n${c.author}`.toLowerCase().includes(q))
        .map((c) => {
          const unit = c.unit_id != null ? db.units.get(c.unit_id) : undefined
          return {
            ref: { source: 'card', id: c.id } as SpecUnitRef,
            name: c.name,
            sub: [c.author, unit?.HUDName].filter(Boolean).join(' · '),
            thumb: thumbnailUrl(unit?.ThumbnailFileName ?? null),
          }
        })
    return db
      .armoryUnits()
      .filter((u) => !q || db.unitSearchText(u.Id).includes(q))
      .sort((a, b) => a.CategoryType - b.CategoryType || (a.HUDName ?? '').localeCompare(b.HUDName ?? ''))
      .map((u) => ({
        ref: { source: 'unit', id: u.Id } as SpecUnitRef,
        name: u.HUDName ?? u.Name ?? `#${u.Id}`,
        sub: db.locOr(UnitCategoryLocKey[u.CategoryType], UnitCategoryType[u.CategoryType] ?? ''),
        thumb: thumbnailUrl(u.ThumbnailFileName),
      }))
  }, [tab, q, cards, db])

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
