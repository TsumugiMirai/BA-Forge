import { useState } from 'react'
import { useAppStore } from '../state/store'
import { t } from './i18n'

/** The page login shown in place of the online features until it passes. */
export function LoginForm({ compact = false }: { compact?: boolean }) {
  const lang = useAppStore((s) => s.lang)
  const login = useAppStore((s) => s.login)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    const ok = await login(account, password)
    setBusy(false)
    setFailed(!ok)
    if (ok) setPassword('')
  }

  return (
    <form
      className={`login-form ${compact ? 'compact' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {!compact && <h3>{t(lang, 'loginTitle')}</h3>}
      <div className="saved-hint">{t(lang, 'loginHint')}</div>
      <input
        className="cloud-input"
        placeholder={t(lang, 'account')}
        autoComplete="username"
        value={account}
        onChange={(e) => setAccount(e.target.value)}
      />
      <input
        className="cloud-input"
        type="password"
        placeholder={t(lang, 'password')}
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {failed && <div className="saved-error">{t(lang, 'loginFailed')}</div>}
      <button className="saved-import cloud-primary" type="submit" disabled={busy || !account}>
        {t(lang, 'loginButton')}
      </button>
    </form>
  )
}
