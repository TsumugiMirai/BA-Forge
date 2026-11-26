import { useEffect, useMemo } from 'react'
import { useAppStore } from '../state/store'
import { cloudEnabled } from '../cloud/config'
import { specsByCard } from '../cloud/specs'
import { SpecChips } from './SpecChips'
import { t } from './i18n'

/**
 * Card maker, right sidebar top: where the displayed card lives and how to
 * save it (this browser, or the online library), and which China
 * specializations it is in. Online saving and specializations need a login.
 */
export function CardPanel() {
  const lang = useAppStore((s) => s.lang)
  const card = useAppStore((s) => s.card)
  const dirty = useAppStore((s) => s.dirty)
  const authed = useAppStore((s) => s.authed)
  const cloudLinked = useAppStore((s) => s.cloudLinked)
  const cloudCards = useAppStore((s) => s.cloudCards)
  const cloudBusy = useAppStore((s) => s.cloudBusy)
  const cloudNotice = useAppStore((s) => s.cloudNotice)
  const saveError = useAppStore((s) => s.saveError)
  const specs = useAppStore((s) => s.specs)
  const specsLoading = useAppStore((s) => s.specsLoading)
  const specsNotice = useAppStore((s) => s.specsNotice)
  const specBusy = useAppStore((s) => s.specBusy)
  const pendingSpecIds = useAppStore((s) => s.pendingSpecIds)
  const saveCard = useAppStore((s) => s.saveCard)
  const saveCloudCard = useAppStore((s) => s.saveCloudCard)
  const setCardSpecs = useAppStore((s) => s.setCardSpecs)
  const togglePendingSpec = useAppStore((s) => s.togglePendingSpec)
  const refreshSpecs = useAppStore((s) => s.refreshSpecs)
  const openAuth = useAppStore((s) => s.openAuth)

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

      <div className="card-save">
        {online && authed && (
          <>
            <button className="card-save-main" disabled={cloudBusy} onClick={() => void saveCloudCard(false)}>
              {t(lang, cloudLinked ? 'cloudUpdate' : 'cloudSave')}
            </button>
            {cloudLinked && (
              <button disabled={cloudBusy} onClick={() => void saveCloudCard(true)}>
                {t(lang, 'cloudSaveAsNew')}
              </button>
            )}
          </>
        )}
        <button className={online && authed ? '' : 'card-save-main'} onClick={saveCard}>
          {t(lang, 'saveLocal')}
        </button>
      </div>
      {cloudBusy && <div className="saved-hint">{t(lang, 'cloudWorking')}</div>}
      {saveError && <div className="saved-error">{t(lang, 'saveFailed')}</div>}
      {cloudNotice && (
        <div className={cloudNotice.kind === 'error' ? 'saved-error' : 'cloud-ok'}>
          {t(lang, cloudNotice.key)}
          {cloudNotice.detail ? `: ${cloudNotice.detail}` : ''}
        </div>
      )}

      {online && !authed && (
        <div className="card-login-hint">
          {t(lang, 'cardLoginHint')}{' '}
          <button className="cloud-link" onClick={() => openAuth('login')}>
            {t(lang, 'loginOrRegister')}
          </button>
        </div>
      )}

      {online && authed && (
        <div className="card-specs">
          <div className="card-specs-title">
            <h4>{t(lang, 'cardSpecsTitle')}</h4>
            {selected.length === 0 && <span className="card-specs-state">{t(lang, 'filterUnassigned')}</span>}
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
          <div className="saved-hint">{t(lang, cloudLinked ? 'cardSpecsHintLinked' : 'cardSpecsHintPending')}</div>
        </div>
      )}
    </div>
  )
}
