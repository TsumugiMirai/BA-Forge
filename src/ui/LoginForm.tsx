import { useState } from 'react'
import type { LoginResult } from '../auth/auth'
import { useAppStore } from '../state/store'
import type { UiStringKey } from './i18n'
import { t } from './i18n'

const FAILURE_TEXT: Record<Exclude<LoginResult, 'ok'>, UiStringKey> = {
  wrong: 'loginFailed',
  busy: 'loginBusy',
  error: 'loginError',
}

/** The page login shown in place of the online features until it passes. */
export function LoginForm({ compact = false }: { compact?: boolean }) {
  const lang = useAppStore((s) => s.lang)
  const login = useAppStore((s) => s.login)
  const expired = useAppStore((s) => s.loginExpired)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<UiStringKey | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    const result = await login(account, password)
    setBusy(false)
    setFailure(result === 'ok' ? null : FAILURE_TEXT[result])
    if (result === 'ok') setPassword('')
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
      {expired && !failure && <div className="saved-error">{t(lang, 'loginExpired')}</div>}
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
      {failure && <div className="saved-error">{t(lang, failure)}</div>}
      <button className="saved-import cloud-primary" type="submit" disabled={busy || !account}>
        {t(lang, 'loginButton')}
      </button>
    </form>
  )
}
