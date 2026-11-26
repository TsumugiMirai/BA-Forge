import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../state/store'
import type { AdminOverview } from '../cloud/account'
import { adminOverview, adminResetPassword, adminSetInviteCode, adminSetRole } from '../cloud/account'
import { CloudAuthError, CloudHttpError } from '../cloud/rest'
import type { UiStringKey } from '../ui/i18n'
import { t } from '../ui/i18n'
import './auth.css'

type Notice = { kind: 'ok' | 'error'; key: UiStringKey; detail?: string } | null

function NoticeLine({ notice }: { notice: Notice }) {
  const lang = useAppStore((s) => s.lang)
  if (!notice) return null
  return (
    <div className={notice.kind === 'error' ? 'saved-error' : 'cloud-ok'}>
      {t(lang, notice.key)}
      {notice.detail ? `: ${notice.detail}` : ''}
    </div>
  )
}

/** Account settings: display name, password, and for admins the invite
 *  code and the accounts list. */
export function AccountDialog() {
  const open = useAppStore((s) => s.accountDialog)
  const openAccount = useAppStore((s) => s.openAccount)
  const account = useAppStore((s) => s.account)
  if (!open || !account) return null
  return (
    <div className="crop-overlay" onMouseDown={(e) => e.target === e.currentTarget && openAccount(false)}>
      <div className="auth-dialog account-dialog">
        <button className="picker-dialog-close auth-close" aria-label="close" onClick={() => openAccount(false)}>
          ×
        </button>
        <AccountSettings />
        {account.role === 'admin' && <AdminSection />}
      </div>
    </div>
  )
}

function AccountSettings() {
  const lang = useAppStore((s) => s.lang)
  const account = useAppStore((s) => s.account)!
  const weakPassword = useAppStore((s) => s.weakPassword)
  const setDisplayName = useAppStore((s) => s.setDisplayName)
  const changePassword = useAppStore((s) => s.changePassword)
  const logout = useAppStore((s) => s.logout)
  const [name, setName] = useState(account.displayName)
  const [nameNotice, setNameNotice] = useState<Notice>(null)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [pwNotice, setPwNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)

  async function saveName() {
    setBusy(true)
    const ok = await setDisplayName(name)
    setBusy(false)
    setNameNotice(ok ? { kind: 'ok', key: 'displayNameSaved' } : { kind: 'error', key: 'actionFailed' })
  }

  async function savePassword() {
    if (newPw.length < 6) return setPwNotice({ kind: 'error', key: 'registerPassword' })
    if (newPw !== newPw2) return setPwNotice({ kind: 'error', key: 'registerMismatch' })
    setBusy(true)
    const result = await changePassword(oldPw, newPw)
    setBusy(false)
    if (result === 'ok') {
      setOldPw('')
      setNewPw('')
      setNewPw2('')
    }
    setPwNotice(
      result === 'ok'
        ? { kind: 'ok', key: 'passwordChanged' }
        : result === 'wrong'
          ? { kind: 'error', key: 'passwordWrong' }
          : result === 'password'
            ? { kind: 'error', key: 'registerPassword' }
            : { kind: 'error', key: 'actionFailed' },
    )
  }

  return (
    <>
      <div className="account-head">
        <span className="account-avatar large">{(account.displayName || account.username).slice(0, 1)}</span>
        <div className="account-head-text">
          <h3>{account.displayName || account.username}</h3>
          <div className="auth-hint">
            {t(lang, 'account')}: {account.username} ·{' '}
            <span className={`role-badge ${account.role}`}>
              {t(lang, account.role === 'admin' ? 'roleAdmin' : 'roleMember')}
            </span>
          </div>
        </div>
        <button className="account-logout" onClick={logout}>
          {t(lang, 'logout')}
        </button>
      </div>

      <section className="account-section">
        <h4>{t(lang, 'displayName')}</h4>
        <div className="account-row">
          <input
            className="cloud-input"
            value={name}
            maxLength={32}
            placeholder={account.username}
            onChange={(e) => {
              setName(e.target.value)
              setNameNotice(null)
            }}
          />
          <button className="auth-small" disabled={busy || name.trim() === account.displayName} onClick={() => void saveName()}>
            {t(lang, 'saveDisplayName')}
          </button>
        </div>
        <NoticeLine notice={nameNotice} />
      </section>

      <section className="account-section">
        <h4>{t(lang, 'changePasswordTitle')}</h4>
        {weakPassword && <div className="account-warning">{t(lang, 'weakPasswordHint')}</div>}
        <form
          className="account-password"
          onSubmit={(e) => {
            e.preventDefault()
            void savePassword()
          }}
        >
          <input type="text" autoComplete="username" value={account.username} readOnly hidden />
          <input
            className="cloud-input"
            type="password"
            autoComplete="current-password"
            placeholder={t(lang, 'oldPassword')}
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
          />
          <input
            className="cloud-input"
            type="password"
            autoComplete="new-password"
            placeholder={t(lang, 'newPassword')}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <input
            className="cloud-input"
            type="password"
            autoComplete="new-password"
            placeholder={t(lang, 'passwordRepeat')}
            value={newPw2}
            onChange={(e) => setNewPw2(e.target.value)}
          />
          <button className="auth-small" type="submit" disabled={busy || !oldPw || !newPw}>
            {t(lang, 'changePasswordButton')}
          </button>
        </form>
        <NoticeLine notice={pwNotice} />
      </section>
    </>
  )
}

function adminError(e: unknown): Notice {
  if (e instanceof CloudAuthError) return null
  if (e instanceof CloudHttpError) {
    if (e.reason === 'last_admin') return { kind: 'error', key: 'lastAdmin' }
    if (e.reason === 'code') return { kind: 'error', key: 'inviteCodeInvalid' }
    if (e.reason === 'password') return { kind: 'error', key: 'registerPassword' }
  }
  return { kind: 'error', key: 'actionFailed', detail: e instanceof Error ? e.message : String(e) }
}

/** Admins: the invite code that works for signing up, and every account. */
function AdminSection() {
  const lang = useAppStore((s) => s.lang)
  const me = useAppStore((s) => s.account)!
  const refreshAccount = useAppStore((s) => s.refreshAccount)
  const [data, setData] = useState<AdminOverview | null>(null)
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (action: () => Promise<AdminOverview | void>, done?: UiStringKey) => {
    setBusy(true)
    setNotice(null)
    try {
      const next = await action()
      if (next) setData(next)
      if (done) setNotice({ kind: 'ok', key: done })
    } catch (e) {
      setNotice(adminError(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void run(adminOverview)
  }, [run])

  const active = data?.invites.filter((i) => i.active) ?? []

  return (
    <section className="account-section admin-section">
      <h4>{t(lang, 'adminTitle')}</h4>
      <NoticeLine notice={notice} />
      <div className="admin-invite">
        <div className="admin-label">{t(lang, 'inviteCodeCurrent')}</div>
        <div className="admin-codes">
          {data && active.length === 0 && <span className="auth-hint">{t(lang, 'inviteCodeNone')}</span>}
          {active.map((i) => (
            <span key={i.code} className="admin-code">
              <code>{i.code}</code>
              <span className="auth-hint">
                {t(lang, 'inviteUses')} {i.uses}
              </span>
            </span>
          ))}
        </div>
        <form
          className="account-row"
          onSubmit={(e) => {
            e.preventDefault()
            const next = code.trim()
            if (next.length < 4 || next.length > 64) return setNotice({ kind: 'error', key: 'inviteCodeInvalid' })
            void run(() => adminSetInviteCode(next)).then(() => setCode(''))
          }}
        >
          <input
            className="cloud-input"
            placeholder={t(lang, 'inviteCodeNew')}
            value={code}
            maxLength={64}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="auth-small" type="submit" disabled={busy || !code.trim()}>
            {t(lang, 'inviteCodeSet')}
          </button>
        </form>
      </div>

      <div className="admin-label">{t(lang, 'membersTitle')}</div>
      <div className="admin-members">
        {data?.accounts.map((a) => {
          const self = a.username === me.username
          return (
            <div key={a.username} className="admin-member">
              <span className="account-avatar">{(a.display_name || a.username).slice(0, 1)}</span>
              <span className="admin-member-name">
                <b>{a.display_name || a.username}</b>
                <span className="auth-hint">
                  {a.username} {self ? t(lang, 'you') : ''} · {t(lang, 'registeredAt')}{' '}
                  {new Date(a.created_at).toLocaleDateString()}
                </span>
              </span>
              <span className={`role-badge ${a.role}`}>{t(lang, a.role === 'admin' ? 'roleAdmin' : 'roleMember')}</span>
              <button
                className="cloud-link"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await adminSetRole(a.username, a.role === 'admin' ? 'member' : 'admin')
                    // demoting yourself closes this section
                    if (self) await refreshAccount()
                    return next
                  })
                }
              >
                {t(lang, a.role === 'admin' ? 'makeMember' : 'makeAdmin')}
              </button>
              {!self && (
                <button
                  className="cloud-link"
                  disabled={busy}
                  onClick={() => {
                    const pw = window.prompt(`${t(lang, 'resetPasswordPrompt')} ${a.username}`)
                    if (pw == null) return
                    if (pw.length < 6) return setNotice({ kind: 'error', key: 'registerPassword' })
                    void run(async () => void (await adminResetPassword(a.username, pw)), 'resetPasswordDone')
                  }}
                >
                  {t(lang, 'resetPassword')}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
