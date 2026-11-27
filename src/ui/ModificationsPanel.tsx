import { useState } from 'react'
import { iconUrl } from '../assets'
import { t } from './i18n'
import { useAppStore } from '../state/store'

export interface ModOption {
  key: string
  name: string
  /** points added to the unit's cost */
  cost: number
  /** image URL; null = the slot's icon */
  icon: string | null
  /** the icon as a card stores it (maker/ModsEditor modIconUrl) */
  iconRef?: string | null
}

export interface ModSlot {
  key: string
  name: string
  icon: string | null
  iconRef?: string | null
  options: ModOption[]
  /** key of the chosen option */
  current: string
}

const SLOT_ICON = iconUrl('Modification Icon')

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n)
}

/** A unit's modification slots as in the game's arsenal: one row per slot
 *  showing the chosen option and its extra cost; a row opens the slot's
 *  options. */
export function ModificationsPanel({
  slots,
  onSelect,
  className,
}: {
  slots: ModSlot[]
  onSelect(slotKey: string, optionKey: string): void
  className?: string
}) {
  const lang = useAppStore((s) => s.lang)
  const [open, setOpen] = useState<string | null>(null)
  if (slots.length === 0) return null

  return (
    <div className={`mods-panel ${className ?? ''}`}>
      <div className="mods-title">{t(lang, 'modsTitle')}</div>
      {slots.map((slot) => {
        const current = slot.options.find((o) => o.key === slot.current) ?? slot.options[0]
        const expanded = open === slot.key
        return (
          <div key={slot.key} className={`mods-slot ${expanded ? 'open' : ''}`}>
            <button className="mods-row" onClick={() => setOpen(expanded ? null : slot.key)}>
              <ModIcon src={slot.icon ?? SLOT_ICON} />
              <span className="mods-row-name">{slot.name}</span>
              <span className="mods-row-current">{current?.name}</span>
              <span className="mods-cost">{signed(current?.cost ?? 0)}</span>
            </button>
            {expanded && (
              <div className="mods-options">
                {slot.options.map((o) => (
                  <button
                    key={o.key}
                    className={`mods-option ${o.key === current?.key ? 'active' : ''}`}
                    onClick={() => {
                      onSelect(slot.key, o.key)
                      setOpen(null)
                    }}
                  >
                    <ModIcon src={o.icon ?? slot.icon ?? SLOT_ICON} wide={!!o.icon} />
                    <span className="mods-option-name">{o.name}</span>
                    <span className="mods-cost">{signed(o.cost)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ModIcon({ src, wide }: { src: string | null; wide?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <span className={`mods-icon ${wide ? 'wide' : ''}`} />
  return <img className={`mods-icon ${wide ? 'wide' : ''}`} src={src} alt="" onError={() => setFailed(src)} />
}
