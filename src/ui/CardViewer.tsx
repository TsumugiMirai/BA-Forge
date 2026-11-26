import { useEffect, useState } from 'react'
import type { View } from '../state/store'
import { useAppStore } from '../state/store'
import type { SpecUnitRef } from '../cloud/specs'
import { UnitCard } from '../card/UnitCard'
import { t } from './i18n'

/**
 * A unit's card shown on top of the page it was clicked on (the China page):
 * look at it in compact or expanded form, edit an online card in place and
 * save it, or open it in the card maker, whose back button returns to that
 * page. The card shown is the card maker's current card, so callers guard
 * unsaved edits (guardEdits) before opening this.
 */
export function CardViewer({ unitRef, returnTo, onClose }: { unitRef: SpecUnitRef; returnTo: View; onClose(): void }) {
  const lang = useAppStore((s) => s.lang)
  const card = useAppStore((s) => s.card)
  const compact = useAppStore((s) => s.compact)
  const editMode = useAppStore((s) => s.editMode)
  const dirty = useAppStore((s) => s.dirty)
  const cloudBusy = useAppStore((s) => s.cloudBusy)
  const notice = useAppStore((s) => s.cloudNotice)
  const loadCloudCard = useAppStore((s) => s.loadCloudCard)
  const selectUnit = useAppStore((s) => s.selectUnit)
  const setCompact = useAppStore((s) => s.setCompact)
  const setEditMode = useAppStore((s) => s.setEditMode)
  const saveCloudCard = useAppStore((s) => s.saveCloudCard)
  const setView = useAppStore((s) => s.setView)
  const setReturnView = useAppStore((s) => s.setReturnView)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [closing, setClosing] = useState(false)
  const custom = unitRef.source === 'card'

  const load = async () => {
    if (unitRef.source === 'card') return loadCloudCard(unitRef.id)
    selectUnit(unitRef.id)
    return true
  }

  useEffect(() => {
    let live = true
    setEditMode(false)
    setPhase('loading')
    void load().then((ok) => live && setPhase(ok ? 'ready' : 'failed'))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitRef])

  const finish = () => {
    setEditMode(false)
    onClose()
  }
  const requestClose = () => (dirty ? setClosing(true) : finish())
  const discard = async () => {
    await load()
    setClosing(false)
    finish()
  }
  const saveAndClose = async () => {
    if (await saveCloudCard(false)) {
      setClosing(false)
      finish()
    }
  }
  const openInMaker = () => {
    setReturnView(returnTo)
    onClose()
    setView('card')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="crop-overlay card-viewer-overlay" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="card-viewer" role="dialog" aria-label={card?.name}>
        <div className="card-viewer-bar">
          <div className="card-viewer-group">
            <button className={compact ? 'active' : ''} onClick={() => setCompact(true)}>
              {t(lang, 'compact')}
            </button>
            <button className={!compact ? 'active' : ''} onClick={() => setCompact(false)}>
              {t(lang, 'expanded')}
            </button>
          </div>
          <span className="card-viewer-spacer" />
          {custom ? (
            <>
              <button className={editMode ? 'active' : ''} disabled={phase !== 'ready'} onClick={() => setEditMode(!editMode)}>
                {editMode ? t(lang, 'editing') : t(lang, 'edit')}
              </button>
              <button className="primary" disabled={!dirty || cloudBusy} onClick={() => void saveCloudCard(false)}>
                {cloudBusy ? t(lang, 'cloudWorking') : t(lang, 'save')}
              </button>
            </>
          ) : (
            <button disabled={phase !== 'ready'} onClick={openInMaker}>
              {t(lang, 'edit')}
            </button>
          )}
          <button disabled={phase !== 'ready'} onClick={openInMaker}>
            {t(lang, 'openInMaker')}
          </button>
          <button className="card-viewer-close" title={t(lang, 'close')} onClick={requestClose}>
            ×
          </button>
        </div>
        {closing && (
          <div className="card-viewer-confirm">
            <span>{t(lang, 'specUnsaved')}</span>
            <button className="primary" disabled={cloudBusy} onClick={() => void saveAndClose()}>
              {t(lang, 'saveAndClose')}
            </button>
            <button className="danger" disabled={cloudBusy} onClick={() => void discard()}>
              {t(lang, 'discard')}
            </button>
            <button onClick={() => setClosing(false)}>{t(lang, 'cancel')}</button>
          </div>
        )}
        {notice && (
          <div className={`card-viewer-notice ${notice.kind === 'error' ? 'saved-error' : 'cloud-ok'}`}>
            {t(lang, notice.key)}
            {notice.detail ? `: ${notice.detail}` : ''}
          </div>
        )}
        <div className="card-viewer-body">
          {phase === 'ready' && card ? (
            <UnitCard card={card} />
          ) : phase === 'loading' ? (
            <div className="saved-hint">{t(lang, 'cloudLoading')}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
