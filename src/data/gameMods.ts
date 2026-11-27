// A game unit's modification slots (Modifications/Options tables) in the
// shape ui/ModificationsPanel shows.

import type { GameDb } from './db'
import type { VariantSelection } from './resolve'
import type { ModSlot } from '../ui/ModificationsPanel'
import type { CardModSlot } from '../card/model'
import { iconUrl, weaponIconUrl } from '../assets'
import { OPTION_ICON_FILES } from './optionIcons'

/** Modifications.Type of armor slots */
const ARMOR_SLOT = 5

/** Prettify unresolved localization keys like "Custom_Option_Default". */
export function prettyModName(s: string): string {
  return s.replace(/^Custom_(Option|Slot)_/, '').replace(/_/g, ' ')
}

/** default icon of a custom slot (as a card stores it, see maker/ModsEditor) */
export const DEFAULT_SLOT_ICON = 'icon:Modification Icon'

/** The game unit's slots as a card's own custom ones (names, icons, costs and
 *  the chosen options kept), to edit or pick from without rebuilding the card. */
export function customModSlots(slots: ModSlot[]): CardModSlot[] {
  return slots.map((s) => ({
    name: s.name,
    icon: s.iconRef ?? DEFAULT_SLOT_ICON,
    current: Math.max(0, s.options.findIndex((o) => o.key === s.current)),
    options: s.options.map((o) => ({ name: o.name, cost: o.cost, icon: o.iconRef ?? null })),
  }))
}

export function gameModSlots(db: GameDb, unitId: number, selection: VariantSelection): ModSlot[] {
  const mods = [...(db.unitModifications.get(unitId) ?? [])].sort((a, b) => a.Order - b.Order || a.Id - b.Id)
  return mods.map((mod) => {
    const opts = [...(db.modificationOptions.get(mod.Id) ?? [])].sort((a, b) => a.Order - b.Order || a.Id - b.Id)
    const current = selection[mod.Id] ?? (opts.find((o) => o.IsDefault) ?? opts[0])?.Id
    const file = (name: string | null) => (name ? OPTION_ICON_FILES[name] : undefined)
    const slotIcon = mod.Type === ARMOR_SLOT ? 'Modification Armor Slot Icon' : 'Modification Icon'
    return {
      key: String(mod.Id),
      name: prettyModName(db.loc(mod.UIName)),
      icon: iconUrl(slotIcon),
      iconRef: `icon:${slotIcon}`,
      current: String(current),
      options: opts.map((o) => ({
        key: String(o.Id),
        name: prettyModName(db.loc(o.UIName) || o.Name || `Option ${o.Id}`),
        cost: o.Cost,
        icon: file(o.OptionPicture) ? weaponIconUrl(file(o.OptionPicture)!) : null,
        iconRef: file(o.OptionPicture) ? `weapon:${file(o.OptionPicture)}` : null,
      })),
    }
  })
}
