import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store'
import type { UiStringKey } from '../ui/i18n'
import { t } from '../ui/i18n'
import { CardPanel } from '../ui/CardPanel'
import { ModsEditor } from './ModsEditor'
import { ColorPanel } from '../ui/ColorPanel'
import { CropDialog } from '../ui/CropDialog'
import type { CardZoom } from '../ui/ScaledCard'
import { ScaledCard } from '../ui/ScaledCard'
import { UnitCard } from '../card/UnitCard'
import { LogBoard } from '../log/LogBoard'
import { logFileName } from '../log/logModel'
import { exportCardPng, exportLogPng } from '../export/exportPng'
import { parseSavedCardFile } from '../state/savedCards'
import { readIconFile } from './images'
import './maker.css'

const ZOOMS: { value: CardZoom; label: string }[] = [
  { value: 'both', label: '' },
  { value: 1, label: '100%' },
  { value: 1.25, label: '125%' },
  { value: 1.5, label: '150%' },
]
const ZOOM_KEY = 'ba-forge.zoom'

function initialZoom(): CardZoom {
  try {
    const saved = localStorage.getItem(ZOOM_KEY)
    if (saved === 'both') return 'both'
    const n = Number(saved)
    if (saved && ZOOMS.some((z) => z.value === n)) return n
  } catch {
    // not remembered
  }
  return 'both'
}

const BACK_LABEL: Partial<Record<string, UiStringKey>> = {
  units: 'navUnits',
  china: 'navChina',
  library: 'navLibrary',
}

/** The card maker (#maker): toolbar, the card (or kill log) at a chosen zoom,
 *  and the card's panels on the right. */
export function CardMaker() {
  const { card, compact, style, editMode, lang, view, log, returnView } = useAppStore()
  const setCompact = useAppStore((s) => s.setCompact)
  const setStyle = useAppStore((s) => s.setStyle)
  const setEditMode = useAppStore((s) => s.setEditMode)
  const setView = useAppStore((s) => s.setView)
  const resetEdits = useAppStore((s) => s.resetEdits)
  const resetLog = useAppStore((s) => s.resetLog)
  const swapLogSides = useAppStore((s) => s.swapLogSides)
  const updateCard = useAppStore((s) => s.updateCard)
  const selectedUnitId = useAppStore((s) => s.selectedUnitId)

  const [crop, setCrop] = useState<{ src: string; target: 'portrait' | 'background' } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [zoom, setZoomState] = useState<CardZoom>(initialZoom)
  const setZoom = (z: CardZoom) => {
    setZoomState(z)
    try {
      localStorage.setItem(ZOOM_KEY, String(z))
    } catch {
      // not remembered
    }
  }
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

  const back = returnView ? BACK_LABEL[returnView] : undefined

  return (
    <div className="page page-card">
      <main className="workspace">
        {card || isLog ? (
          <>
            <div className="toolbar">
              {back && returnView && (
                <>
                  <button className="toolbar-back" onClick={() => setView(returnView)}>
                    ← {t(lang, back)}
                  </button>
                  <span className="toolbar-sep" />
                </>
              )}
              <div className="seg">
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
              </div>
              {!isLog && (
                <button
                  className={style === 'legacy' ? 'active' : ''}
                  title={t(lang, 'legacyHint')}
                  onClick={() => setStyle(style === 'legacy' ? 'new' : 'legacy')}
                >
                  {t(lang, 'legacy')}
                </button>
              )}

              <span className="toolbar-sep" />
              <button className={editMode ? 'active' : ''} onClick={() => setEditMode(!editMode)}>
                {editMode ? t(lang, 'editing') : t(lang, 'edit')}
              </button>
              {!isLog && card && (
                <ImageMenu
                  hasBackground={!!card.background}
                  hasIcon={!!card.icon}
                  onCrop={(src, target) => setCrop({ src, target })}
                  onIcon={(icon) => updateCard((c) => void (c.icon = icon))}
                  onClearBackground={() => updateCard((c) => void delete c.background)}
                />
              )}
              {isLog && (
                <button className={log.swapped ? 'active' : ''} title={t(lang, 'swapSidesHint')} onClick={swapLogSides}>
                  {t(lang, 'swapSides')}
                </button>
              )}
              {(isLog || selectedUnitId != null) && (
                <button onClick={isLog ? resetLog : resetEdits}>{t(lang, 'reset')}</button>
              )}

              <span className="toolbar-fill" />
              <div className="seg" role="group" aria-label={t(lang, 'zoom')}>
                {ZOOMS.map((z) => (
                  <button key={String(z.value)} className={zoom === z.value ? 'active' : ''} onClick={() => setZoom(z.value)}>
                    {z.label || t(lang, 'zoomFit')}
                  </button>
                ))}
              </div>
              <button className="primary" onClick={onExport} disabled={exporting}>
                {exporting ? t(lang, 'exporting') : t(lang, 'exportPng')}
              </button>
            </div>
            <ScaledCard className="card-stage" zoom={zoom} max={1.5}>
              {isLog ? <LogBoard /> : card && <UnitCard card={card} />}
            </ScaledCard>
          </>
        ) : (
          <EmptyMaker />
        )}
      </main>

      <aside className="sidebar right">
        {!isLog && <CardPanel />}
        {!isLog && card && <ModsEditor />}
        <ColorPanel />
      </aside>

      {crop && (
        <CropDialog
          imageSrc={crop.src}
          onCancel={() => {
            URL.revokeObjectURL(crop.src)
            setCrop(null)
          }}
          onDone={(dataUrl) => {
            const target = crop.target
            updateCard((c) => {
              if (target === 'portrait') c.portrait = dataUrl
              else c.background = dataUrl
            })
            URL.revokeObjectURL(crop.src)
            setCrop(null)
          }}
        />
      )}
    </div>
  )
}

/** No card yet: start from a game unit, a blank card or a .json file. */
function EmptyMaker() {
  const lang = useAppStore((s) => s.lang)
  const setView = useAppStore((s) => s.setView)
  const newBlankCard = useAppStore((s) => s.newBlankCard)
  const openCardFile = useAppStore((s) => s.openCardFile)
  const [bad, setBad] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  return (
    <div className="maker-empty">
      <button onClick={() => setView('units')}>{t(lang, 'fromArsenal')}</button>
      <button onClick={newBlankCard}>{t(lang, 'blankCard')}</button>
      <button onClick={() => file.current?.click()}>{t(lang, 'importJson')}</button>
      {bad && <div className="saved-error">{t(lang, 'importFailed')}</div>}
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const entry = parseSavedCardFile(await f.text())
          setBad(!entry)
          if (entry) openCardFile(entry)
        }}
      />
    </div>
  )
}

/** The toolbar's image menu: the card picture, a background behind it, and
 *  the unit's arsenal icon. */
function ImageMenu(props: {
  hasBackground: boolean
  hasIcon: boolean
  onCrop(src: string, target: 'portrait' | 'background'): void
  onIcon(icon: string | null): void
  onClearBackground(): void
}) {
  const lang = useAppStore((s) => s.lang)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const target = useRef<'portrait' | 'background' | 'icon'>('portrait')

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const pick = (which: 'portrait' | 'background' | 'icon') => {
    target.current = which
    setOpen(false)
    file.current?.click()
  }

  return (
    <div className="menu" ref={ref}>
      <button className={open ? 'active' : ''} onClick={() => setOpen(!open)}>
        {t(lang, 'images')} ▾
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <button role="menuitem" onClick={() => pick('portrait')}>
            {t(lang, 'imagePortrait')}
          </button>
          <button role="menuitem" onClick={() => pick('background')}>
            {t(lang, 'imageBackground')}
          </button>
          {props.hasBackground && (
            <button
              role="menuitem"
              className="sub"
              onClick={() => {
                setOpen(false)
                props.onClearBackground()
              }}
            >
              {t(lang, 'removeBackground')}
            </button>
          )}
          <button role="menuitem" onClick={() => pick('icon')}>
            {t(lang, 'imageIcon')}
          </button>
          {props.hasIcon && (
            <button
              role="menuitem"
              className="sub"
              onClick={() => {
                setOpen(false)
                props.onIcon(null)
              }}
            >
              {t(lang, 'restoreIcon')}
            </button>
          )}
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          if (target.current === 'icon') props.onIcon(await readIconFile(f))
          else props.onCrop(URL.createObjectURL(f), target.current)
        }}
      />
    </div>
  )
}
