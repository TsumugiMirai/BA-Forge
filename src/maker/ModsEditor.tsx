import { useMemo, useState } from 'react'
import { useAppStore } from '../state/store'
import type { CardModSlot } from '../card/model'
import { untagRemovedModSlot } from '../card/model'
import { iconUrl, weaponIconUrl } from '../assets'
import { gameModSlots } from '../data/gameMods'
import { ModificationsPanel } from '../ui/ModificationsPanel'
import type { ModSlot } from '../ui/ModificationsPanel'
import { VariantPanel } from '../ui/VariantPanel'
import { PickerDialog } from '../ui/PickerDialog'
import type { PickerItem } from '../ui/PickerDialog'
import { weaponLibrary } from '../ui/libraryItems'
import { TAG_ICON_NAMES, prettyIconName } from '../ui/iconLibrary'
import { useCardEditMode } from '../card/cardContext'
import { t } from '../ui/i18n'

/** A modification icon as stored on a card: "weapon:<sprite>",
 *  "icon:<sprite>" or an uploaded data URL. */
export function modIconUrl(ref: string | null | undefined): string | null {
  if (!ref) return null
  if (ref.startsWith('weapon:')) return weaponIconUrl(ref.slice(7))
  if (ref.startsWith('icon:')) return iconUrl(ref.slice(5))
  return ref
}

const DEFAULT_SLOT_ICON = 'icon:Modification Icon'

/** a card's custom slots in the panel's shape */
export function cardModSlots(mods: CardModSlot[]): ModSlot[] {
  return mods.map((m, i) => ({
    key: String(i),
    name: m.name,
    icon: modIconUrl(m.icon ?? DEFAULT_SLOT_ICON),
    current: String(m.current),
    options: m.options.map((o, j) => ({ key: String(j), name: o.name, cost: o.cost, icon: modIconUrl(o.icon) })),
  }))
}

/** the game unit's slots as custom ones, to edit from there */
function fromGame(slots: ModSlot[]): CardModSlot[] {
  return slots.map((s) => ({
    name: s.name,
    icon: s.iconRef ?? DEFAULT_SLOT_ICON,
    current: Math.max(0, s.options.findIndex((o) => o.key === s.current)),
    options: s.options.map((o) => ({ name: o.name, cost: o.cost, icon: o.iconRef ?? null })),
  }))
}

/**
 * The card's modification slots (改装件) in the card maker. A game unit's card
 * shows the game's slots (picking one rebuilds the card) until "Customize"
 * turns them into the card's own; custom slots, their options, icons and
 * costs are edited here in edit mode. Picking an option moves the card's cost
 * by the difference.
 */
export function ModsEditor() {
  const db = useAppStore((s) => s.db)
  const lang = useAppStore((s) => s.lang)
  const card = useAppStore((s) => s.card)
  const unitId = useAppStore((s) => s.selectedUnitId)
  const selection = useAppStore((s) => s.selection)
  const update = useAppStore((s) => s.updateCard)
  const selectCardMod = useAppStore((s) => s.selectCardMod)
  const editMode = useCardEditMode()
  const [picker, setPicker] = useState<{ slot: number; option: number | null } | null>(null)

  const iconItems = useMemo<{ items: PickerItem[]; groups: { key: string; label: string }[] }>(() => {
    if (!db) return { items: [], groups: [] }
    const lib = weaponLibrary(db, lang)
    const icons: PickerItem[] = TAG_ICON_NAMES.map((n) => ({
      key: `icon:${n}`,
      label: prettyIconName(n),
      url: iconUrl(n),
      group: 'icons',
    }))
    const weapons = lib.items.map((it) => {
      const w = db.weapons.get(Number(it.key))
      return { ...it, key: `weapon:${w?.HUDIcon ?? ''}` }
    })
    const seen = new Set<string>()
    return {
      items: [...icons, ...weapons].filter((it) => !seen.has(it.key) && !!seen.add(it.key)),
      groups: [{ key: 'icons', label: t(lang, 'iconsGroup') }, ...lib.groups],
    }
  }, [db, lang])

  if (!card || !db) return null
  const mods = card.mods

  // a game unit's card still on the game's own slots
  if (!mods && unitId != null) {
    const game = gameModSlots(db, unitId, selection)
    return (
      <div className="mods-editor">
        <VariantPanel />
        {editMode && (
          <button
            className="mods-add"
            onClick={() => update((c) => void (c.mods = fromGame(game)))}
          >
            {t(lang, 'customizeMods')}
          </button>
        )}
      </div>
    )
  }

  if (!editMode)
    return mods && mods.length > 0 ? (
      <ModificationsPanel
        className="variant-panel"
        slots={cardModSlots(mods)}
        onSelect={(slot, option) => selectCardMod(Number(slot), Number(option))}
      />
    ) : null

  const list = mods ?? []
  const setMods = (fn: (m: CardModSlot[]) => void) =>
    update((c) => {
      c.mods ??= []
      fn(c.mods)
    })

  return (
    <div className="mods-editor">
      <div className="mods-title">{t(lang, 'modsTitle')}</div>
      {list.map((slot, si) => (
        <div key={si} className="mods-edit-slot">
          <div className="mods-edit-row head">
            <IconButton src={modIconUrl(slot.icon ?? DEFAULT_SLOT_ICON)} onClick={() => setPicker({ slot: si, option: null })} />
            <input
              className="mods-input"
              value={slot.name}
              placeholder={t(lang, 'modSlotName')}
              onChange={(e) => setMods((m) => void (m[si]!.name = e.target.value))}
            />
            <button
              className="mods-x"
              title={t(lang, 'remove')}
              onClick={() =>
                update((c) => {
                  c.mods?.splice(si, 1)
                  untagRemovedModSlot(c, si)
                })
              }
            >
              ×
            </button>
          </div>
          {slot.options.map((o, oi) => (
            <div key={oi} className={`mods-edit-row ${slot.current === oi ? 'current' : ''}`}>
              <input
                type="radio"
                name={`mod-${si}`}
                checked={slot.current === oi}
                title={t(lang, 'modDefaultOption')}
                onChange={() => selectCardMod(si, oi)}
              />
              <IconButton
                src={modIconUrl(o.icon) ?? modIconUrl(slot.icon ?? DEFAULT_SLOT_ICON)}
                wide={!!o.icon}
                onClick={() => setPicker({ slot: si, option: oi })}
              />
              <input
                className="mods-input"
                value={o.name}
                placeholder={t(lang, 'modOptionName')}
                onChange={(e) => setMods((m) => void (m[si]!.options[oi]!.name = e.target.value))}
              />
              <input
                className="mods-input cost"
                type="number"
                step={5}
                value={Number.isFinite(o.cost) ? o.cost : 0}
                onChange={(e) => {
                  const cost = Math.round(Number(e.target.value) || 0)
                  update((c) => {
                    const s = c.mods?.[si]
                    const opt = s?.options[oi]
                    if (!s || !opt) return
                    // the chosen option's cost is part of the card's cost
                    if (s.current === oi) {
                      const m = /-?\d+(?:\.\d+)?/.exec(c.cost)
                      if (m) c.cost = c.cost.replace(m[0], String(Number(m[0]) + cost - opt.cost))
                    }
                    opt.cost = cost
                  })
                }}
              />
              <button
                className="mods-x"
                title={t(lang, 'remove')}
                disabled={slot.options.length <= 1}
                onClick={() => {
                  // removing the chosen option: choose another first, so the
                  // card's weapons and cost follow
                  if (slot.current === oi) selectCardMod(si, oi === 0 ? 1 : 0)
                  setMods((m) => {
                    const s = m[si]!
                    s.options.splice(oi, 1)
                    if (s.current > oi) s.current--
                    if (s.current >= s.options.length) s.current = 0
                  })
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="mods-add small"
            onClick={() => setMods((m) => void m[si]!.options.push({ name: '', icon: null, cost: 0 }))}
          >
            {t(lang, 'addModOption')}
          </button>
          {card.weapons.length > 0 && (
            <div className="mods-weapons">
              <div className="mods-weapons-title" title={t(lang, 'modWeaponsHint')}>
                {t(lang, 'modWeapons')}
              </div>
              {card.weapons.map((w, wi) => {
                const other = w.modSlot != null && w.modSlot !== si ? (list[w.modSlot]?.name ?? '') : null
                return (
                  <label key={wi} className={`mods-weapon ${other != null ? 'other' : ''}`}>
                    <input
                      type="checkbox"
                      checked={w.modSlot === si}
                      onChange={(e) => {
                        const checked = e.target.checked
                        update((c) => {
                          const x = c.weapons[wi]
                          if (!x) return
                          if (checked) x.modSlot = si
                          else delete x.modSlot
                        })
                      }}
                    />
                    <span className="mods-weapon-name">
                      {w.name || '—'}
                      {w.count ? ` ${w.count}` : ''}
                    </span>
                    {other != null && <span className="mods-weapon-other">{other}</span>}
                  </label>
                )
              })}
            </div>
          )}
        </div>
      ))}
      <button
        className="mods-add"
        onClick={() =>
          setMods((m) =>
            m.push({
              name: t(lang, 'modNewSlot'),
              icon: DEFAULT_SLOT_ICON,
              current: 0,
              options: [{ name: t(lang, 'modDefaultOption'), icon: null, cost: 0 }],
            }),
          )
        }
      >
        {t(lang, 'addModSlot')}
      </button>

      {picker && (
        <PickerDialog
          title={t(lang, 'selectModIcon')}
          items={iconItems.items}
          groups={iconItems.groups}
          onPick={(key) => {
            const { slot, option } = picker
            setMods((m) => {
              if (option == null) m[slot]!.icon = key
              else m[slot]!.options[option]!.icon = key
            })
            setPicker(null)
          }}
          onUpload={(dataUrl) => {
            const { slot, option } = picker
            setMods((m) => {
              if (option == null) m[slot]!.icon = dataUrl
              else m[slot]!.options[option]!.icon = dataUrl
            })
            setPicker(null)
          }}
          onClear={
            picker.option != null
              ? () => {
                  const { slot, option } = picker
                  setMods((m) => void (m[slot]!.options[option!]!.icon = null))
                  setPicker(null)
                }
              : undefined
          }
          onCancel={() => setPicker(null)}
        />
      )}
    </div>
  )
}

function IconButton({ src, wide, onClick }: { src: string | null; wide?: boolean; onClick(): void }) {
  return (
    <button className={`mods-icon-btn ${wide ? 'wide' : ''}`} onClick={onClick}>
      {src ? <img src={src} alt="" /> : null}
    </button>
  )
}
