// A game unit's modification slots (Modifications/Options tables) in the
// shape ui/ModificationsPanel shows.

import type { GameDb } from './db'
import type { VariantSelection } from './resolve'
import { fillMissileFlags, resolveCard } from './resolve'
import type { ModSlot } from '../ui/ModificationsPanel'
import type { CardModel, CardModSlot, WeaponModel } from '../card/model'
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

/** a weapon entry as shown (name, icon, mount count): how the same game weapon
 *  is recognised in two variants' lists */
function weaponKey(w: WeaponModel): string {
  return `${w.name}|${w.icon ?? ''}|${w.count}`
}

/**
 * For each option of game slot `slotIndex`: the indices, in that variant's
 * weapon list, of the weapons the option brings, i.e. those not shared by
 * every option of the slot (the main gun stays whatever the machine-gun slot
 * picks). Lists are compared as multisets, so a second, identical machine gun
 * counts as the option's own.
 */
function optionWeapons(lists: WeaponModel[][]): number[][] {
  const counts = lists.map((l) => {
    const m = new Map<string, number>()
    for (const w of l) m.set(weaponKey(w), (m.get(weaponKey(w)) ?? 0) + 1)
    return m
  })
  const shared = new Map<string, number>()
  for (const [k, n] of counts[0] ?? []) shared.set(k, Math.min(n, ...counts.map((c) => c.get(k) ?? 0)))
  return lists.map((l) => {
    const left = new Map(shared)
    const own: number[] = []
    l.forEach((w, i) => {
      const n = left.get(weaponKey(w)) ?? 0
      if (n > 0) left.set(weaponKey(w), n - 1)
      else own.push(i)
    })
    return own
  })
}

/**
 * Make a game unit's slots the card's own, weapons included, so picking an
 * option swaps the weapons as in the game: the card's weapons the chosen
 * options bring are tagged with their slot, and every other option carries
 * the game's weapons for it. The card's weapons are matched to the game's by
 * position when the lists have the same length (renamed in place, e.g.
 * Kord → QJZ-171), else by name and icon; unmatched ones stay the unit's own.
 */
export function makeGameSlotsCustom(db: GameDb, card: CardModel, unitId: number, selection: VariantSelection) {
  const slots = gameModSlots(db, unitId, selection)
  const mods = customModSlots(slots)
  const variant = (sel: VariantSelection) => fillMissileFlags(db, resolveCard(db, unitId, sel)).weapons
  const current = variant(selection)
  const inPlace = current.length === card.weapons.length

  slots.forEach((slot, si) => {
    const lists = slot.options.map((o) => variant({ ...selection, [Number(slot.key)]: Number(o.key) }))
    const own = optionWeapons(lists)
    const mod = mods[si]!
    mod.options.forEach((opt, oi) => {
      if (oi === mod.current) return
      const weapons = own[oi]!.map((i) => structuredClone(lists[oi]![i]!))
      if (weapons.length > 0) opt.weapons = weapons
    })
    // the chosen option's weapons are on the card already
    for (const gi of own[mod.current] ?? []) {
      const w = current[gi]
      if (!w) continue
      const ci = inPlace
        ? gi
        : card.weapons.findIndex((c) => c.modSlot == null && weaponKey(c) === weaponKey(w))
      const target = card.weapons[ci]
      if (target && target.modSlot == null) target.modSlot = si
    }
  })
  card.mods = mods
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
