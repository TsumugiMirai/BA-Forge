import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { thumbnailUrl } from '../assets'
import { UnitCategoryLocKey, UnitCategoryType } from '../data/enums'
import type { GameDb } from '../data/db'
import type { CloudCardMeta } from '../cloud/cloudCards'
import { cardCategory } from '../cloud/cloudCards'
import { CloudAuthError, CloudConflictError, CloudHttpError } from '../cloud/rest'
import type { SpecInput, SpecRow, SpecUnitRef } from '../cloud/specs'
import { createSpec, deleteSpec, saveSpec } from '../cloud/specs'
import { cloudEnabled } from '../cloud/config'
import { AuthGate } from '../auth/AuthForm'
import { CardViewer } from '../ui/CardViewer'
import { normalizeSearch } from '../armory/search'
import { t, type UiStringKey } from '../ui/i18n'
import '../armory/armory.css'
import './specs.css'

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
  return {
    name: row.name,
    icon: row.icon,
    description: row.description,
    units: row.units ?? [],
    points: row.points ?? {},
    faction: row.faction ?? '',
  }
}

const sameRef = (a: SpecUnitRef, b: SpecUnitRef) => a.source === b.source && a.id === b.id
const refKey = (r: SpecUnitRef) => `${r.source}:${r.id}`

/** `units` with `moved` taken out and put just before/after `target` */
function moveRef(units: SpecUnitRef[], moved: SpecUnitRef, target: SpecUnitRef, side: 'before' | 'after') {
  const rest = units.filter((u) => !sameRef(u, moved))
  const at = rest.findIndex((u) => sameRef(u, target))
  if (at < 0) return units
  rest.splice(side === 'before' ? at : at + 1, 0, moved)
  return rest
}

/** first number of a card's cost text ("250", "250 pts") */
function costNumber(text: string | null | undefined): number | null {
  const m = /-?\d+(?:\.\d+)?/.exec(text ?? '')
  return m ? Number(m[0]) : null
}

interface ResolvedUnit {
  ref: SpecUnitRef
  name: string
  thumb: string | null
  category: number
  cost: number | null
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
      thumb: meta?.icon || thumbnailUrl(unit?.ThumbnailFileName ?? null),
      category: (meta && cardCategory(meta, unit?.CategoryType)) ?? OTHER,
      cost: costNumber(meta?.cost) ?? unit?.Cost ?? null,
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
    cost: unit?.Cost ?? null,
    custom: false,
    missing: !unit,
  }
}

function categoryName(db: GameDb, lang: 'eng' | 'chi', cat: number): string {
  return cat === OTHER ? t(lang, 'categoryOther') : db.locOr(UnitCategoryLocKey[cat], UnitCategoryType[cat] ?? String(cat))
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
 * Custom specializations (#specs): the list on the left, grouped by nation,
 * and the chosen one laid out like the game's deck screen — one row per
 * arsenal category with its point limit on the left and its units (with
 * their cost) to the right. Anyone logged in can add a specialization; each
 * is saved online on its own. Unsaved edits live in the store, so they
 * survive a trip to the card maker.
 */
export function SpecsPage() {
  const lang = useAppStore((s) => s.lang)
  const db = useAppStore((s) => s.db)
  const authed = useAppStore((s) => s.authed)
  const account = useAppStore((s) => s.account)
  const cloudCards = useAppStore((s) => s.cloudCards)
  const refreshCloud = useAppStore((s) => s.refreshCloud)
  const specs = useAppStore((s) => s.specs)
  const loading = useAppStore((s) => s.specsLoading)
  const pageNotice = useAppStore((s) => s.specsNotice)
  const refreshSpecs = useAppStore((s) => s.refreshSpecs)
  const replaceSpec = useAppStore((s) => s.replaceSpec)
  const dropSpec = useAppStore((s) => s.dropSpec)
  const guardEdits = useAppStore((s) => s.guardEdits)
  const drafts = useAppStore((s) => s.chinaDrafts)
  const setDrafts = useAppStore((s) => s.setChinaDrafts)
  const selected = useAppStore((s) => s.specSelected)
  const selectSpec = useAppStore((s) => s.selectSpec)

  const [notice, setNotice] = useState<Notice | null>(null)
  const [saving, setSaving] = useState(false)
  const [picker, setPicker] = useState<number | null | undefined>(undefined)
  const [viewing, setViewing] = useState<SpecUnitRef | null>(null)
  const [editingInfo, setEditingInfo] = useState(false)

  useEffect(() => {
    if (!authed || !cloudEnabled()) return
    void refreshSpecs()
    void refreshCloud()
  }, [authed, refreshSpecs, refreshCloud])

  const cardsById = useMemo(() => new Map(cloudCards.map((c) => [c.id, c])), [cloudCards])

  // specializations by nation, in list order
  const byFaction = useMemo(() => {
    const groups = new Map<string, SpecRow[]>()
    for (const s of specs ?? []) {
      const f = (drafts[s.id]?.value.faction ?? s.faction ?? '').trim()
      const list = groups.get(f)
      if (list) list.push(s)
      else groups.set(f, [s])
    }
    return [...groups.entries()]
  }, [specs, drafts])

  const row = specs?.find((s) => s.id === selected) ?? specs?.[0]
  // a specialization just added opens with its name and nation to fill in
  const justAdded = useRef<number | null>(null)
  useEffect(() => {
    setNotice(null)
    setEditingInfo(row != null && row.id === justAdded.current)
    justAdded.current = null
  }, [row?.id])

  if (!authed)
    return (
      <div className="specs-page single">
        <AuthGate reason="authGateChina" />
      </div>
    )
  if (!db) return null

  const value = row ? (drafts[row.id]?.value ?? inputOf(row)) : null
  const dirty = !!row && !!drafts[row.id]

  const edit = (next: SpecInput) => {
    if (!row) return
    setDrafts((d) => ({ ...d, [row.id]: { value: next, version: d[row.id]?.version ?? row.version } }))
    setNotice(null)
  }
  const revert = () => {
    if (!row) return
    setDrafts((d) => {
      const { [row.id]: _, ...rest } = d
      return rest
    })
    setNotice(null)
    void refreshSpecs()
  }
  const failure = (e: unknown): Notice | null => {
    if (e instanceof CloudAuthError) return null
    if (e instanceof CloudConflictError) return { kind: 'error', key: 'specConflict' }
    if (e instanceof CloudHttpError && e.reason === 'not_owner') return { kind: 'error', key: 'specNotOwner' }
    return { kind: 'error', key: 'cloudFailed', detail: e instanceof Error ? e.message : String(e) }
  }
  const save = async () => {
    if (!row) return
    const draft = drafts[row.id]
    if (!draft) return
    setSaving(true)
    try {
      const saved = await saveSpec(row.id, draft.version, { ...draft.value, name: draft.value.name.trim() || row.name })
      replaceSpec(saved)
      setDrafts((d) => {
        const { [row.id]: _, ...rest } = d
        return rest
      })
      setNotice({ kind: 'ok', key: 'specSaved' })
    } catch (e) {
      setNotice(failure(e))
    } finally {
      setSaving(false)
    }
  }
  const add = async () => {
    setSaving(true)
    try {
      const created = await createSpec({
        name: t(lang, 'newSpecName'),
        icon: null,
        description: '',
        units: [],
        points: {},
        faction: value?.faction ?? '',
      })
      justAdded.current = created.id
      replaceSpec(created)
      selectSpec(created.id)
    } catch (e) {
      setNotice(failure(e))
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!row || !window.confirm(`${t(lang, 'deleteSpecConfirm')}\n${value?.name || row.name}`)) return
    setSaving(true)
    try {
      await deleteSpec(row.id)
      dropSpec(row.id)
    } catch (e) {
      setNotice(failure(e))
    } finally {
      setSaving(false)
    }
  }
  const canDelete = !!row && (account?.role === 'admin' || (!!row.created_by && row.created_by === account?.username))
  const factions = byFaction.map(([f]) => f).filter(Boolean)

  return (
    <div className="specs-page">
      <aside className="specs-list">
        <div className="specs-list-head">
          <h2>{t(lang, 'navChina')}</h2>
          <button className="spec-button" disabled={saving} onClick={() => void add()}>
            {t(lang, 'newSpec')}
          </button>
        </div>
        {loading && !specs && <div className="saved-hint">{t(lang, 'cloudLoading')}</div>}
        {pageNotice && (
          <div className="saved-error">
            {t(lang, pageNotice.key)}
            {pageNotice.detail ? `: ${pageNotice.detail}` : ''}
          </div>
        )}
        {byFaction.map(([faction, list]) => (
          <div key={faction} className="specs-faction">
            {faction && <div className="specs-faction-name">{faction}</div>}
            {list.map((s) => {
              const v = drafts[s.id]?.value
              return (
                <button
                  key={s.id}
                  className={`specs-item ${s.id === row?.id ? 'active' : ''}`}
                  onClick={() => selectSpec(s.id)}
                >
                  <SpecEmblem name={v?.name ?? s.name} icon={v ? v.icon : s.icon} size={30} />
                  <span className="specs-item-name">{(v?.name ?? s.name) || `#${s.id}`}</span>
                  {drafts[s.id] && <span className="specs-item-dirty" title={t(lang, 'specUnsaved')} />}
                </button>
              )
            })}
          </div>
        ))}
      </aside>

      <main className="specs-main">
        {row && value && (
          <SpecDeck
            key={row.id}
            row={row}
            value={value}
            dirty={dirty}
            saving={saving}
            notice={notice}
            db={db}
            cardsById={cardsById}
            factions={factions}
            editingInfo={editingInfo}
            canDelete={canDelete}
            onEditInfo={setEditingInfo}
            onChange={edit}
            onSave={() => void save()}
            onRevert={revert}
            onDelete={() => void remove()}
            onAddUnits={(category) => setPicker(category)}
            onOpenUnit={(ref) => guardEdits(() => setViewing(ref))}
          />
        )}
      </main>

      {row && value && picker !== undefined && (
        <AddUnitsDialog
          db={db}
          cards={cloudCards}
          specName={value.name}
          selected={value.units}
          initialCategory={picker}
          onToggle={(ref) => {
            const has = value.units.some((u) => sameRef(u, ref))
            edit({ ...value, units: has ? value.units.filter((u) => !sameRef(u, ref)) : [...value.units, ref] })
          }}
          onClose={() => setPicker(undefined)}
        />
      )}
      {viewing && <CardViewer unitRef={viewing} returnTo="china" onClose={() => setViewing(null)} />}
    </div>
  )
}

function SpecDeck(props: {
  row: SpecRow
  value: SpecInput
  dirty: boolean
  saving: boolean
  notice: Notice | null
  db: GameDb
  cardsById: Map<string, CloudCardMeta>
  factions: string[]
  editingInfo: boolean
  canDelete: boolean
  onEditInfo(on: boolean): void
  onChange(next: SpecInput): void
  onSave(): void
  onRevert(): void
  onDelete(): void
  onAddUnits(category: number | null): void
  onOpenUnit(ref: SpecUnitRef): void
}) {
  const { row, value, dirty, saving, notice, db, cardsById, onChange } = props
  const lang = useAppStore((s) => s.lang)
  const fileInput = useRef<HTMLInputElement>(null)
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
  const setPoints = (cat: number, text: string) => {
    const next = { ...value.points }
    const n = Math.round(Number(text))
    if (text.trim() === '' || !Number.isFinite(n) || n < 0) delete next[cat]
    else next[cat] = n
    onChange({ ...value, points: next })
  }

  return (
    <div className="spec-deck">
      <div className="spec-deck-head">
        <button
          className="spec-deck-emblem"
          title={t(lang, 'changeIcon')}
          onClick={() => (props.editingInfo ? fileInput.current?.click() : props.onEditInfo(true))}
        >
          <SpecEmblem name={value.name} icon={value.icon} size={52} />
        </button>
        <div className="spec-deck-title">
          {props.editingInfo ? (
            <div className="spec-deck-fields">
              <input
                className="cloud-input spec-name"
                aria-label={t(lang, 'specName')}
                placeholder={t(lang, 'specName')}
                value={value.name}
                maxLength={40}
                autoFocus
                onChange={(e) => onChange({ ...value, name: e.target.value })}
              />
              <input
                className="cloud-input spec-faction"
                aria-label={t(lang, 'specFaction')}
                placeholder={t(lang, 'specFaction')}
                value={value.faction}
                maxLength={24}
                list="spec-factions"
                onChange={(e) => onChange({ ...value, faction: e.target.value })}
              />
              <datalist id="spec-factions">
                {props.factions.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
          ) : (
            <h2>
              {value.name || `#${row.id}`}
              {value.faction && <span className="spec-deck-faction">{value.faction}</span>}
            </h2>
          )}
          {props.editingInfo ? (
            <textarea
              className="cloud-input spec-description"
              aria-label={t(lang, 'specDescription')}
              placeholder={t(lang, 'specDescription')}
              value={value.description}
              rows={2}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
            />
          ) : (
            value.description && <p className="spec-deck-desc">{value.description}</p>
          )}
        </div>
        <div className="spec-deck-actions">
          {props.editingInfo && (
            <>
              <button className="spec-button" onClick={() => fileInput.current?.click()}>
                {t(lang, 'changeIcon')}
              </button>
              {value.icon && (
                <button className="spec-button" onClick={() => onChange({ ...value, icon: null })}>
                  {t(lang, 'removeIcon')}
                </button>
              )}
              {props.canDelete && (
                <button className="spec-button danger" disabled={saving} onClick={props.onDelete}>
                  {t(lang, 'delete')}
                </button>
              )}
            </>
          )}
          <button className={`spec-button ${props.editingInfo ? 'active' : ''}`} onClick={() => props.onEditInfo(!props.editingInfo)}>
            {props.editingInfo ? t(lang, 'done') : t(lang, 'editSpecInfo')}
          </button>
          {dirty && (
            <button className="spec-button" disabled={saving} onClick={props.onRevert}>
              {t(lang, 'revertChanges')}
            </button>
          )}
          <button className="spec-button primary" disabled={!dirty || saving} onClick={props.onSave}>
            {saving ? t(lang, 'cloudWorking') : t(lang, 'save')}
          </button>
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
      {notice && (
        <div className={`spec-deck-notice ${notice.kind === 'error' ? 'saved-error' : 'cloud-ok'}`}>
          {t(lang, notice.key)}
          {notice.detail ? `: ${notice.detail}` : ''}
        </div>
      )}

      <div className="spec-rows">
        {groups.map(([cat, units]) => (
          <div key={cat} className="spec-cat">
            <div className="spec-cat-side">
              <span className="spec-cat-title">{categoryName(db, lang, cat)}</span>
              {cat !== OTHER && (
                <input
                  className="spec-cat-cap"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={50}
                  placeholder="—"
                  aria-label={t(lang, 'points')}
                  value={value.points[cat] ?? ''}
                  onChange={(e) => setPoints(cat, e.target.value)}
                />
              )}
            </div>
            <div
              className="spec-cat-units"
              onDragOver={(e) => {
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
              {units.map((u) => {
                const key = refKey(u.ref)
                const dropSide = dropAt?.key === key ? dropAt.side : null
                return (
                  <div
                    key={key}
                    className={[
                      'spec-unit',
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
                    <button className="armory-tile" title={u.name} disabled={u.missing} onClick={() => props.onOpenUnit(u.ref)}>
                      {u.cost != null && <span className="armory-tile-cost">{u.cost}</span>}
                      {u.thumb ? (
                        <img className="armory-tile-img" src={u.thumb} alt="" draggable={false} />
                      ) : (
                        <span className="armory-tile-img placeholder" />
                      )}
                      <span className="armory-tile-name">{u.name}</span>
                    </button>
                    {u.custom && !u.missing && <span className="spec-unit-mark" title={t(lang, 'customCard')} />}
                    <button
                      className="spec-unit-remove"
                      title={t(lang, 'remove')}
                      onClick={() => onChange({ ...value, units: value.units.filter((r) => !sameRef(r, u.ref)) })}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
              {cat !== OTHER && (
                <button className="spec-unit-add" title={t(lang, 'addUnits')} onClick={() => props.onAddUnits(cat)}>
                  +
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
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
  const words = query.split(/\s+/).map(normalizeSearch).filter(Boolean)
  const matches = (text: string) => {
    const hay = normalizeSearch(text)
    return words.every((w) => hay.includes(w))
  }

  const items = useMemo(() => {
    if (tab === 'cards')
      return cards
        .map((c) => ({ c, unit: c.unit_id != null ? db.units.get(c.unit_id) : undefined }))
        .filter(({ c, unit }) => category == null || cardCategory(c, unit?.CategoryType) === category)
        .filter(({ c, unit }) => matches(`${c.name}|${c.author}|${unit?.HUDName ?? ''}`))
        .map(({ c, unit }) => ({
          ref: { source: 'card', id: c.id } as SpecUnitRef,
          name: c.name,
          sub: c.author,
          cost: costNumber(c.cost) ?? unit?.Cost ?? null,
          thumb: c.icon || thumbnailUrl(unit?.ThumbnailFileName ?? null),
        }))
    return db
      .armoryUnits()
      .filter((u) => category == null || u.CategoryType === category)
      .filter((u) => matches(db.unitSearchText(u.Id)))
      .sort((a, b) => a.CategoryType - b.CategoryType || (a.HUDName ?? '').localeCompare(b.HUDName ?? ''))
      .map((u) => ({
        ref: { source: 'unit', id: u.Id } as SpecUnitRef,
        name: u.HUDName ?? u.Name ?? `#${u.Id}`,
        sub: '',
        cost: u.Cost,
        thumb: thumbnailUrl(u.ThumbnailFileName),
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, query, category, cards, db, lang])

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
        <div className="picker-groups">
          <button className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}>
            {t(lang, 'cloudTitle')} <span className="picker-count">{cards.length}</span>
          </button>
          <button className={tab === 'units' ? 'active' : ''} onClick={() => setTab('units')}>
            {t(lang, 'navUnits')}
          </button>
        </div>
        <div className="picker-groups">
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
        <div className="add-units-grid">
          {items.length === 0 && <div className="saved-hint">{t(lang, 'noMatches')}</div>}
          {items.map((it) => {
            const on = selected.some((s) => sameRef(s, it.ref))
            return (
              <button
                key={`${it.ref.source}:${it.ref.id}`}
                className={`armory-tile ${on ? 'active' : ''}`}
                title={it.sub ? `${it.name}\n${it.sub}` : it.name}
                onClick={() => props.onToggle(it.ref)}
              >
                {it.cost != null && <span className="armory-tile-cost">{it.cost}</span>}
                {on && <span className="add-units-check">✓</span>}
                {it.thumb ? (
                  <img className="armory-tile-img" src={it.thumb} alt="" loading="lazy" />
                ) : (
                  <span className="armory-tile-img placeholder" />
                )}
                <span className="armory-tile-name">{it.name}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
