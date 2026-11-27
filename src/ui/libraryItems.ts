// Items of the weapon and ammunition libraries (the icon pickers of the card
// editor), with a category for each so the picker can filter by kind.

import type { GameDb } from '../data/db'
import { ammoIconUrl, weaponIconUrl } from '../assets'
import { TrajectoryLocKey, TrajectoryType, WeaponType, WeaponTypeLocKey } from '../data/enums'
import type { Lang } from '../state/store'
import type { PickerGroup, PickerItem } from './PickerDialog'

const WEAPON_GROUPS: { key: string; eng: string; chi: string; types: number[] }[] = [
  { key: 'small', eng: 'Small arms', chi: '轻武器', types: [1, 2, 3, 4, 5, 6, 25, 26, 27, 30, 40, 64] },
  { key: 'mg', eng: 'Heavy MG & autocannon', chi: '重机枪与机炮', types: [28, 29, 114, 115, 116, 141] },
  { key: 'gun', eng: 'Guns & artillery', chi: '火炮', types: [110, 111, 112] },
  { key: 'rocket', eng: 'Rockets & grenades', chi: '火箭与榴弹', types: [60, 61, 62, 63, 113, 140] },
  { key: 'atgm', eng: 'Anti-tank missiles', chi: '反坦克导弹', types: [80, 81] },
  { key: 'aa', eng: 'Anti-air missiles', chi: '防空导弹', types: [85, 86, 87, 88] },
  { key: 'strike', eng: 'Strike missiles', chi: '对地与巡航导弹', types: [82, 83, 84, 89] },
  { key: 'bomb', eng: 'Bombs', chi: '炸弹', types: [160, 161, 162] },
]

const AMMO_GROUPS: { key: string; eng: string; chi: string; types: number[] }[] = [
  { key: 'direct', eng: 'Direct fire', chi: '直射', types: [10] },
  { key: 'indirect', eng: 'Artillery & mortar', chi: '火炮与迫击炮', types: [20, 30] },
  { key: 'mlrs', eng: 'Rocket artillery', chi: '火箭炮', types: [40] },
  { key: 'missile', eng: 'Missiles', chi: '导弹', types: [110, 200, 300] },
  { key: 'bomb', eng: 'Bombs', chi: '炸弹', types: [400, 410] },
]

const OTHER = 'other'

function groupsOf(defs: typeof WEAPON_GROUPS, lang: Lang): PickerGroup[] {
  return [
    ...defs.map((g) => ({ key: g.key, label: g[lang === 'chi' ? 'chi' : 'eng'] })),
    { key: OTHER, label: lang === 'chi' ? '其他' : 'Other' },
  ]
}

function groupOf(defs: typeof WEAPON_GROUPS, type: number): string {
  return defs.find((g) => g.types.includes(type))?.key ?? OTHER
}

export function weaponLibrary(db: GameDb, lang: Lang): { items: PickerItem[]; groups: PickerGroup[] } {
  const seen = new Set<string>()
  const items: PickerItem[] = []
  for (const w of db.tables.Weapons) {
    const key = `${w.HUDIcon}|${w.HUDName}|${w.Type}`
    if (seen.has(key)) continue
    seen.add(key)
    const type = db.cardLocOr(WeaponTypeLocKey[w.Type], WeaponType[w.Type] ?? '')
    items.push({
      key: String(w.Id),
      label: db.cardLoc(w.HUDName) || w.Name || w.HUDIcon || `Weapon ${w.Id}`,
      sub: type,
      url: weaponIconUrl(w.HUDIcon),
      group: groupOf(WEAPON_GROUPS, w.Type),
      search: [w.Name, w.HUDIcon, type, WeaponType[w.Type]].filter(Boolean).join(' '),
    })
  }
  items.sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
  return { items, groups: groupsOf(WEAPON_GROUPS, lang) }
}

export function ammoLibrary(db: GameDb, lang: Lang): { items: PickerItem[]; groups: PickerGroup[] } {
  const seen = new Set<string>()
  const items: PickerItem[] = []
  for (const a of db.tables.Ammunitions) {
    const key = `${a.HUDIcon}|${a.HUDName}`
    if (seen.has(key)) continue
    seen.add(key)
    const trajectory = db.cardLocOr(TrajectoryLocKey[a.TrajectoryType], TrajectoryType[a.TrajectoryType] ?? '')
    items.push({
      key: String(a.Id),
      label: db.cardLoc(a.HUDName) || a.Name || a.HUDIcon || `Ammo ${a.Id}`,
      sub: trajectory,
      url: ammoIconUrl(a.HUDIcon),
      group: groupOf(AMMO_GROUPS, a.TrajectoryType),
      search: [a.Name, a.HUDIcon, trajectory].filter(Boolean).join(' '),
    })
  }
  items.sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
  return { items, groups: groupsOf(AMMO_GROUPS, lang) }
}
