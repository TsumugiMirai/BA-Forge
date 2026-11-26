import { useState } from 'react'
import type { LoginResult, RegisterResult } from './auth'
import { useAppStore } from '../state/store'
import type { UiStringKey } from '../ui/i18n'
import { t } from '../ui/i18n'
import './auth.css'

const LOGIN_FAILURE: Record<Exclude<LoginResult, 'ok'>, UiStringKey> = {
  wrong: 'loginFailed',
  busy: 'loginBusy',
  error: 'loginError',
}

const REGISTER_FAILURE: Record<Exclude<RegisterResult, 'ok'>, UiStringKey> = {
  username: 'registerUsername',
  password: 'registerPassword',
  invite: 'registerInvite',
  taken: 'registerTaken',
  busy: 'loginBusy',
  error: 'loginError',
}

/** same rule as api.register on the server */
const USERNAME_OK = /^[^\s/\\]{2,24}$/u

export type AuthMode = 'login' | 'register'

/** Log in, or sign up with an invite code (and be logged in right away). */
export function AuthForm({ initialMode = 'login', onDone }: { initialMode?: AuthMode; onDone?(): void }) {
  const lang = useAppStore((s) => s.lang)
  const login = useAppStore((s) => s.login)
  const register = useAppStore((s) => s.register)
  const expired = useAppStore((s) => s.loginExpired)
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [failure, setFailure] = useState<UiStringKey | null>(null)
  const [busy, setBusy] = useState(false)
  const registering = mode === 'register'

  async function submit() {
    if (registering) {
      const name = username.trim()
      // the server checks these too; this just answers faster
      if (!USERNAME_OK.test(name) || [...name].length > 24) return setFailure('registerUsername')
      if (password.length < 6) return setFailure('registerPassword')
      if (password !== password2) return setFailure('registerMismatch')
      if (!inviteCode.trim()) return setFailure('registerInvite')
    }
    setBusy(true)
    const result = registering
      ? await register({ username, password, inviteCode, displayName })
      : await login(username, password)
    setBusy(false)
    if (result === 'ok') {
      setPassword('')
      setPassword2('')
      setFailure(null)
      onDone?.()
    } else {
      setFailure(registering ? REGISTER_FAILURE[result as Exclude<RegisterResult, 'ok'>] : LOGIN_FAILURE[result as Exclude<LoginResult, 'ok'>])
    }
  }

  const switchTo = (next: AuthMode) => {
    setMode(next)
    setFailure(null)
  }

  return (
    <form
      className="auth-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!registering}
          className={!registering ? 'active' : ''}
          onClick={() => switchTo('login')}
        >
          {t(lang, 'loginTitle')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={registering}
          className={registering ? 'active' : ''}
          onClick={() => switchTo('register')}
        >
          {t(lang, 'registerTitle')}
        </button>
      </div>
      <div className="auth-hint">{t(lang, registering ? 'registerHint' : 'loginHint')}</div>
      {expired && !failure && !registering && <div className="saved-error">{t(lang, 'loginExpired')}</div>}
      <label className="auth-field">
        <span>{t(lang, 'account')}</span>
        <input
          className="cloud-input"
          autoComplete="username"
          value={username}
          maxLength={40}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      {registering && (
        <label className="auth-field">
          <span>{t(lang, 'displayNameHint')}</span>
          <input
            className="cloud-input"
            autoComplete="nickname"
            value={displayName}
            maxLength={32}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
      )}
      <label className="auth-field">
        <span>{t(lang, 'password')}</span>
        <input
          className="cloud-input"
          type="password"
          autoComplete={registering ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {registering && (
        <>
          <label className="auth-field">
            <span>{t(lang, 'passwordRepeat')}</span>
            <input
              className="cloud-input"
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>{t(lang, 'inviteCode')}</span>
            <input
              className="cloud-input"
              autoComplete="off"
              value={inviteCode}
              maxLength={64}
              onChange={(e) => setInviteCode(e.target.value)}
            />
          </label>
        </>
      )}
      {failure && <div className="saved-error">{t(lang, failure)}</div>}
      <button className="auth-submit" type="submit" disabled={busy || !username.trim() || !password}>
        {busy ? t(lang, 'cloudWorking') : t(lang, registering ? 'registerButton' : 'loginButton')}
      </button>
      <button type="button" className="cloud-link auth-switch" onClick={() => switchTo(registering ? 'login' : 'register')}>
        {t(lang, registering ? 'switchToLogin' : 'switchToRegister')}
      </button>
    </form>
  )
}

/** The login/sign-up dialog opened from the header. */
export function AuthDialog() {
  const mode = useAppStore((s) => s.authDialog)
  const openAuth = useAppStore((s) => s.openAuth)
  if (!mode) return null
  return (
    <div className="crop-overlay" onMouseDown={(e) => e.target === e.currentTarget && openAuth(null)}>
      <div className="auth-dialog">
        <button className="picker-dialog-close auth-close" aria-label="close" onClick={() => openAuth(null)}>
          ×
        </button>
        <AuthForm key={mode} initialMode={mode} onDone={() => openAuth(null)} />
      </div>
    </div>
  )
}

/** In place of a page that needs a login: why, and the form. */
export function AuthGate({ reason }: { reason: UiStringKey }) {
  const lang = useAppStore((s) => s.lang)
  return (
    <div className="auth-gate">
      <h2>{t(lang, 'authGateTitle')}</h2>
      <p className="auth-hint">{t(lang, reason)}</p>
      <div className="auth-gate-box">
        <AuthForm />
      </div>
    </div>
  )
}
