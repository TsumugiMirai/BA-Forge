// CardModel: everything the card renders, as a plain serializable object.
// The resolver (data/resolve.ts) produces one from game data; the editor
// mutates a copy of it directly, so every visible field stays customizable.

/** Card presentation: "new" is the current in-game info card (adds the
 *  return-to-battlegroup timer, weapon Suppressed/CQC icons, ammo guidance
 *  icons, and compact target icons); "legacy" is the previous card style. */
export type CardStyle = 'legacy' | 'new'

export interface ArmorFacing {
  kinetic: string
  heat: string
}

export interface CardArmor {
  front: ArmorFacing
  sides: ArmorFacing
  rear: ArmorFacing
  top: ArmorFacing
}

export interface ArmorLabels {
  front: string
  sides: string
  rear: string
  top: string
}

/** what an expanded ammo stat line shows; the ones the compact row also shows
 *  (range, damage, penetration, dispersion ↔ accuracy) are kept in sync */
export type AmmoStatKind =
  | 'trajectory'
  | 'range'
  | 'damage'
  | 'blast'
  | 'dispersion'
  | 'penetration'
  | 'supply'

export interface StatLine {
  /** sprite key into the extracted icon set (InfocardConfig mapping) */
  icon: string | null
  label: string
  value: string
  /** ammo stat lines only; absent on cards saved before it existed (then
   *  recognised by label, see normalizeCard) */
  kind?: AmmoStatKind
}

export interface AbilityLine {
  icon: string | null
  name: string
  detail: string
}

export interface TraitChip {
  icon: string | null
  tooltip: string
  /** default sprite color when set (e.g. CQC renders green in game); absent
   *  keeps the sprite's own color. Users can still recolor via the ColorPanel. */
  tint?: string
  /** compact-mode sprite override (e.g. the pre-colored red "can't shoot on the
   *  move" sign); expanded keeps `icon`. */
  compactIcon?: string
}

export interface AmmoModel {
  icon: string | null
  name: string
  quantity: string
  /** yellow distance pill, e.g. "1200m" */
  rangePill: string
  traits: TraitChip[]
  /** guidance-type chips (Ammunitions.Seeker), pre-colored; new style only.
   *  Compact renders the icon(s) (centered in the plane ammo slot, or appended
   *  to the target column for ground/heli); expanded renders `guidanceLabel` as
   *  a text row. SEAD munitions (e.g. AGM-88 HARM) carry two chips. */
  guidance: TraitChip[]
  /** joined guidance names for the expanded "Guidance" stat row ('' if none) */
  guidanceLabel: string
  /** self-propelled munition (missile/cruise/ballistic/bomb) — its silhouette
   *  duplicates the weapon icon, so plane weapons drop it and its pills. */
  selfPropelled: boolean
  /** a missile (guided, air-to-air, cruise or ballistic; not a bomb): on a
   *  plane's compact card its range shows as a yellow pill on the weapon
   *  itself, like the game's UnitWeaponCompactInfo "Distance". Cards saved
   *  before this existed get it from the game icons on load
   *  (resolve.fillMissileFlags). */
  missile?: boolean
  /** label:value lines of the expanded ammo panel (damage model) */
  stats: StatLine[]
  /** key numbers for the compact row (pen | damage | accuracy columns) */
  compact: {
    penetration: string
    damage: string
    accuracy: string
    /** HEAT rounds render the penetration value orange */
    isHeat: boolean
    /** the third column shows the accuracy value instead of the trait icons —
     *  the game does this for indirect fire, cruise/ballistic missiles and
     *  bombs (UnitAmmoCompactInfo.SetAccuracy). Absent on older saved cards. */
    showAccuracy?: boolean
  }
}

export interface WeaponModel {
  icon: string | null
  name: string
  /** "x2" badge when identical weapons are merged, '' otherwise */
  count: string
  typeLabel: string
  traits: TraitChip[]
  /** new-style-only weapon traits (Suppressed, Close-quarters); kept apart from
   *  `traits` so the Legacy style renders exactly as before */
  newTraits: TraitChip[]
  stats: StatLine[]
  ammo: AmmoModel[]
  /** "7.5/min" practical rate of fire the compact card shows for main guns
   *  (UnitWeaponCompactInfo); absent for other weapons and older saved cards */
  rateOfFire?: string
}

/** an option of a custom modification slot (card maker's 改装件) */
export interface CardModOption {
  name: string
  /** sprite name or data URL; null = the slot's icon */
  icon: string | null
  /** points the option adds to (or takes off) the unit's cost */
  cost: number
}

/** a modification slot of a custom card, like the game's armor/weapon slots */
export interface CardModSlot {
  name: string
  icon: string | null
  options: CardModOption[]
  /** index of the chosen option */
  current: number
}

export interface CardModel {
  /** source unit id, null for fully custom cards */
  unitId: number | null
  /** per-field text color overrides, keyed by the EditableText colorKey
   *  (e.g. "name", "weapon.0.ammo.1.qty"); absent key = theme default */
  textColors?: Record<string, string>
  name: string
  cost: string
  countryId: number | null
  flagIcon: string | null
  /** sprite key or data-URL (uploaded portrait) */
  portrait: string | null
  /** uploaded background behind the portrait; when set, a game portrait is
   *  left out (an uploaded, transparent portrait sits on top of it) */
  background?: string | null
  /** the unit's arsenal silhouette (thumbnail file name or data URL); absent =
   *  the game unit's own */
  icon?: string | null
  /** arsenal category (UnitCategoryType id) the card is listed under;
   *  absent = the game unit's */
  category?: number
  /** custom modification slots; absent = the game unit's own (if any) */
  mods?: CardModSlot[]
  categoryLabel: string
  roleLabel: string
  description: string
  health: string
  armor: CardArmor | null
  /** facing-armor overlay over the portrait (ground vehicles only) */
  armorOverlay: boolean
  armorLabels: ArmorLabels
  stats: StatLine[]
  abilities: AbilityLine[]
  /** amphibious / airdroppable chips (bottom-right column with abilities) */
  tags: AbilityLine[]
  weapons: WeaponModel[]
  /** squad size for infantry, '' otherwise */
  squadSize: string
  /** "Return to battlegroup delay" as "M:SS" (the clock+skull stat). New-style
   *  only; empty on fully custom cards. */
  deathTimer: string
  /** aircraft unit: plane weapons drop the redundant ammo silhouette (the
   *  weapon icon already is the munition) and show guidance in that slot. */
  aircraft: boolean
}

export const EMPTY_VALUE = '-'

/** Armor facing labels: always the game's English wording, whatever the UI
 *  language (the owner's choice; the Chinese client says 正面/侧面/背面/顶部). */
export const ARMOR_LABELS: ArmorLabels = { front: 'Front', sides: 'Sides', rear: 'Rear', top: 'Top' }

const CHINESE_ARMOR_LABELS: ArmorLabels = { front: '正面', sides: '侧面', rear: '背面', top: '顶部' }

// Labels the resolver gave each ammo stat line, in both card languages — to
// recognise the lines of cards saved before StatLine.kind existed.
const STAT_KIND_BY_LABEL: Record<string, AmmoStatKind> = {
  'effective range': 'range',
  有效射程: 'range',
  damage: 'damage',
  'damage per second': 'damage',
  伤害: 'damage',
  每秒伤害: 'damage',
  penetration: 'penetration',
  穿深: 'penetration',
  dispersion: 'dispersion',
  武器散布: 'dispersion',
}

const NUMBER = /-?\d+(?:\.\d+)?/

/** first number in a display string ("450 - 720 mm …" → "450"), or null */
function firstNumber(s: string): string | null {
  return NUMBER.exec(s)?.[0] ?? null
}

/** `text` with its first number replaced by `num` (or `num` alone when the
 *  text has no number yet) — keeps units and trailing words as written */
function withFirstNumber(text: string, num: string): string {
  return NUMBER.test(text) ? text.replace(NUMBER, num) : num
}

function statOf(a: AmmoModel, kind: AmmoStatKind): StatLine | undefined {
  return a.stats.find((s) => (s.kind ?? STAT_KIND_BY_LABEL[s.label.trim().toLowerCase()]) === kind)
}

/** the compact accuracy column carries the horizontal dispersion ("3.6m")
 *  for indirect fire; other values ("100%", trait-only rows) stay apart */
function isDispersionAccuracy(a: AmmoModel): boolean {
  return a.compact.showAccuracy === true || /^\s*-?\d+(?:\.\d+)?\s*m\s*$/.test(a.compact.accuracy)
}

/**
 * Mirror an edit between the compact ammo row and the expanded ammo panel,
 * which show the same numbers in different shapes: range pill "1400m" ↔
 * "1400 m"; penetration "450" ↔ "450 - 720 mm Kinetic damage" (the compact
 * value is the at-range one, listed first); damage copied as is; accuracy
 * "3.6m" ↔ the H part of "V: 3m / H: 3.6m".
 */
export function syncAmmoEdit(
  a: AmmoModel,
  field: 'range' | 'penetration' | 'damage' | 'accuracy',
  from: 'compact' | 'expanded',
): void {
  if (field === 'damage') {
    const line = statOf(a, 'damage')
    if (!line) return
    if (from === 'compact') line.value = a.compact.damage
    else a.compact.damage = line.value
    return
  }
  if (field === 'range' || field === 'penetration') {
    const line = statOf(a, field)
    if (!line) return
    const compactText = field === 'range' ? a.rangePill : a.compact.penetration
    if (from === 'compact') {
      const n = firstNumber(compactText)
      if (n != null) line.value = withFirstNumber(line.value, n)
    } else {
      const n = firstNumber(line.value)
      if (n == null) return
      if (field === 'range') a.rangePill = withFirstNumber(a.rangePill, n)
      else a.compact.penetration = n
    }
    return
  }
  // accuracy ↔ horizontal dispersion
  const line = statOf(a, 'dispersion')
  if (!line || !isDispersionAccuracy(a)) return
  const H = /(H:\s*)(-?\d+(?:\.\d+)?)/
  if (from === 'compact') {
    const n = firstNumber(a.compact.accuracy)
    if (n != null && H.test(line.value)) line.value = line.value.replace(H, `$1${n}`)
  } else {
    const n = H.exec(line.value)?.[2]
    if (n != null) a.compact.accuracy = withFirstNumber(a.compact.accuracy, n)
  }
}

/** Which compact field an expanded stat line mirrors, if any. */
export function syncedFieldOfStat(line: StatLine): 'range' | 'penetration' | 'damage' | 'accuracy' | null {
  const kind = line.kind ?? STAT_KIND_BY_LABEL[line.label.trim().toLowerCase()]
  if (kind === 'range' || kind === 'penetration' || kind === 'damage') return kind
  if (kind === 'dispersion') return 'accuracy'
  return null
}

/** Bring a stored card (saved locally, online, or imported) up to date:
 *  English armor facing labels where it still has the Chinese defaults. */
export function normalizeCard(card: CardModel): CardModel {
  const labels = card.armorLabels
  if (labels)
    for (const k of Object.keys(ARMOR_LABELS) as (keyof ArmorLabels)[])
      if (labels[k] === CHINESE_ARMOR_LABELS[k]) labels[k] = ARMOR_LABELS[k]
  return card
}

/**
 * After removing the slot at `prefix{removed}` (e.g. prefix "weapon." or
 * "weapon.2.ammo."), drop its color overrides and shift higher indices down
 * so colors keep following their re-indexed weapons/ammo.
 */
export function removeIndexedColors(card: CardModel, prefix: string, removed: number) {
  const colors = card.textColors
  if (!colors) return
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(colors)) {
    const m = key.startsWith(prefix) ? /^(\d+)(\..+)$/.exec(key.slice(prefix.length)) : null
    if (!m) {
      next[key] = value
      continue
    }
    const n = Number(m[1])
    if (n === removed) continue
    next[prefix + (n > removed ? n - 1 : n) + m[2]] = value
  }
  card.textColors = next
}

/** where index `n` ends up when the item at `from` moves to `to` */
export function movedIndex(n: number, from: number, to: number): number {
  if (n === from) return to
  if (from < to && n > from && n <= to) return n - 1
  if (from > to && n >= to && n < from) return n + 1
  return n
}

/** Move `list[from]` to position `to`, carrying the indexed color overrides
 *  (`prefix` + index + ".…", e.g. "weapon.2.ammo.0.range") along with it. */
export function moveIndexed<T>(card: CardModel, list: T[], prefix: string, from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return
  const [item] = list.splice(from, 1)
  list.splice(to, 0, item!)
  const colors = card.textColors
  if (!colors) return
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(colors)) {
    const m = key.startsWith(prefix) ? /^(\d+)(\..+)$/.exec(key.slice(prefix.length)) : null
    next[m ? prefix + movedIndex(Number(m[1]), from, to) + m[2] : key] = value
  }
  card.textColors = next
}

export function emptyWeapon(): WeaponModel {
  return {
    icon: null,
    name: 'Weapon',
    count: '',
    typeLabel: '',
    traits: [],
    newTraits: [],
    stats: [],
    ammo: [],
  }
}

export function emptyAmmo(): AmmoModel {
  // Zero/absent numerics default to "0" (not "-"), matching the resolver's
  // formatting for real ammo rows.
  return {
    icon: null,
    name: 'Ammo',
    quantity: 'x1',
    rangePill: EMPTY_VALUE,
    traits: [],
    guidance: [],
    guidanceLabel: '',
    selfPropelled: false,
    stats: [],
    compact: { penetration: '0', damage: '0', accuracy: '0', isHeat: false },
  }
}

export function emptyTag(): AbilityLine {
  return { icon: null, name: '', detail: '' }
}

export function emptyArmor(): CardArmor {
  const f = (): ArmorFacing => ({ kinetic: EMPTY_VALUE, heat: EMPTY_VALUE })
  return { front: f(), sides: f(), rear: f(), top: f() }
}

export function emptyCard(): CardModel {
  return {
    unitId: null,
    name: 'Custom Unit',
    cost: EMPTY_VALUE,
    countryId: null,
    flagIcon: null,
    portrait: null,
    categoryLabel: '',
    roleLabel: '',
    description: '',
    health: EMPTY_VALUE,
    armor: emptyArmor(),
    armorOverlay: true,
    armorLabels: { ...ARMOR_LABELS },
    stats: [],
    abilities: [],
    tags: [],
    weapons: [],
    squadSize: '',
    deathTimer: '',
    aircraft: false,
  }
}
