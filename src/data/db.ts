import type {
  Tables,
  UnitRow,
  CountryRow,
  ArmorRow,
  MobilityRow,
  SensorRow,
  AbilityRow,
  TurretRow,
  WeaponRow,
  AmmunitionRow,
  ModificationRow,
  OptionRow,
  PlaneFlyPresetRow,
  SpecializationRow,
} from './types'
import { unitSearchNames } from './resolve'

const TABLE_NAMES = [
  'Units',
  'Countries',
  'Specializations',
  'SpecializationAvailabilities',
  'TransportAvailabilities',
  'PlaneFlyPresets',
  'Armors',
  'Mobility',
  'Sensors',
  'Abilities',
  'Turrets',
  'Weapons',
  'Ammunitions',
  'Modifications',
  'Options',
  'UnitArmors',
  'UnitPropulsions',
  'SensorUnits',
  'UnitAbilities',
  'TurretUnits',
  'TurretWeapons',
  'WeaponAmmunitions',
  'SquadMembers',
  'SquadWeapons',
] as const

/** Fully-loaded game database with id and foreign-key indexes. */
export class GameDb {
  constructor(
    readonly tables: Tables,
    readonly localization: Record<string, string>,
    /** strings the card renders: the UI language, with English for keys the
     *  game leaves untranslated (the in-game card is localized too — the
     *  Chinese client labels it 正面/侧面/穿深/伤害…; unit, weapon and ammo
     *  names are raw strings, not keys, so they stay as in game) */
    readonly cardLocalization: Record<string, string> = localization,
  ) {
    // The game resolves localization keys case-insensitively: the JSON keys
    // are all lowercase while DB references are mixed case
    // (e.g. Options.UIName "Custom_Option_2xR73" → key "custom_option_2xr73").
    this.locLower = new Map(
      Object.entries(localization).map(([k, v]) => [k.toLowerCase(), v]),
    )
    this.cardLower = new Map(
      Object.entries(cardLocalization).map(([k, v]) => [k.toLowerCase(), v]),
    )
    this.units = indexById(tables.Units)
    this.countries = indexById(tables.Countries)
    this.armors = indexById(tables.Armors)
    this.mobility = indexById(tables.Mobility)
    this.sensors = indexById(tables.Sensors)
    this.abilities = indexById(tables.Abilities)
    this.turrets = indexById(tables.Turrets)
    this.weapons = indexById(tables.Weapons)
    this.ammunitions = indexById(tables.Ammunitions)
    this.options = indexById(tables.Options)

    this.unitArmors = groupBy(tables.UnitArmors, (r) => r.UnitId)
    this.unitPropulsions = groupBy(tables.UnitPropulsions, (r) => r.UnitId)
    this.unitSensors = groupBy(tables.SensorUnits, (r) => r.UnitId)
    this.unitAbilities = groupBy(tables.UnitAbilities, (r) => r.UnitId)
    this.unitTurrets = groupBy(tables.TurretUnits, (r) => r.UnitId)
    this.turretWeapons = groupBy(tables.TurretWeapons, (r) => r.TurretId)
    this.unitWeaponAmmo = groupBy(tables.WeaponAmmunitions, (r) => r.UnitId)
    this.unitModifications = groupBy(tables.Modifications, (r) => r.UnitId)
    this.modificationOptions = groupBy(tables.Options, (r) => r.ModificationId)
    this.squadMembers = groupBy(tables.SquadMembers, (r) => r.UnitId)
    this.squadWeapons = groupBy(tables.SquadWeapons, (r) => r.UnitId)
    this.flyPresets = indexById(tables.PlaneFlyPresets)
    this.specializations = indexById(tables.Specializations)

    // Which specializations offer a unit: its own availability row, plus the
    // rows it rides along with as a transport (BTRs, Humvees, Bradleys… have
    // no availability of their own).
    this.unitSpecs = new Map()
    const addSpec = (unitId: number, specId: number) => {
      const set = this.unitSpecs.get(unitId)
      if (set) set.add(specId)
      else this.unitSpecs.set(unitId, new Set([specId]))
    }
    const availability = indexById(tables.SpecializationAvailabilities)
    for (const r of tables.SpecializationAvailabilities) addSpec(r.UnitId, r.SpecializationId)
    for (const r of tables.TransportAvailabilities) {
      const a = availability.get(r.SpecializationAvailabilityId)
      if (a) addSpec(r.UnitId, a.SpecializationId)
    }
  }

  units: Map<number, UnitRow>
  countries: Map<number, CountryRow>
  armors: Map<number, ArmorRow>
  mobility: Map<number, MobilityRow>
  sensors: Map<number, SensorRow>
  abilities: Map<number, AbilityRow>
  turrets: Map<number, TurretRow>
  weapons: Map<number, WeaponRow>
  ammunitions: Map<number, AmmunitionRow>
  options: Map<number, OptionRow>

  unitArmors: Map<number, Tables['UnitArmors']>
  unitPropulsions: Map<number, Tables['UnitPropulsions']>
  unitSensors: Map<number, Tables['SensorUnits']>
  unitAbilities: Map<number, Tables['UnitAbilities']>
  unitTurrets: Map<number, Tables['TurretUnits']>
  turretWeapons: Map<number, Tables['TurretWeapons']>
  unitWeaponAmmo: Map<number, Tables['WeaponAmmunitions']>
  unitModifications: Map<number, ModificationRow[]>
  modificationOptions: Map<number, OptionRow[]>
  squadMembers: Map<number, Tables['SquadMembers']>
  squadWeapons: Map<number, Tables['SquadWeapons']>
  flyPresets: Map<number, PlaneFlyPresetRow>
  specializations: Map<number, SpecializationRow>
  /** unit id → ids of the specializations whose arsenal offers it */
  unitSpecs: Map<number, Set<number>>

  private locLower: Map<string, string>
  private cardLower: Map<string, string>
  private searchText?: Map<number, string>

  /** UI-language translation (case-insensitive); falls back to the key. */
  loc(key: string | null | undefined): string {
    if (!key) return ''
    return this.localization[key] ?? this.locLower.get(key.toLowerCase()) ?? key
  }

  /** Card-content translation in the UI language (English where the game
   *  has no translation); falls back to the key, so raw names pass through. */
  cardLoc(key: string | null | undefined): string {
    if (!key) return ''
    return this.cardLocalization[key] ?? this.cardLower.get(key.toLowerCase()) ?? key
  }

  /** Card-content translation with explicit fallback; strings with tooltip
   *  text after a newline are trimmed to their first line (card labels). */
  cardLocOr(key: string | null | undefined, fallback: string): string {
    const v = key
      ? (this.cardLocalization[key] ?? this.cardLower.get(key.toLowerCase()))
      : undefined
    const s = v ?? fallback
    const nl = s.indexOf('\n')
    return (nl >= 0 ? s.slice(0, nl) : s).trim()
  }

  /** UI-language translation with explicit fallback (first line only). */
  locOr(key: string | null | undefined, fallback: string): string {
    const v = key
      ? (this.localization[key] ?? this.locLower.get(key.toLowerCase()))
      : undefined
    const s = v ?? fallback
    const nl = s.indexOf('\n')
    return (nl >= 0 ? s.slice(0, nl) : s).trim()
  }

  /** Units shown as standalone Arsenal cards. Role 0 filters out internal
   *  spawned entities like "C-17 Globemaster (takeoff)". */
  armoryUnits(): UnitRow[] {
    return this.tables.Units.filter(
      (u) => u.DisplayInArmory && !u.IsUnitModification && u.Role !== 0,
    )
  }

  /** Nations shown in the arsenal's filter row (Hidden ones such as the
   *  editor's are left out), in table order like the game. */
  armoryCountries(): CountryRow[] {
    return this.tables.Countries.filter((c) => !c.Hidden)
  }

  /** Specializations the arsenal shows for a nation (or for every visible
   *  nation when `countryId` is null), in table order. */
  armorySpecs(countryId: number | null): SpecializationRow[] {
    const visible = new Set(this.armoryCountries().map((c) => c.Id))
    return this.tables.Specializations.filter(
      (s) => s.ShowInHangar && (countryId == null ? visible.has(s.CountryId) : s.CountryId === countryId),
    )
  }

  /** Lowercased searchable text per armory unit — its name plus every variant
   *  name — so search matches renamed variants (e.g. "Jegeris" → Eesti Scouts).
   *  Built lazily and cached on first use. */
  unitSearchText(unitId: number): string {
    if (!this.searchText) {
      this.searchText = new Map()
      for (const u of this.armoryUnits())
        this.searchText.set(u.Id, unitSearchNames(this, u).join('\n').toLowerCase())
    }
    return this.searchText.get(unitId) ?? ''
  }
}

function indexById<T extends { Id: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((r) => [r.Id, r]))
}

function groupBy<T>(rows: T[], key: (r: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = map.get(k)
    if (arr) arr.push(r)
    else map.set(k, [r])
  }
  return map
}

/** Fetch a data file, retrying network errors and 5xx answers: GitHub Pages
 *  occasionally returns a 503 for one of the ~25 files right after a deploy
 *  (or over a flaky proxy), and one miss would otherwise fail the whole app. */
async function fetchJson<T>(path: string, attempts = 4): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 600 * i))
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${path}`)
      if (res.ok) return (await res.json()) as T
      lastError = new Error(`Failed to load ${path}: ${res.status}`)
      if (res.status < 500) break // a 404 will not fix itself
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to load ${path}`)
}

export async function loadGameDb(lang = 'eng'): Promise<GameDb> {
  const [tableArrays, localization, engLocalization] = await Promise.all([
    Promise.all(TABLE_NAMES.map((t) => fetchJson<unknown[]>(`data/tables/${t}.json`))),
    fetchJson<Record<string, string>>(`data/localization/${lang}.json`),
    lang === 'eng'
      ? Promise.resolve<Record<string, string> | null>(null)
      : fetchJson<Record<string, string>>('data/localization/eng.json'),
  ])
  const tables = Object.fromEntries(
    TABLE_NAMES.map((t, i) => [t, tableArrays[i]]),
  ) as unknown as Tables
  // Card text follows the UI language like the game's own card; keys the
  // language file leaves empty (770 in chi.json) keep the English string.
  const cardLocalization = engLocalization ? { ...engLocalization } : localization
  if (engLocalization)
    for (const [key, value] of Object.entries(localization))
      if (typeof value === 'string' && value.trim() !== '') cardLocalization[key] = value
  return new GameDb(tables, localization, cardLocalization)
}
