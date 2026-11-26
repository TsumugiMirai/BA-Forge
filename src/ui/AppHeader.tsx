import { useEffect, useRef, useState } from 'react'
import type { View } from '../state/store'
import { useAppStore } from '../state/store'
import { cloudEnabled } from '../cloud/config'
import type { UiStringKey } from './i18n'
import { t } from './i18n'

const PAGES: { page: 'card' | 'library' | 'china'; label: UiStringKey; needsLogin: boolean }[] = [
  { page: 'card', label: 'navCards', needsLogin: false },
  { page: 'library', label: 'navLibrary', needsLogin: false },
  { page: 'china', label: 'navChina', needsLogin: true },
]

function LockIcon() {
  return (
    <svg className="nav-lock" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm-2 5V4.5a2 2 0 1 1 4 0V6H6Z"
      />
    </svg>
  )
}

/** Top bar: the three pages (card maker, library, China specializations),
 *  language, and the account (log in / sign up, or the account menu). */
export function AppHeader() {
  const lang = useAppStore((s) => s.lang)
  const view = useAppStore((s) => s.view)
  const workView = useAppStore((s) => s.workView)
  const setView = useAppStore((s) => s.setView)
  const setLang = useAppStore((s) => s.setLang)
  const authed = useAppStore((s) => s.authed)
  const account = useAppStore((s) => s.account)
  const weakPassword = useAppStore((s) => s.weakPassword)
  const openAuth = useAppStore((s) => s.openAuth)
  const openAccount = useAppStore((s) => s.openAccount)
  const logout = useAppStore((s) => s.logout)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const current = view === 'log' ? 'card' : view
  const go = (page: (typeof PAGES)[number]['page']) => setView((page === 'card' ? workView : page) as View)
  const shownName = account ? account.displayName || account.username : ''

  return (
    <header className="app-header">
      <div className="app-brand">BA ReCard</div>
      <nav className="app-nav">
        {PAGES.map(({ page, label, needsLogin }) => (
          <button
            key={page}
            className={current === page ? 'active' : ''}
            aria-current={current === page ? 'page' : undefined}
            title={needsLogin && !authed ? t(lang, 'needsLogin') : undefined}
            onClick={() => go(page)}
          >
            {t(lang, label)}
            {needsLogin && !authed && <LockIcon />}
          </button>
        ))}
      </nav>
      <div className="app-header-actions">
        <a
          className="github-link"
          href="https://github.com/JohnJinHM/BA-ReCard/"
          target="_blank"
          rel="noreferrer"
          title={t(lang, 'viewSource')}
          aria-label={t(lang, 'viewSource')}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </a>
        <button
          className="lang-toggle"
          title={t(lang, 'langToggle')}
          onClick={() => void setLang(lang === 'eng' ? 'chi' : 'eng')}
        >
          {lang === 'eng' ? '中文' : 'EN'}
        </button>
        {cloudEnabled() &&
          (authed ? (
            <div className="account-menu" ref={menuRef}>
              <button className={`account-button ${menu ? 'open' : ''}`} onClick={() => setMenu(!menu)}>
                <span className="account-avatar">{shownName.slice(0, 1) || '·'}</span>
                <span className="account-name">{shownName}</span>
                {weakPassword && <span className="account-dot" title={t(lang, 'weakPasswordHint')} />}
                <span className="account-caret">▾</span>
              </button>
              {menu && (
                <div className="account-dropdown" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false)
                      openAccount(true)
                    }}
                  >
                    {t(lang, 'accountSettings')}
                    {account?.role === 'admin' && <span className="role-badge admin">{t(lang, 'roleAdmin')}</span>}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false)
                      logout()
                    }}
                  >
                    {t(lang, 'logout')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="account-login" onClick={() => openAuth('login')}>
              {t(lang, 'loginOrRegister')}
            </button>
          ))}
      </div>
    </header>
  )
}
