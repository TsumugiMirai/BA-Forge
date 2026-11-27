import { useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { normalizeSearch } from '../armory/search'
import { t } from './i18n'

export interface PickerItem {
  /** identifier passed back to onPick */
  key: string
  label: string
  url: string | null
  /** smaller second line (e.g. the weapon type) */
  sub?: string
  /** PickerGroup key, for the category tabs */
  group?: string
  /** more text the search matches (file names, English names…) */
  search?: string
}

export interface PickerGroup {
  key: string
  label: string
}

interface Props {
  title: string
  items: PickerItem[]
  /** category tabs; groups without items are left out */
  groups?: PickerGroup[]
  /** extra class on the grid icons (e.g. mirrored weapon silhouettes) */
  iconClassName?: string
  /** a library item was chosen */
  onPick(key: string): void
  /** a local image was uploaded (data URL); no upload button without it */
  onUpload?(dataUrl: string): void
  /** clear the slot (only for slots that can be emptied, e.g. tag icons) */
  onClear?(): void
  onCancel(): void
}

/**
 * Modal for filling an icon slot: search + pick from a library grid (by
 * category when the library has them), or upload a custom image. Used for
 * weapon and ammo slots, tag icons and modification icons.
 */
export function PickerDialog({ title, items, groups, iconClassName, onPick, onUpload, onClear, onCancel }: Props) {
  const lang = useAppStore((s) => s.lang)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) if (it.group) m.set(it.group, (m.get(it.group) ?? 0) + 1)
    return m
  }, [items])
  const haystacks = useMemo(
    () => new Map(items.map((it) => [it.key, normalizeSearch(`${it.label}|${it.sub ?? ''}|${it.search ?? ''}`)])),
    [items],
  )

  const words = query.split(/\s+/).map(normalizeSearch).filter(Boolean)
  const filtered = items.filter(
    (it) =>
      (group == null || it.group === group) &&
      (words.length === 0 || words.every((w) => haystacks.get(it.key)?.includes(w))),
  )
  const shownGroups = groups?.filter((g) => counts.has(g.key)) ?? []

  return (
    <div className="crop-overlay" onClick={onCancel}>
      <div className="picker-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-dialog-head">
          <h3>{title}</h3>
          <button className="picker-dialog-close" onClick={onCancel} title={t(lang, 'close')}>
            ×
          </button>
        </div>
        <input
          className="picker-search"
          placeholder={t(lang, 'search')}
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        {shownGroups.length > 0 && (
          <div className="picker-groups">
            <button className={group == null ? 'active' : ''} onClick={() => setGroup(null)}>
              {t(lang, 'allCategories')}
            </button>
            {shownGroups.map((g) => (
              <button key={g.key} className={group === g.key ? 'active' : ''} onClick={() => setGroup(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
        )}
        <div className="picker-dialog-grid">
          {filtered.map((it) => (
            <button key={it.key} className="picker-icon-cell" title={it.sub ? `${it.label}\n${it.sub}` : it.label} onClick={() => onPick(it.key)}>
              {it.url ? (
                <img className={`picker-icon-img ${iconClassName ?? ''}`} src={it.url} alt="" loading="lazy" />
              ) : (
                <span className="picker-icon-img" />
              )}
              <span className="picker-icon-label">{it.label}</span>
              {it.sub && <span className="picker-icon-sub">{it.sub}</span>}
            </button>
          ))}
          {filtered.length === 0 && <div className="picker-empty">{t(lang, 'noMatches')}</div>}
        </div>
        <div className="picker-dialog-actions">
          {onUpload && <button onClick={() => fileInput.current?.click()}>{t(lang, 'uploadImage')}</button>}
          {onClear && <button onClick={onClear}>{t(lang, 'clear')}</button>}
          <span style={{ flex: 1 }} />
          <span className="picker-count">{filtered.length}</span>
          <button onClick={onCancel}>{t(lang, 'cancel')}</button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => onUpload?.(String(reader.result))
            reader.readAsDataURL(file)
          }}
        />
      </div>
    </div>
  )
}
