import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../state/store'
import { cloudEnabled } from '../cloud/config'
import { LoginForm } from './LoginForm'
import { t } from './i18n'

/**
 * Shared online library (right sidebar, under the local Saved Cards): cards
 * everyone with the page can open, change and save again — no accounts.
 * Opening a card links the editor to its entry, so saving updates it in
 * place; a version check refuses to overwrite someone else's newer save.
 */
export function CloudCardsPanel() {
  const lang = useAppStore((s) => s.lang)
  const card = useAppStore((s) => s.card)
  const cloudCards = useAppStore((s) => s.cloudCards)
  const cloudListing = useAppStore((s) => s.cloudListing)
  const cloudBusy = useAppStore((s) => s.cloudBusy)
  const cloudNotice = useAppStore((s) => s.cloudNotice)
  const cloudLinked = useAppStore((s) => s.cloudLinked)
  const author = useAppStore((s) => s.author)
  const setAuthor = useAppStore((s) => s.setAuthor)
  const refreshCloud = useAppStore((s) => s.refreshCloud)
  const loadCloudCard = useAppStore((s) => s.loadCloudCard)
  const saveCloudCard = useAppStore((s) => s.saveCloudCard)
  const removeCloudCard = useAppStore((s) => s.removeCloudCard)
  const guardEdits = useAppStore((s) => s.guardEdits)
  const authed = useAppStore((s) => s.authed)
  const logout = useAppStore((s) => s.logout)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const [filter, setFilter] = useState('')

  const enabled = cloudEnabled()
  useEffect(() => {
    if (enabled && authed) void refreshCloud()
  }, [enabled, authed, refreshCloud])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q
      ? cloudCards.filter((c) => `${c.name}\n${c.author}`.toLowerCase().includes(q))
      : cloudCards
  }, [cloudCards, filter])

  if (!enabled) return null

  if (!authed)
    return (
      <div className="saved-panel cloud-panel">
        <h3>{t(lang, 'cloudTitle')}</h3>
        <LoginForm compact />
      </div>
    )

  const linkedName = cloudLinked ? cloudCards.find((c) => c.id === cloudLinked.id)?.name : undefined

  return (
    <div className="saved-panel cloud-panel">
      <div className="cloud-title-row">
        <h3>{t(lang, 'cloudTitle')}</h3>
        <div className="cloud-title-actions">
          <button className="cloud-link" onClick={logout}>
            {t(lang, 'logout')}
          </button>
          <button
            className="saved-action"
            title={t(lang, 'cloudRefresh')}
            disabled={cloudListing}
            onClick={() => void refreshCloud()}
          >
            ↻
          </button>
        </div>
      </div>
      <div className="saved-hint">{t(lang, 'cloudHint')}</div>
      <input
        className="cloud-input"
        placeholder={t(lang, 'cloudAuthor')}
        value={author}
        maxLength={40}
        onChange={(e) => setAuthor(e.target.value)}
      />
      {cloudLinked && (
        <div className="cloud-linked">
          {t(lang, 'cloudEditing')}
          {linkedName ? `：${linkedName}` : ''}
        </div>
      )}
      <button
        className="saved-import cloud-primary"
        disabled={!card || cloudBusy}
        onClick={() => void saveCloudCard(false)}
      >
        {cloudLinked ? t(lang, 'cloudUpdate') : t(lang, 'cloudSave')}
      </button>
      {cloudLinked && (
        <button
          className="saved-import"
          disabled={!card || cloudBusy}
          onClick={() => void saveCloudCard(true)}
        >
          {t(lang, 'cloudSaveAsNew')}
        </button>
      )}
      {cloudBusy && <div className="saved-hint">{t(lang, 'cloudWorking')}</div>}
      {cloudNotice && (
        <div className={cloudNotice.kind === 'error' ? 'saved-error' : 'cloud-ok'}>
          {t(lang, cloudNotice.key)}
          {cloudNotice.detail ? `: ${cloudNotice.detail}` : ''}
        </div>
      )}
      {cloudCards.length > 6 && (
        <input
          className="cloud-input"
          placeholder={t(lang, 'cloudFilter')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {cloudListing && cloudCards.length === 0 && (
        <div className="saved-hint">{t(lang, 'cloudLoading')}</div>
      )}
      {!cloudListing && cloudCards.length === 0 && (
        <div className="saved-hint">{t(lang, 'cloudEmpty')}</div>
      )}
      <div className="cloud-list">
        {shown.map((c) => (
          <div className="saved-row" key={c.id}>
            <button
              className={`saved-load cloud-load ${cloudLinked?.id === c.id ? 'linked' : ''}`}
              title={t(lang, 'load')}
              disabled={cloudBusy}
              onClick={() =>
                guardEdits(() => {
                  void loadCloudCard(c.id)
                  if (view !== 'card') setView('card')
                })
              }
            >
              <span className="saved-name">{c.name}</span>
              <span className="cloud-meta">
                {c.author ? `${c.author} · ` : ''}
                {new Date(c.updated_at).toLocaleDateString()}
              </span>
            </button>
            <button
              className="saved-action danger"
              title={t(lang, 'delete')}
              disabled={cloudBusy}
              onClick={() => {
                if (window.confirm(`${t(lang, 'cloudDeleteConfirm')}\n${c.name}`))
                  void removeCloudCard(c.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
