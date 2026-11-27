import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import { cloudEnabled } from '../cloud/config'
import { specsByCard } from '../cloud/specs'
import { parseSavedCardFile } from '../state/savedCards'
import { exportSavedCardJson } from '../export/exportJson'
import { SpecChips } from './SpecChips'
import { UnitCategoryLocKey, UnitCategoryType } from '../data/enums'
import { t } from './i18n'

/**
 * Card maker, right sidebar top: where the displayed card lives (the online
 * library, or nowhere yet), saving it there, JSON export/import, and which
 * specializations it is in. Saving and specializations need a login.
 */
export function CardPanel() {
  const lang = useAppStore((s) => s.lang)
  const card = useAppStore((s) => s.card)
  const db = useAppStore((s) => s.db)
  const updateCard = useAppStore((s) => s.updateCard)
  const compact = useAppStore((s) => s.compact)
  const style = useAppStore((s) => s.style)
  const selection = useAppStore((s) => s.selection)
  const dirty = useAppStore((s) => s.dirty)
  const authed = useAppStore((s) => s.authed)
  const cloudLinked = useAppStore((s) => s.cloudLinked)
  const cloudCards = useAppStore((s) => s.cloudCards)
  const cloudBusy = useAppStore((s) => s.cloudBusy)
  const cloudNotice = useAppStore((s) => s.cloudNotice)
  const specs = useAppStore((s) => s.specs)
  const specsLoading = useAppStore((s) => s.specsLoading)
  const specsNotice = useAppStore((s) => s.specsNotice)
  const specBusy = useAppStore((s) => s.specBusy)
  const pendingSpecIds = useAppStore((s) => s.pendingSpecIds)
  const saveCloudCard = useAppStore((s) => s.saveCloudCard)
  const setCardSpecs = useAppStore((s) => s.setCardSpecs)
  const togglePendingSpec = useAppStore((s) => s.togglePendingSpec)
  const refreshSpecs = useAppStore((s) => s.refreshSpecs)
  const openAuth = useAppStore((s) => s.openAuth)
  const openCardFile = useAppStore((s) => s.openCardFile)
  const file = useRef<HTMLInputElement>(null)
  const [badFile, setBadFile] = useState(false)

  const online = cloudEnabled()
  // (a failed load is not retried in a loop; the page's Refresh does that)
  useEffect(() => {
    if (online && authed && !specs && !specsLoading && !specsNotice) void refreshSpecs()
  }, [online, authed, specs, specsLoading, specsNotice, refreshSpecs])

  const linkedSpecIds = useMemo(
    () => (cloudLinked ? (specsByCard(specs).get(cloudLinked.id.toLowerCase()) ?? []) : []),
    [specs, cloudLinked],
  )

  if (!card) return null
  const meta = cloudLinked ? cloudCards.find((c) => c.id === cloudLinked.id) : undefined
  const selected = cloudLinked ? linkedSpecIds : pendingSpecIds

  const toggle = (specId: number) => {
    if (!cloudLinked) return togglePendingSpec(specId)
    const next = selected.includes(specId) ? selected.filter((id) => id !== specId) : [...selected, specId]
    void setCardSpecs(cloudLinked.id, next)
  }
  const exportJson = () =>
    exportSavedCardJson({
      id: '',
      name: card.name.trim() || 'Untitled',
      savedAt: Date.now(),
      compact,
      style,
      selection,
      card,
    })

  return (
    <div className="card-panel">
      <h3>{t(lang, 'cardPanelTitle')}</h3>
      <div className={`card-source ${cloudLinked ? 'online' : ''}`}>
        <span className="card-source-kind">{t(lang, cloudLinked ? 'cardIsOnline' : 'cardNotOnline')}</span>
        {meta && (
          <span className="card-source-meta">
            {meta.author || '—'}
            {meta.editor && meta.editor !== meta.author ? ` · ${t(lang, 'lastSavedBy')} ${meta.editor}` : ''}
            {` · ${new Date(meta.updated_at).toLocaleDateString()}`}
          </span>
        )}
        {dirty && <span className="spec-dirty">{t(lang, 'specUnsaved')}</span>}
      </div>

      <label className="card-category">
        <span>{t(lang, 'cardCategory')}</span>
        <select
          value={card.category ?? (card.unitId != null ? (db?.units.get(card.unitId)?.CategoryType ?? '') : '')}
          onChange={(e) =>
            updateCard((c) => {
              if (e.target.value === '') delete c.category
              else c.category = Number(e.target.value)
            })
          }
        >
          {card.unitId == null && card.category == null && <option value="">—</option>}
          {[0, 1, 2, 3, 5, 6].map((cat) => (
            <option key={cat} value={cat}>
              {db?.locOr(UnitCategoryLocKey[cat], UnitCategoryType[cat] ?? String(cat))}
            </option>
          ))}
        </select>
      </label>

      {online && authed && (
        <div className="card-save">
          <button className="card-save-main" disabled={cloudBusy} onClick={() => void saveCloudCard(false)}>
            {t(lang, cloudLinked ? 'cloudUpdate' : 'cloudSave')}
          </button>
          {cloudLinked && (
            <button disabled={cloudBusy} onClick={() => void saveCloudCard(true)}>
              {t(lang, 'cloudSaveAsNew')}
            </button>
          )}
        </div>
      )}
      <div className="card-save">
        <button onClick={exportJson}>{t(lang, 'exportJson')}</button>
        <button onClick={() => file.current?.click()}>{t(lang, 'importJson')}</button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const entry = parseSavedCardFile(await f.text())
          setBadFile(!entry)
          if (entry) openCardFile(entry)
        }}
      />
      {badFile && <div className="saved-error">{t(lang, 'importFailed')}</div>}
      {cloudBusy && <div className="saved-hint">{t(lang, 'cloudWorking')}</div>}
      {cloudNotice && (
        <div className={cloudNotice.kind === 'error' ? 'saved-error' : 'cloud-ok'}>
          {t(lang, cloudNotice.key)}
          {cloudNotice.detail ? `: ${cloudNotice.detail}` : ''}
        </div>
      )}

      {online && !authed && (
        <div className="card-login-hint">
          <button className="cloud-link" onClick={() => openAuth('login')}>
            {t(lang, 'loginOrRegister')}
          </button>{' '}
          {t(lang, 'cardLoginHint')}
        </div>
      )}

      {online && authed && (
        <div className="card-specs">
          <div className="card-specs-title">
            <h4>{t(lang, 'cardSpecsTitle')}</h4>
          </div>
          {specs ? (
            <SpecChips specs={specs} selected={selected} disabled={specBusy || cloudBusy} onToggle={toggle} />
          ) : specsNotice ? (
            <div className="saved-error">
              {t(lang, specsNotice.key)}
              {specsNotice.detail ? `: ${specsNotice.detail}` : ''}{' '}
              <button className="cloud-link" onClick={() => void refreshSpecs()}>
                {t(lang, 'refresh')}
              </button>
            </div>
          ) : (
            <div className="saved-hint">{t(lang, 'specsLoading')}</div>
          )}
        </div>
      )}
    </div>
  )
}
