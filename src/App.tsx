import { useEffect, useState } from 'react'
import type { View } from './state/store'
import { useAppStore, viewFromHash } from './state/store'
import { AppHeader } from './ui/AppHeader'
import { ArmoryPage } from './armory/ArmoryPage'
import { CardMaker } from './maker/CardMaker'
import { exportSavedCardJson } from './export/exportJson'
import { SpecsPage } from './specs/SpecsPage'
import { LibraryPage } from './library/LibraryPage'
import { AuthDialog } from './auth/AuthForm'
import { AccountDialog } from './auth/AccountDialog'
import { t } from './ui/i18n'
import './app.css'

/** the address of each page (the arsenal, the first page, has none) */
const VIEW_HASH: Partial<Record<View, string>> = {
  card: '#maker',
  log: '#maker',
  library: '#library',
  china: '#specs',
}

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

  // Pages have their own addresses (…/BA-Forge/#maker, #library, #specs):
  // the store opens the one the page loads with; here the address follows
  // the page, and back/forward switch pages.
  useEffect(() => {
    const fromAddress = () => {
      const page = viewFromHash(location.hash)
      if (page === 'card') setView(useAppStore.getState().workView)
      else if (page) setView(page)
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
      {view === 'units' ? (
        <main className="page">
          <ArmoryPage />
        </main>
      ) : view === 'library' ? (
        <main className="page page-full">
          <LibraryPage />
        </main>
      ) : view === 'china' ? (
        <main className="page page-full">
          <SpecsPage />
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

/** "Unsaved edits": shown before something replaces an edited card. Saving
 *  goes to the online library (its own entry, else a new one); without a
 *  login the card can be exported as JSON instead. */
function UnsavedDialog() {
  const lang = useAppStore((s) => s.lang)
  const confirmPending = useAppStore((s) => s.confirmPending)
  const cancelPending = useAppStore((s) => s.cancelPending)
  const saveCurrent = useAppStore((s) => s.saveCurrent)
  const authed = useAppStore((s) => s.authed)
  const card = useAppStore((s) => s.card)
  const compact = useAppStore((s) => s.compact)
  const style = useAppStore((s) => s.style)
  const selection = useAppStore((s) => s.selection)
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
          {authed ? (
            <button
              disabled={cloudBusy}
              onClick={async () => {
                if (await saveCurrent()) confirmPending()
                else setFailed(true)
              }}
            >
              {cloudBusy ? t(lang, 'cloudWorking') : t(lang, 'saveAndSwitch')}
            </button>
          ) : (
            card && (
              <button
                onClick={() => {
                  exportSavedCardJson({ id: '', name: card.name.trim() || 'Untitled', savedAt: Date.now(), compact, style, selection, card })
                  confirmPending()
                }}
              >
                {t(lang, 'exportAndSwitch')}
              </button>
            )
          )}
          <button className="danger" onClick={confirmPending}>
            {t(lang, 'discard')}
          </button>
        </div>
      </div>
    </div>
  )
}
