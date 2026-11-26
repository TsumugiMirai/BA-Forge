import { useEffect, useRef, useState } from 'react'
import type { View } from './state/store'
import { useAppStore, viewFromHash } from './state/store'
import { UnitPicker } from './ui/UnitPicker'
import { VariantPanel } from './ui/VariantPanel'
import { ColorPanel } from './ui/ColorPanel'
import { CardPanel } from './ui/CardPanel'
import { AppHeader } from './ui/AppHeader'
import { CropDialog } from './ui/CropDialog'
import { UnitCard } from './card/UnitCard'
import { LogBoard } from './log/LogBoard'
import { logFileName } from './log/logModel'
import { exportCardPng, exportLogPng } from './export/exportPng'
import { ChinaSpecsPage } from './china/ChinaSpecsPage'
import { LibraryPage } from './library/LibraryPage'
import { AuthDialog } from './auth/AuthForm'
import { AccountDialog } from './auth/AccountDialog'
import { t } from './ui/i18n'
import './app.css'

/** the address of each page (the card maker has none) */
const VIEW_HASH: Partial<Record<View, string>> = { library: '#library', china: '#china' }

export default function App() {
  const { db, loadError, lang, view, pendingAction } = useAppStore()
  const load = useAppStore((s) => s.load)
  const setView = useAppStore((s) => s.setView)
  const authed = useAppStore((s) => s.authed)
  const refreshAccount = useAppStore((s) => s.refreshAccount)
  const refreshCloud = useAppStore((s) => s.refreshCloud)

  useEffect(() => {
    void load()
  }, [load])

  // a login remembered in this browser: who it is, and the online list
  useEffect(() => {
    if (!authed) return
    void refreshAccount()
    void refreshCloud()
    // only when the page opens; logging in fetches these itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pages have their own addresses (…/BA-ReCard/#library, #china): the store
  // opens the one the page loads with; here the address follows the page, and
  // back/forward switch pages.
  useEffect(() => {
    const fromAddress = () => {
      const page = viewFromHash(location.hash)
      if (page) setView(page)
      else {
        const current = useAppStore.getState()
        if (current.view === 'library' || current.view === 'china') setView(current.workView)
      }
    }
    window.addEventListener('hashchange', fromAddress)
    window.addEventListener('popstate', fromAddress)
    return () => {
      window.removeEventListener('hashchange', fromAddress)
      window.removeEventListener('popstate', fromAddress)
    }
  }, [setView])
  useEffect(() => {
    const want = VIEW_HASH[view] ?? ''
    if (location.hash === want) return
    if (want) location.hash = want
    else history.pushState(null, '', location.pathname + location.search)
  }, [view])

  if (loadError) return <div className="app-error">{t(lang, 'loadFailed')}: {loadError}</div>
  if (!db) return <div className="app-loading">{t(lang, 'loading')}</div>

  return (
    <div className="app">
      <AppHeader />
      {view === 'library' ? (
        <main className="page page-full">
          <LibraryPage />
        </main>
      ) : view === 'china' ? (
        <main className="page page-full">
          <ChinaSpecsPage />
        </main>
      ) : (
        <CardMaker />
      )}
      {pendingAction && <UnsavedDialog />}
      <AuthDialog />
      <AccountDialog />
    </div>
  )
}

/** The card maker: unit picker | card (or kill log) | card panel. */
function CardMaker() {
  const { card, compact, style, editMode, lang, view, log, returnView } = useAppStore()
  const setCompact = useAppStore((s) => s.setCompact)
  const setStyle = useAppStore((s) => s.setStyle)
  const setEditMode = useAppStore((s) => s.setEditMode)
  const setView = useAppStore((s) => s.setView)
  const resetEdits = useAppStore((s) => s.resetEdits)
  const resetLog = useAppStore((s) => s.resetLog)
  const swapLogSides = useAppStore((s) => s.swapLogSides)
  const updateCard = useAppStore((s) => s.updateCard)

  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const isLog = view === 'log'

  async function onExport() {
    setExporting(true)
    try {
      if (isLog) await exportLogPng(logFileName(log.entries))
      else if (card) await exportCardPng(card.name)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page page-card">
      <aside className="sidebar">
        <UnitPicker />
      </aside>

      <main className="workspace">
        {card || isLog ? (
          <>
            <div className="toolbar">
              {/* opened from the China page: one click back to it */}
              {returnView === 'china' && (
                <>
                  <button className="toolbar-back" onClick={() => setView('china')}>
                    ← {t(lang, 'navChina')}
                  </button>
                  <span className="toolbar-sep" />
                </>
              )}
              {/* card layout views + the log workspace */}
              <button
                className={!isLog && compact ? 'active' : ''}
                onClick={() => {
                  setCompact(true)
                  setView('card')
                }}
              >
                {t(lang, 'compact')}
              </button>
              <button
                className={!isLog && !compact ? 'active' : ''}
                onClick={() => {
                  setCompact(false)
                  setView('card')
                }}
              >
                {t(lang, 'expanded')}
              </button>
              <button className={isLog ? 'active' : ''} onClick={() => setView('log')}>
                {t(lang, 'logs')}
              </button>

              {/* card style toggle */}
              {!isLog && (
                <>
                  <span className="toolbar-sep" />
                  <button
                    className={style === 'legacy' ? 'active' : ''}
                    title={t(lang, 'legacyHint')}
                    onClick={() => setStyle(style === 'legacy' ? 'new' : 'legacy')}
                  >
                    {t(lang, 'legacy')}
                  </button>
                </>
              )}

              {/* editing tools */}
              <span className="toolbar-sep" />
              <button className={editMode ? 'active' : ''} onClick={() => setEditMode(!editMode)}>
                {editMode ? t(lang, 'editing') : t(lang, 'edit')}
              </button>
              {!isLog && <button onClick={() => fileInput.current?.click()}>{t(lang, 'portrait')}</button>}
              {isLog && (
                <button className={log.swapped ? 'active' : ''} title={t(lang, 'swapSidesHint')} onClick={swapLogSides}>
                  {t(lang, 'swapSides')}
                </button>
              )}
              <button onClick={isLog ? resetLog : resetEdits}>{t(lang, 'reset')}</button>

              {/* output */}
              <span className="toolbar-sep" />
              <button className="primary" onClick={onExport} disabled={exporting}>
                {exporting ? t(lang, 'exporting') : t(lang, 'exportPng')}
              </button>
            </div>
            <div className="card-stage">{isLog ? <LogBoard /> : card && <UnitCard card={card} />}</div>
          </>
        ) : (
          <div className="workspace-empty">{t(lang, 'emptyWorkspace')}</div>
        )}
      </main>

      <aside className="sidebar right">
        {!isLog && <CardPanel />}
        {!isLog && <VariantPanel />}
        <ColorPanel />
      </aside>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) setCropSrc(URL.createObjectURL(file))
          e.target.value = ''
        }}
      />
      {cropSrc && (
        <CropDialog
          imageSrc={cropSrc}
          onCancel={() => {
            URL.revokeObjectURL(cropSrc)
            setCropSrc(null)
          }}
          onDone={(dataUrl) => {
            updateCard((c) => void (c.portrait = dataUrl))
            URL.revokeObjectURL(cropSrc)
            setCropSrc(null)
          }}
        />
      )}
    </div>
  )
}

/** "Unsaved edits": shown before something replaces an edited card. Saving
 *  goes where the card came from (its online entry, else this browser). */
function UnsavedDialog() {
  const lang = useAppStore((s) => s.lang)
  const confirmPending = useAppStore((s) => s.confirmPending)
  const cancelPending = useAppStore((s) => s.cancelPending)
  const saveCurrent = useAppStore((s) => s.saveCurrent)
  const cloudBusy = useAppStore((s) => s.cloudBusy)
  const notice = useAppStore((s) => s.cloudNotice)
  const [failed, setFailed] = useState(false)

  return (
    <div className="crop-overlay" onClick={cancelPending}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{t(lang, 'unsavedTitle')}</h3>
        <p>{t(lang, 'unsavedBody')}</p>
        {failed && notice?.kind === 'error' && (
          <div className="saved-error">
            {t(lang, notice.key)}
            {notice.detail ? `: ${notice.detail}` : ''}
          </div>
        )}
        <div className="confirm-actions">
          <button onClick={cancelPending}>{t(lang, 'cancel')}</button>
          <button
            disabled={cloudBusy}
            onClick={async () => {
              if (await saveCurrent()) confirmPending()
              else setFailed(true)
            }}
          >
            {cloudBusy ? t(lang, 'cloudWorking') : t(lang, 'saveAndSwitch')}
          </button>
          <button className="danger" onClick={confirmPending}>
            {t(lang, 'discard')}
          </button>
        </div>
      </div>
    </div>
  )
}
