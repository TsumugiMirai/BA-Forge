import type { GameDb } from './db'
import type {
  AbilityRow,
  AmmunitionRow,
  ArmorRow,
  MobilityRow,
  OptionRow,
  PlaneFlyPresetRow,
  SensorRow,
  UnitRow,
  WeaponRow,
} from './types'
import type {
  AbilityLine,
  AmmoModel,
  CardModel,
  StatLine,
  TraitChip,
  WeaponModel,
} from '../card/model'
import { EMPTY_VALUE } from '../card/model'
import {
  TrajectoryLocKey,
  TrajectoryType,
  UnitCategoryType,
  UnitRole,
  UnitType,
  WeaponType,
  WeaponTypeLocKey,
} from './enums'

/** Chosen option per modification id; missing entries use the default option. */
export type VariantSelection = Record<number, number>

// Infantry have no per-unit weight in the DB (all Weight=1); the game shows the
// squad's transport weight = members × a fixed per-soldier weight (Spetsnaz 8 →
// 1000; matches the 750/1000/1500 pattern for 6/8/12-man squads).
const INFANTRY_WEIGHT_PER_SOLDIER = 125

// "Return to battlegroup delay" (the clock+skull stat) — the delay before a
// DESTROYED unit comes back, which the game computes as RefundTimeOptions.IsDead
// in Economy.Systems.RefundSystem.GetPurchaseDelay. Its inputs are GameConfig's
// "Destroyed units" block (Assets/MonoBehaviour/GameConfig.asset):
//
//     ResurrectDelayFloor + ResurrectDelayMultiplier × cost + TimeModifierResurrect
//
// so the delay **scales with the unit's cost**, and every variant that moves the
// cost moves the timer with it. TimeModifierResurrect is a per-unit second-offset
// that the chosen options add to (AAVP MICLIC's CATFAE loadout +400 s); its
// sibling TimeModifierRefund belongs to the *repurchase* path (a unit returned to
// base alive, RepurchaseDelayFloor 30 + 0.5 × cost) and is NOT this stat.
// PlanesDeathPenalty is 0, so aircraft use the same formula.
// Checks out against the in-game reference card: Spetsnaz GRU, 110 pts,
// modifier 0 → 420 + 1.5 × 110 = 585 s = 9:45. New-style only; editable per card.
const RTB_DELAY_FLOOR = 420
const RTB_COST_MULTIPLIER = 1.5

/** Green highlight used for the CQC/Suppressed weapon icons. */
const TRAIT_GREEN = '#7cff81'

// Ammunitions.TrajectoryType at/above this are self-propelled munitions
// (Missile 110, Cruise 200, Ballistic 300, Bomb 400/410) whose silhouette
// duplicates the weapon icon; below it are guns/rockets/shells (Direct 10,
// Artillery 20, Mortar 30, MLRS 40) that keep their own ammo silhouette.
const SELF_PROPELLED_TRAJECTORY_MIN = 110

/** Guidance descriptors for a munition, keyed by Ammunitions.Seeker. A munition
 *  can carry several (SEAD missiles like AGM-88 HARM are both anti-radiation and
 *  fire-and-forget). The sprites carry their own color (semi-active radar red,
 *  fire-and-forget green, anti-radar amber), so they render untinted. */
const SEEKER_GUIDANCE: Record<number, { icon: string; key: string; fallback: string }[]> = {
  10: [{ icon: 'FF_Icon', key: 'ui_enum_seeker_ff', fallback: 'Fire-and-Forget' }],
  50: [{ icon: 'Terninal_Guidance_Icon', key: 'ui_enum_seeker_terminal', fallback: 'Terminal Guidance' }],
  100: [{ icon: 'Semi_Active_Icon', key: 'ui_enum_seeker_sa', fallback: 'Semi-Active' }],
  // UnitAmmoCompactInfo.SetAmmoTraits gives Seeker 200 only the anti-radar
  // chip; the fire-and-forget chip is reserved for Seeker 10.
  200: [{ icon: 'Anti_Radar_Icon', key: 'ui_enum_seeker_sead', fallback: 'Anti-Radiation' }],
}

// Ammunitions.TrajectoryType values whose compact row lists trait icons in the
// third column: direct fire (10) and guided missiles (100/110/120). Every other
// trajectory (artillery, mortar, MLRS, cruise/ballistic missiles, bombs) shows
// the accuracy value there instead (UnitAmmoCompactInfo.Init → SetAccuracy).
const TRAIT_COLUMN_TRAJECTORIES = new Set([10, 100, 110, 120])

/** UnitType values compared for equality, as the game's card code does */
const TYPE_INFANTRY = 2
const TYPE_VEHICLE = 4
const TYPE_HELICOPTER = 8
const TYPE_AIRCRAFT = 16
const TYPE_SHIP = 32
/** TargetType "Ground" — plane munitions aimed at a spot show accuracy */
const TARGET_GROUND = 1
/** UnitCategoryType Aircrafts — optics come from high-altitude sensors */
const CATEGORY_AIRCRAFTS = 6
/** WeaponType "Main gun": the compact card adds its rate of fire */
const WEAPON_MAIN_GUN = 110

// Display formatting, mirroring the game's InfocardConfig
// (docs/extracted/ASSETS.md): RoundDigits 2, EffectiveRangeMultiplier 2.
// Calibrated against the in-game screenshots in /samples: stat-strip values
// are unit-less; ranges/blast radius/dispersion are sim values × 2; damage is
// the raw value (no HUDMultiplier); optics/speed/weight display raw.
// Rechecked against the card code of build 1.2.2.1 (UnitInfoCard,
// UnitAmmoCompactInfo, UnitWeaponCompactInfo, AmmoInfoExpansionPanel,
// WeaponHelper): numbers print with "0.##"; damage, damage per second and
// rate of fire are first rounded to a multiple of 0.05.
const ROUND_DIGITS = 2
const EFFECTIVE_RANGE_MULTIPLIER = 2
const VALUE_STEP = 0.05
/** km/h per m/s, for plane speeds stored in their fly preset */
const MS_TO_KMH = 3.6
/** plane speed and turn radius are shown in steps of 5 */
const PLANE_STAT_STEP = 5
/** Ammunitions.IsTopArmorArmorAttack: lofted shots this steep hit top armor */
const TOP_ATTACK_LOFT_ANGLE = 30

function fmt(n: number | null | undefined, digits = ROUND_DIGITS): string {
  if (n == null || Number.isNaN(n)) return EMPTY_VALUE
  const r = Number(n.toFixed(digits))
  return String(r)
}

function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return EMPTY_VALUE
  return String(Math.round(n))
}

/** "2 - 3" for min/max pairs, collapsing when equal. */
function minMax(min: number, max: number, digits = ROUND_DIGITS): string {
  if (min === max || min <= 0) return fmt(max, digits)
  return `${fmt(min, digits)} - ${fmt(max, digits)}`
}

function effRange(n: number): number {
  return n * EFFECTIVE_RANGE_MULTIPLIER
}

/** UtilsClass.RoundToNearestMultiple: halves round away from zero. */
function roundToMultiple(n: number, step = VALUE_STEP): number {
  const q = n / step
  return (q < 0 ? -Math.round(-q) : Math.round(q)) * step
}

/** WeaponHelper.CanDisplayDamagePerSecond: rifles, SMGs and machine guns,
 *  shotguns, autocannons, AA and plane guns, gun pods. Their damage column
 *  shows damage per second ("12.5/s") instead of damage per hit. */
function canDisplayDps(weaponType: number): boolean {
  return (
    (weaponType >= 1 && weaponType <= 6) ||
    (weaponType >= 25 && weaponType <= 30) ||
    weaponType === 40 ||
    (weaponType >= 114 && weaponType <= 116) ||
    weaponType === 141
  )
}

/** WeaponHelper.RateOfFireSecond(weapon, count, 1, 1): shots per second over
 *  a whole magazine cycle (bursts, pauses and the reload), averaging the
 *  fastest pattern (min pauses, longest bursts) and the slowest one. */
function rateOfFireSecond(w: WeaponRow, count = 1): number {
  const m = w.MagazineSize
  const cycle = (pause: number, shotsPerBurst: number, reload: number) =>
    (pause / count) * (m / shotsPerBurst - 1) +
    (m - m / shotsPerBurst) * w.TimeBetweenShotsInBurst +
    reload / count
  const fast = cycle(w.TimeBetweenBurstsMin, w.ShotsPerBurstMax, w.MagazineReloadTimeMin)
  const slow = cycle(w.TimeBetweenBurstsMax, w.ShotsPerBurstMin, w.MagazineReloadTimeMax)
  const rate = m / Math.abs((slow - fast) * 0.5 + fast)
  return Number.isFinite(rate) ? rate : 0
}

/** Ammunitions.IsTopArmorArmorAttack: flagged top attack, a steep loft, or a
 *  fly-over warhead. */
function isTopArmorAttack(a: AmmunitionRow): boolean {
  return a.TopArmorAttack || (a.LoftAngle ?? 0) >= TOP_ATTACK_LOFT_ANGLE || (a.OverflyHeight ?? 0) > 0
}

/** AircraftHelper.GetRotationRadius(turnRate°/s, speed m/s), as written in
 *  the game (it is not the textbook v/ω). */
function planeTurnRadius(turnRate: number, speed: number): number {
  const t = Math.tan((turnRate * Math.PI) / 180)
  return ((t + 1) * speed) / t
}

/** .NET Math.Round / MathF.Round default: halves go to the even neighbour. */
function roundHalfEven(n: number): number {
  const r = Math.round(n)
  return Math.abs(n % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/** A plane's listed speed: its fly preset's MaxSpeed (m/s) in km/h, rounded,
 *  then rounded to a multiple of 5 (float32 maths like the game). */
function planeSpeed(preset: PlaneFlyPresetRow | undefined): number {
  if (!preset) return 0
  const kmh = roundHalfEven(Math.fround(Math.fround(preset.MaxSpeed) * Math.fround(MS_TO_KMH)))
  return roundHalfEven(kmh / PLANE_STAT_STEP) * PLANE_STAT_STEP
}

interface ResolvedLoadout {
  unit: UnitRow
  cost: number
  name: string
  armor: ArmorRow | null
  mobility: MobilityRow | null
  sensors: SensorRow[]
  abilities: AbilityRow[]
  /** turret slot index → turret id; options override slots cumulatively
   *  (e.g. Tu-22M3: Bay→T5/T6, Fuselage→T3/T4, Wings→T1/T2) */
  slots: Map<number, number>
  stealth: number
  portraitFile: string | null
  /** TimeModifierResurrect seconds: the unit's offset plus every chosen
   *  option's own offset */
  returnDelay: number
}

function pickDefault<T extends { IsDefault: boolean }>(rows: T[]): T | null {
  return rows.find((r) => r.IsDefault) ?? rows[0] ?? null
}

/** Resolve the base loadout of a unit (default armor/mobility/turrets/etc). */
function resolveBase(db: GameDb, unit: UnitRow): ResolvedLoadout {
  const armors = (db.unitArmors.get(unit.Id) ?? [])
    .map((r) => db.armors.get(r.ArmorId))
    .filter((a): a is ArmorRow => !!a)
  const mobilities = (db.unitPropulsions.get(unit.Id) ?? [])
    .map((r) => db.mobility.get(r.MobilityId))
    .filter((m): m is MobilityRow => !!m)
  const sensors = (db.unitSensors.get(unit.Id) ?? [])
    .map((r) => db.sensors.get(r.SensorId))
    .filter((s): s is SensorRow => !!s)
  const abilities = (db.unitAbilities.get(unit.Id) ?? [])
    .map((r) => db.abilities.get(r.AbilityId))
    .filter((a): a is AbilityRow => !!a && a.IsDefault)

  return {
    unit,
    cost: unit.Cost,
    name: unit.HUDName ?? unit.Name ?? '',
    armor: pickDefault(armors),
    mobility: pickDefault(mobilities),
    sensors,
    abilities,
    slots: turretSlotsOf(db, unit),
    stealth: unit.Stealth,
    portraitFile: unit.PortraitFileName,
    returnDelay: unit.TimeModifierResurrect ?? 0,
  }
}

/** Base slots for turrets that always render, keyed below any option slot
 *  index so they sort first. */
const BASE_SLOT = -1000

function turretSlotsOf(db: GameDb, unit: UnitRow): Map<number, number> {
  // TurretUnits is a pool, not a layout (Order is 0 on 95% of rows); the
  // slot indices live in the Options' TurretNId fields. Each option slot
  // seeds its IsDefault candidate, and the chosen option overrides only the
  // slots it names (BTR-MDM's "Nothing" option clears slot 2 but keeps the
  // default PKT turrets it never mentions). Seeding a turret both here and
  // via its option slot is what duplicated AAVP's MICLIC.
  const slotCandidates = new Map<number, number[]>()
  for (const mod of db.unitModifications.get(unit.Id) ?? [])
    for (const opt of db.modificationOptions.get(mod.Id) ?? [])
      for (let slot = 0; slot <= 20; slot++) {
        const id = (opt as unknown as Record<string, number | undefined>)[`Turret${slot}Id`]
        if (!id) continue
        const ids = slotCandidates.get(slot) ?? []
        ids.push(id)
        slotCandidates.set(slot, ids)
      }
  const referenced = new Set([...slotCandidates.values()].flat())

  const slots = new Map<number, number>()
  for (const [slot, ids] of slotCandidates) {
    const def = ids.find((id) => db.turrets.get(id)?.IsDefault)
    if (def) slots.set(slot, def)
  }
  // Always-present turrets: top-level defaults no option references (AAVP's
  // M2/Mk19 turret, BMP-3K Demidov's bow PKTs), ordered by TurretUnits.Order
  // and keyed below the option slots. Child turrets (cupolas) are not slots;
  // weaponsForTurretSlots attaches them to their parent.
  const rows = [...(db.unitTurrets.get(unit.Id) ?? [])].sort((a, b) => a.Order - b.Order)
  let i = 0
  for (const tu of rows) {
    const t = db.turrets.get(tu.TurretId)
    if (!t || t.ParentTurretId || referenced.has(t.Id) || !t.IsDefault) continue
    slots.set(BASE_SLOT + i++, t.Id)
  }
  // Units with no options and no default turrets (MC-130H): first top-level
  // turret per Order group.
  if (slots.size === 0)
    for (const tu of rows) {
      const t = db.turrets.get(tu.TurretId)
      if (t && !t.ParentTurretId && !slots.has(tu.Order)) slots.set(tu.Order, tu.TurretId)
    }
  return slots
}

function weaponsForTurretSlots(
  db: GameDb,
  unit: UnitRow,
  slotTurrets: Map<number, number>,
): WeaponRow[] {
  const weapons: WeaponRow[] = []
  const pushTurretWeapons = (turretId: number) => {
    const tws = [...(db.turretWeapons.get(turretId) ?? [])].sort(
      (a, b) => a.Order - b.Order,
    )
    for (const tw of tws) {
      const w = db.weapons.get(tw.WeaponId)
      if (w && !w.IsUnderbarrel) weapons.push(w)
    }
  }
  const unitTurrets = db.unitTurrets.get(unit.Id) ?? []
  const orders = [...slotTurrets.keys()].sort((a, b) => a - b)
  for (const order of orders) {
    const turretId = slotTurrets.get(order)!
    pushTurretWeapons(turretId)
    // Child turrets (cupola mounts: M1A1's commander HMG + loader MMG)
    // are active whenever their parent turret is, and swap with it
    // (TUSK's cupolas hang off the TUSK main turret).
    const children = unitTurrets
      .filter((tu) => db.turrets.get(tu.TurretId)?.ParentTurretId === turretId)
      .sort((a, b) => a.Order - b.Order)
    for (const child of children) pushTurretWeapons(child.TurretId)
  }
  // Infantry loadouts come from SquadMembers (one weapon entry per carrier,
  // so mergeWeapons yields correct xN counts). SquadWeapons is a superset
  // pool that includes weapons no member carries (e.g. Airborne Snipers'
  // XM7 row) — don't read it directly. Underbarrel launchers (M203) are
  // shown for infantry, unlike on turrets.
  if (unit.Type === UnitType.Infantry) {
    for (const m of db.squadMembers.get(unit.Id) ?? []) {
      for (const id of [m.PrimaryWeaponId, m.SpecialWeaponId]) {
        const w = id ? db.weapons.get(id) : null
        if (w) weapons.push(w)
      }
    }
  }
  return weapons
}

/** Apply a selected Option's overrides onto a loadout. */
function applyOption(db: GameDb, loadout: ResolvedLoadout, opt: OptionRow): ResolvedLoadout {
  const out = { ...loadout }
  // Option.Cost is a delta on the unit's base cost (e.g. +30 pts for an
  // armor package), not an absolute replacement.
  if (opt.Cost) out.cost = loadout.cost + opt.Cost
  if (opt.ReplaceUnitName) out.name = db.cardLoc(opt.ReplaceUnitName)
  else if (opt.ConcatenateWithUnitName)
    // direct concatenation, no separator: "BMP-3" + "M" → "BMP-3M" (the data
    // carries its own leading space when one is wanted, e.g. " Epokha")
    out.name = `${out.name}${db.cardLoc(opt.ConcatenateWithUnitName)}`
  if (opt.ArmorId) out.armor = db.armors.get(opt.ArmorId) ?? out.armor
  if (opt.MobilityId) out.mobility = db.mobility.get(opt.MobilityId) ?? out.mobility
  if (opt.StealthOverride) out.stealth = opt.StealthOverride
  if (opt.PortraitOverride) out.portraitFile = opt.PortraitOverride
  // Like Cost, the option's resurrect offset is a delta on the unit's, and
  // options accumulate across the modification chain.
  if (opt.TimeModifierResurrect) out.returnDelay = loadout.returnDelay + opt.TimeModifierResurrect

  const sensorOverrides: SensorRow[] = []
  if (opt.MainSensorId) {
    const s = db.sensors.get(opt.MainSensorId)
    if (s) sensorOverrides.push(s)
  }
  if (opt.ExtraSensorId) {
    const s = db.sensors.get(opt.ExtraSensorId)
    if (s) sensorOverrides.push(s)
  }
  if (sensorOverrides.length) out.sensors = sensorOverrides

  // Options assign extra abilities (e.g. Su-34 pylon options carry the
  // ECM/decoy pod); they add to the unit's default abilities, not replace.
  const abilityIds = [opt.Ability1Id, opt.Ability2Id, opt.Ability3Id].filter(Boolean)
  if (abilityIds.length) {
    const merged = [...loadout.abilities]
    for (const id of abilityIds) {
      const a = db.abilities.get(id)
      if (a && !merged.some((m) => m.Id === a.Id)) merged.push(a)
    }
    out.abilities = merged
  }

  // Turret slot overrides accumulate across the option chain — each option
  // only touches its own slots (wings/fuselage/bay pylons etc).
  let slots: Map<number, number> | null = null
  for (let slot = 0; slot <= 20; slot++) {
    const id = (opt as unknown as Record<string, number | undefined>)[`Turret${slot}Id`]
    if (id) {
      if (!slots) slots = new Map(loadout.slots)
      slots.set(slot, id)
    }
  }
  if (slots) out.slots = slots
  return out
}

/** Every name a unit can present across its variants — the base name plus any
 *  rename, concatenation, or unit-replacement an option produces. Lets unit
 *  search match variant names (searching "Jegeris" finds "Eesti Scouts"). */
export function unitSearchNames(db: GameDb, unit: UnitRow): string[] {
  const base = unit.HUDName ?? unit.Name ?? ''
  const names = new Set<string>()
  if (base) names.add(base)
  for (const mod of db.unitModifications.get(unit.Id) ?? [])
    for (const opt of db.modificationOptions.get(mod.Id) ?? []) {
      if (opt.ReplaceUnitName) names.add(db.cardLoc(opt.ReplaceUnitName))
      if (opt.ConcatenateWithUnitName) names.add(`${base}${db.cardLoc(opt.ConcatenateWithUnitName)}`)
      if (opt.ReplaceUnitId) {
        const rep = db.units.get(opt.ReplaceUnitId)
        if (rep) names.add(rep.HUDName ?? rep.Name ?? '')
      }
    }
  return [...names].filter(Boolean)
}

/** Resolve a unit + variant selection into the full card view model. */
export function resolveCard(
  db: GameDb,
  unitId: number,
  selection: VariantSelection = {},
): CardModel {
  let unit = db.units.get(unitId)
  if (!unit) throw new Error(`Unknown unit ${unitId}`)
  const baseCost = unit.Cost

  const mods = [...(db.unitModifications.get(unitId) ?? [])].sort(
    (a, b) => a.Order - b.Order || a.Id - b.Id,
  )
  const chosen: OptionRow[] = []
  for (const mod of mods) {
    const opts = [...(db.modificationOptions.get(mod.Id) ?? [])].sort(
      (a, b) => a.Order - b.Order || a.Id - b.Id,
    )
    const sel = selection[mod.Id]
    const opt = opts.find((o) => o.Id === sel) ?? opts.find((o) => o.IsDefault) ?? opts[0]
    if (opt) chosen.push(opt)
  }

  for (const opt of chosen) {
    if (opt.ReplaceUnitId) {
      const rep = db.units.get(opt.ReplaceUnitId)
      if (rep) unit = rep
    }
  }

  let loadout = resolveBase(db, unit)
  // Cost is always the armory card's base cost + option deltas. A replacement
  // unit's own Cost usually equals base+delta but is not authoritative (several
  // self-replacing options carry a nonzero delta, e.g. Airborne NGSW +10), and
  // counting both double-charges (Marines 95 showed as 120).
  loadout.cost = baseCost
  for (const opt of chosen) loadout = applyOption(db, loadout, opt)

  return buildCardModel(db, loadout, weaponsForTurretSlots(db, unit, loadout.slots))
}

function buildCardModel(db: GameDb, lo: ResolvedLoadout, weaponRows: WeaponRow[]): CardModel {
  const { unit } = lo
  const country = db.countries.get(unit.CountryId)
  const armor = lo.armor
  const mob = lo.mobility
  const squad = db.squadMembers.get(unit.Id) ?? []

  const isInf = unit.Type === UnitType.Infantry
  const isHel = (unit.Type & UnitType.Helicopter) !== 0
  const isAir = (unit.Type & UnitType.Aircraft) !== 0
  // UnitInfoCard.SetUnitStatistic picks the speed icon by exact unit type
  const cls =
    unit.Type === TYPE_INFANTRY
      ? 'inf'
      : unit.Type === TYPE_HELICOPTER
        ? 'hel'
        : unit.Type === TYPE_AIRCRAFT
          ? 'air'
          : 'car'

  // The facing-armor overlay is shown for ground vehicles; other classes get
  // an "Armor points" entry in the stats strip instead (see AH-1W sample).
  const hasFacings =
    !!armor &&
    (armor.KinArmorFront > 0 || armor.HeatArmorFront > 0 || armor.KinArmorSides > 0)
  const armorOverlay = !isInf && !isHel && !isAir && hasFacings

  // Stats strip: icon + unit-less value, in the order and under the
  // conditions of UnitInfoCard.SetUnitStatistic (build 1.2.2.1).
  const stats: StatLine[] = []
  const push = (icon: string | null, label: string, value: string) =>
    stats.push({ icon, label, value })

  const L = (key: string, fallback: string) => db.cardLocOr(key, fallback)

  if (armor && armor.ArmorValue > 0)
    push('Armor', L('ui_infocard_armor', 'Armor points'), fmtInt(armor.ArmorValue))
  if (armor && armor.MaxHealthPoints > 0)
    push(
      isInf ? 'Health points.inf' : 'Health points.car',
      L('ui_infocard_health', 'Hit points'),
      fmtInt(armor.MaxHealthPoints),
    )
  if (isInf)
    push('group', L('ui_infocard_squad_count', 'Squad members count'), String(squad.length))
  if (mob && mob.HeavyLiftWeight > 0)
    push('Load capacity', L('ui_infocard_cargo_capacity', 'Heavy lift capacity'), fmtInt(mob.HeavyLiftWeight))
  if (unit.InfantrySlots > 0)
    push('Seats', L('ui_infocard_cargo_seats', 'Seating capacity'), fmtInt(unit.InfantrySlots))
  // Optics: the best of ALL the unit's sensors (not the first row), ground
  // optics for everything but the Aircrafts category, which shows its best
  // high-altitude optics; × 2 like every range. No sensor → 0.
  const opticsOf = (s: SensorRow) =>
    unit.CategoryType === CATEGORY_AIRCRAFTS ? s.OpticsHighAltitude : s.OpticsGround
  const optics = lo.sensors.length > 0 ? Math.max(...lo.sensors.map(opticsOf)) : 0
  push('Optics', L('ui_infocard_optics', 'Optics'), fmt(effRange(optics)))
  // Stealth divides enemy detection range: display 1/value (AH-1W sample:
  // data 0.8 → shown 1.25)
  push('Stealth', L('ui_infocard_stealth', 'Stealth'), fmt(lo.stealth > 0 ? 1 / lo.stealth : 0))
  if (mob) {
    // Planes fly at their fly preset's MaxSpeed (m/s → km/h, steps of 5);
    // the mobility row's road speed means nothing for them.
    const preset = mob.FlyPresetId ? db.flyPresets.get(mob.FlyPresetId) : undefined
    const speed =
      unit.Type === TYPE_AIRCRAFT
        ? planeSpeed(preset)
        : unit.Type === TYPE_SHIP
          ? mob.MaxSpeedWater
          : mob.MaxSpeedRoad
    push(`Forward speed.${cls}`, L('ui_infocard_speed_forward', 'Forward speed'), fmt(speed))
    if (unit.Type === TYPE_VEHICLE)
      push('Speed backwards.car', L('ui_infocard_speed_back', 'Reverse speed'), fmt(mob.MaxSpeedReverse))
    if (unit.Type === TYPE_HELICOPTER)
      push('Agility turn rate.hel', L('ui_infocard_agility', 'Agility'), fmt(mob.Agility))
    if (unit.Type === TYPE_AIRCRAFT) {
      // planes show a turn radius in metres instead of agility, then fuel
      if (preset) {
        const radius = roundHalfEven(effRange(planeTurnRadius(preset.MaxSpeedYaw, preset.MaxSpeed)))
        push(
          'Agility turn rate.air',
          L('ui_infocard_plane_turn_radius', 'Turn radius'),
          String(Math.trunc(radius / PLANE_STAT_STEP) * PLANE_STAT_STEP),
        )
      }
      push('Fuel', L('ui_infocard_fuel', 'Fuel'), fmt(mob.LoiteringTime))
    }
  }
  // Weight is listed for infantry and ground vehicles only. Infantry carry no
  // meaningful unit.Weight (always 1); the card shows the squad's transport
  // weight = members × per-soldier weight.
  if (isInf || unit.Type === TYPE_VEHICLE) {
    const weightValue = isInf ? squad.length * INFANTRY_WEIGHT_PER_SOLDIER : unit.Weight
    push('Weight', L('ui_infocard_weight', 'Weight'), fmtInt(weightValue))
  }

  // One Ability row can carry several features (e.g. "Sprint Smoke",
  // "ECM Plane 20" = decoys + ECM) — the game renders one chip per feature.
  // Rows with no displayable feature ("Empty ability") produce no chips.
  // One chip per feature KIND: a variant-added ability (e.g. ECM pods)
  // updates the existing chip's value instead of adding a second icon.
  const chipsByKind = new Map<string, AbilityLine>()
  for (const a of lo.abilities)
    for (const [kind, chip] of abilityChips(db, a, isHel, isAir)) chipsByKind.set(kind, chip)
  // laser designation always renders at the bottom of the column
  const abilities: AbilityLine[] = [...chipsByKind.entries()]
    .sort(([a], [b]) => Number(a === 'laser') - Number(b === 'laser'))
    .map(([, chip]) => chip)

  // Amphibious / airdroppable chips live with the abilities in the
  // bottom-right column of the portrait, not in the stats strip.
  const tags: AbilityLine[] = []
  if (mob?.IsAmphibious)
    tags.push({ icon: 'Amphibious', name: L('ui_infocard_ability_amphibious', 'Amphibious'), detail: '' })
  if (mob?.IsAirDroppable)
    tags.push({ icon: 'airdrop', name: L('ui_infocard_ability_airdropable', 'Airdroppable'), detail: '' })

  const weapons = mergeWeapons(weaponRows, isInf).map((mw) => buildWeaponModel(db, unit, mw))

  return {
    unitId: unit.Id,
    name: lo.name,
    cost: fmtInt(lo.cost),
    countryId: unit.CountryId,
    flagIcon: country?.FlagFileName ?? null,
    portrait: lo.portraitFile,
    categoryLabel: UnitCategoryType[unit.CategoryType] ?? '',
    roleLabel: UnitRole[unit.Role] ?? '',
    description: db.cardLoc(unit.Description),
    health: armor ? fmtInt(armor.MaxHealthPoints) : EMPTY_VALUE,
    armor: armor
      ? {
          front: { kinetic: fmtInt(armor.KinArmorFront), heat: fmtInt(armor.HeatArmorFront) },
          sides: { kinetic: fmtInt(armor.KinArmorSides), heat: fmtInt(armor.HeatArmorSides) },
          rear: { kinetic: fmtInt(armor.KinArmorRear), heat: fmtInt(armor.HeatArmorRear) },
          top: { kinetic: fmtInt(armor.KinArmorTop), heat: fmtInt(armor.HeatArmorTop) },
        }
      : null,
    armorOverlay,
    armorLabels: {
      front: L('ui_infocard_armor_front', 'Front'),
      sides: L('ui_infocard_armor_side', 'Sides'),
      rear: L('ui_infocard_armor_rear', 'Rear'),
      top: L('ui_infocard_armor_top', 'Top'),
    },
    stats,
    abilities,
    tags,
    weapons,
    squadSize: squad.length > 0 ? String(squad.length) : '',
    deathTimer: fmtDuration(RTB_DELAY_FLOOR + RTB_COST_MULTIPLIER * lo.cost + lo.returnDelay),
    aircraft: isAir,
  }
}

/** Seconds → "M:SS" for the return-to-battlegroup delay stat. Truncated, as a
 *  clock is: the 1.5 × cost term lands on a half-second for every odd-priced
 *  unit. (Truncation is the conventional TimeSpan/timer rendering; the game's
 *  own formatter isn't recoverable from the IL2CPP export, whose method bodies
 *  are stubs, and the reference card's 585 s is whole either way.) */
function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

interface MergedWeapon {
  weapon: WeaponRow
  /** total mounts across all slots */
  count: number
  /** member weapon id → number of mounts (CanBeMerged loadouts may use
   *  several Weapon rows with the same display identity, e.g. Su-24M2's
   *  OFAB-100 racks are ids 453/454/455) */
  members: Map<number, number>
}

/** Group identical weapons regardless of slot position. `CanBeMerged`
 *  weapons merge by display identity (HUDName/icon/type) even across
 *  different Weapon rows; others merge by row id (Su-35S R-77-1 ×4).
 *  Infantry always merge by display identity: squads with two carriers of
 *  the same weapon use separate "Team1"/"Team2" rows differing only in aim
 *  time (CAAT Dragon's M47, Kornet/Metis/Igla/Verba teams), which the game
 *  shows as one entry. */
function mergeWeapons(rows: WeaponRow[], byDisplay = false): MergedWeapon[] {
  const out: MergedWeapon[] = []
  const byKey = new Map<string, MergedWeapon>()
  for (const w of rows) {
    const key = byDisplay || w.CanBeMerged
      ? `m:${w.HUDName ?? w.Name}|${w.HUDIcon}|${w.Type}`
      : `id:${w.Id}`
    let entry = byKey.get(key)
    if (!entry) {
      entry = { weapon: w, count: 0, members: new Map() }
      byKey.set(key, entry)
      out.push(entry)
    }
    entry.count++
    entry.members.set(w.Id, (entry.members.get(w.Id) ?? 0) + 1)
  }
  return out
}

// [kind, chip] per ability feature; icon names follow InfocardConfig's sprite
// mapping (docs/extracted/ASSETS.md). Kinds dedupe variant-updated features.
function abilityChips(
  db: GameDb,
  a: AbilityRow,
  isHel: boolean,
  isAir: boolean,
): [string, AbilityLine][] {
  const chips: [string, AbilityLine][] = []
  if (a.IsRadar)
    chips.push(['radar', { icon: 'Ability_Radar', name: db.cardLocOr('ui_infocard_ability_radar', 'Radar'), detail: '' }])
  if (a.IsLaserDesignator)
    chips.push([
      'laser',
      {
        icon: 'Laser designation',
        name: db.cardLocOr('ui_infocard_ability_laser', 'Laser designation'),
        detail: '',
      },
    ])
  if (a.IsInfantrySprint)
    chips.push(['sprint', { icon: 'Sprint', name: db.cardLocOr('ui_infocard_ability_sprint', 'Sprint'), detail: '' }])
  if (a.IsSmoke)
    chips.push([
      'smoke',
      {
        icon: 'Smoke screen',
        name: db.cardLocOr('ui_infocard_ability_smoke', 'Smoke grenades'),
        detail: a.SmokeAmmunitionQuantity ? `x${a.SmokeAmmunitionQuantity}` : '',
      },
    ])
  if (a.IsAPS)
    chips.push([
      'aps',
      {
        icon: 'APS',
        name: db.cardLocOr('ui_infocard_ability_aps', 'Active protection system'),
        detail: a.APSQuantity ? `x${a.APSQuantity}` : '',
      },
    ])
  if (a.IsDecoy)
    chips.push([
      'decoy',
      {
        icon: isAir ? 'Countermeasures.air' : isHel ? 'Countermeasures.hel' : 'Countermeasures',
        name: db.cardLocOr('ui_infocard_ability_decoys', 'Decoy flares'),
        detail: a.DecoyQuantity ? `x${a.DecoyQuantity}` : '',
      },
    ])
  if (a.ECMAccuracyMultiplier !== 1 && a.ECMAccuracyMultiplier !== 0)
    chips.push([
      'ecm',
      {
        icon: 'ECM',
        name: db.cardLocOr('ui_infocard_ability_ecm', 'Electronic countermeasures'),
        // displayed as accuracy REDUCTION: multiplier 0.7 → "30%"
        detail: `${Math.round((1 - a.ECMAccuracyMultiplier) * 100)}%`,
      },
    ])
  return chips
}

function buildWeaponModel(db: GameDb, unit: UnitRow, mw: MergedWeapon): WeaponModel {
  const { weapon: w, count, members } = mw
  const isAir = (unit.Type & UnitType.Aircraft) !== 0

  // Collect ammo across all member weapon rows; quantities are per mount, so
  // scale by mounts and combine rows sharing the same ammunition
  // (Su-24M2 14+12+12 OFAB-100 → one entry x38).
  const combined = new Map<number, { order: number; quantity: number }>()
  for (const r of db.unitWeaponAmmo.get(unit.Id) ?? []) {
    const mounts = members.get(r.WeaponId)
    if (!mounts) continue
    const prev = combined.get(r.AmmunitionId)
    if (prev) {
      prev.quantity += r.Quantity * mounts
      prev.order = Math.min(prev.order, r.Order)
    } else {
      combined.set(r.AmmunitionId, { order: r.Order, quantity: r.Quantity * mounts })
    }
  }
  const ammoRows = [...combined.entries()]
    .map(([ammunitionId, v]) => ({ ammunitionId, ...v }))
    .sort((a, b) => a.order - b.order)

  const traits: TraitChip[] = []
  // The hand icon marks weapons that CANNOT fire on the move (ui_infocard_weapon_static).
  // Compact uses the pre-colored red stop sign; expanded keeps the white hand.
  if (!w.CanShootOnTheMove)
    traits.push({
      icon: 'Order_Stop',
      compactIcon: 'CantShootOnTheMove',
      tooltip: db.cardLocOr('ui_infocard_weapon_static', "Can't shoot whilst moving"),
    })
  // Compact uses the pre-colored green autoloader gears; expanded keeps white.
  if (w.AutoLoaded)
    traits.push({
      icon: 'reload',
      compactIcon: 'AutoLoading',
      tooltip: db.cardLocOr('ui_infocard_weapon_autoloader', 'Autoloading'),
    })

  // New-style weapon traits, both drawn green: CQC first, Suppressed to its
  // right. Kept in a separate list so Legacy renders exactly the two above.
  const newTraits: TraitChip[] = []
  if (w.CQC)
    newTraits.push({ icon: 'CQC Icon', tooltip: db.cardLocOr('ui_infocard_weapon_cqc', 'Close quarter'), tint: TRAIT_GREEN })
  if (w.Silent)
    newTraits.push({ icon: 'Silent Icon', tooltip: db.cardLocOr('ui_infocard_weapon_silent', 'Suppressed'), tint: TRAIT_GREEN })

  // Format per the AH-1W sample: "Aim time 2 - 3 sec", "Magazine size 150",
  // "Reload time 15 - 20 sec".
  const stats: StatLine[] = []
  if (w.AimTimeMax > 0)
    stats.push({
      icon: null,
      label: db.cardLocOr('ui_infocard_weapon_aimtime', 'Aim time'),
      value: `${minMax(w.AimTimeMin, w.AimTimeMax)} sec`,
    })
  if (w.MagazineSize > 0)
    stats.push({
      icon: null,
      label: db.cardLocOr('ui_infocard_weapon_magazinesize', 'Magazine size'),
      value: fmtInt(w.MagazineSize),
    })
  if (w.MagazineReloadTimeMax > 0)
    stats.push({
      icon: null,
      label: db.cardLocOr('ui_infocard_weapon_reloadtime', 'Reload time'),
      value: `${minMax(w.MagazineReloadTimeMin, w.MagazineReloadTimeMax)} sec`,
    })

  // Planes whose weapon fires missiles or bombs get the game's dedicated
  // munitions row (UnitWeaponCompactInfo, isAircraft): no range/count pills,
  // and accuracy instead of target icons for ground-aimed munitions.
  const firstAmmo = ammoRows.length ? db.ammunitions.get(ammoRows[0]!.ammunitionId) : undefined
  const planeMunitions = isAir && !!firstAmmo && firstAmmo.TrajectoryType >= SELF_PROPELLED_TRAJECTORY_MIN
  const ammo = ammoRows.map((r) => {
    const a = db.ammunitions.get(r.ammunitionId)
    return buildAmmoModel(db, a ?? null, r.quantity, w, planeMunitions)
  })

  // Main guns list their practical rate of fire under the weapon
  // (UnitWeaponCompactInfo: WeaponHelper.RateOfFire(weapon, 1) per minute).
  const rateOfFire =
    w.Type === WEAPON_MAIN_GUN && !canDisplayDps(w.Type)
      ? `${fmt(roundToMultiple(rateOfFireSecond(w, 1) * 60))}/min`
      : undefined

  // A plane's missiles/bombs hide their ammo count pill (the weapon icon
  // already IS the munition — see AmmoModel.selfPropelled), so the weapon badge
  // has to carry the munition TOTAL, not the number of pylons it hangs on: one
  // rack holds several bombs (B-2 → a single bomb-bay slot with 80 Mk82s,
  // A-10C → 2 triple-rails with 6 Mavericks). Guns and rocket pods keep their
  // pills, so their badge stays the mount count.
  const badge =
    isAir && ammo.length > 0 && ammo.every((a) => a.selfPropelled)
      ? ammoRows.reduce((sum, r) => sum + r.quantity, 0)
      : count

  return {
    icon: w.HUDIcon,
    name: db.cardLoc(w.HUDName) || w.Name || 'Weapon',
    count: badge > 1 ? `x${fmtInt(badge)}` : '',
    typeLabel: db.cardLocOr(WeaponTypeLocKey[w.Type], WeaponType[w.Type] ?? ''),
    traits,
    newTraits,
    stats,
    ammo,
    ...(rateOfFire ? { rateOfFire } : {}),
  }
}

function buildAmmoModel(
  db: GameDb,
  a: AmmunitionRow | null,
  quantity: number,
  weapon: WeaponRow,
  planeMunitions = false,
): AmmoModel {
  if (!a) {
    return {
      icon: null,
      name: 'Unknown',
      quantity: `x${fmtInt(quantity)}`,
      rangePill: EMPTY_VALUE,
      traits: [],
      guidance: [],
      guidanceLabel: '',
      selfPropelled: false,
      stats: [],
      compact: { penetration: '0', damage: '0', accuracy: '0', isHeat: false },
    }
  }
  const L = (key: string, fallback: string) => db.cardLocOr(key, fallback)

  // Target-type chips in the order of UnitAmmoCompactInfo.SetTargetTraits
  // (projectiles before aircraft; only the Projectile bit counts), then the
  // ammo traits of SetAmmoTraits.
  const traits: TraitChip[] = []
  if (a.TargetType & UnitType.Infantry)
    traits.push({ icon: 'Target Type Infantry Icon', tooltip: L('ui_infocard_ammo_target_infantry', 'Target - infantry') })
  if (a.TargetType & UnitType.Vehicle)
    traits.push({ icon: 'Target Type Vehicles Icon', tooltip: L('ui_infocard_ammo_target_vehicles', 'Target - vehicles') })
  if (a.TargetType & UnitType.Helicopter)
    traits.push({ icon: 'Target Type Helicopters Icon', tooltip: L('ui_infocard_ammo_target_helicopters', 'Target - helicopters') })
  if (a.TargetType & UnitType.Projectile)
    traits.push({ icon: 'Target Type Missiles Icon', tooltip: L('ui_infocard_ammo_target_missiles', 'Target - missiles') })
  if (a.TargetType & UnitType.Aircraft)
    traits.push({ icon: 'Target Type Aircrafts Icon', tooltip: L('ui_infocard_ammo_target_air', 'Target - aircraft') })
  if (a.LaserGuided)
    traits.push({ icon: 'Laser designation', tooltip: L('ui_infocard_ammo_laser', 'Laser guided') })
  if (isTopArmorAttack(a))
    traits.push({ icon: 'Top Attack Type Icon', tooltip: L('ui_infocard_ammo_top_attack', 'Top armor damage') })
  // NoDamageFalloff area munitions: burning ones are napalm, the rest cluster
  // (Ammunitions.IsNapalm / IsClusterAmmo)
  if (a.NoDamageFalloff && (a.DamageOverTimeDuration ?? 0) > 0)
    traits.push({ icon: 'Napalm_Icon', tooltip: L('ui_infocard_ammo_napalm', 'Napalm') })
  else if (a.NoDamageFalloff)
    traits.push({ icon: 'Claster_Icon', tooltip: L('ui_infocard_ammo_cluster', 'Cluster munition') })

  // Guidance (Ammunitions.Seeker): pre-colored chips for compact + a joined
  // label for the expanded "Guidance" text row. New style only (rendered so).
  const guidanceDefs = SEEKER_GUIDANCE[a.Seeker] ?? []
  const guidance: TraitChip[] = guidanceDefs.map((g) => ({ icon: g.icon, tooltip: L(g.key, g.fallback) }))
  const guidanceLabel = guidanceDefs.map((g) => L(g.key, g.fallback)).join(', ')

  const isHeat = a.ArmorTargeted === 2
  const armorTypeName =
    a.ArmorTargeted === 1
      ? L('ui_infocard_ammo_kinetic', 'Kinetic damage')
      : isHeat
        ? L('ui_infocard_ammo_heat', 'Explosive damage')
        : ''
  const bestRange = Math.max(a.GroundRange, a.LowAltRange, a.HighAltRange)

  // Expanded panel lines, matching the AH-1W sample exactly:
  // trajectory, effective range (×2), raw damage, blast radius (×2),
  // dispersion (×2), "20 - 40 mm Kinetic damage", supply weight in kg.
  const stats: StatLine[] = []
  const push = (label: string, value: string) => stats.push({ icon: null, label, value })
  if (TrajectoryType[a.TrajectoryType])
    push(
      L('ui_infocard_ammo_trajectory', 'Shell trajectory'),
      db.cardLocOr(TrajectoryLocKey[a.TrajectoryType], TrajectoryType[a.TrajectoryType]!),
    )
  // Fast-firing weapons list damage per second (rate of fire × damage per
  // hit), everything else the damage per hit; both rounded to 0.05.
  const dps = canDisplayDps(weapon.Type)
  const damageValue = dps
    ? `${fmt(roundToMultiple(rateOfFireSecond(weapon) * a.Damage))}/s`
    : fmt(roundToMultiple(a.Damage))
  if (bestRange > 0)
    push(L('ui_infocard_ammo_effective_range', 'Effective range'), `${fmtInt(effRange(bestRange))} m`)
  push(
    dps ? L('ui_infocard_ammo_damage_per_second', 'Damage per second') : L('ui_infocard_ammo_damage', 'Damage'),
    damageValue,
  )
  if (a.HealthAOERadius > 0)
    push(L('ui_infocard_ammo_radius_blast', 'Blast radius'), `${fmtInt(effRange(a.HealthAOERadius))} m`)
  if (a.DispersionHorizontalRadius > 0 || a.DispersionVerticalRadius > 0)
    push(
      L('ui_infocard_ammo_dispersion', 'Dispersion'),
      `V: ${fmt(effRange(a.DispersionVerticalRadius), 1)}m / H: ${fmt(effRange(a.DispersionHorizontalRadius), 1)}m`,
    )
  // Penetration reads "at max range - at point blank" (the max-range value
  // first), or one value when both are equal.
  if (a.PenetrationAtMinRange > 0 || a.PenetrationAtGroundRange > 0) {
    const atRange = fmt(a.PenetrationAtGroundRange)
    const pointBlank = fmt(a.PenetrationAtMinRange)
    push(
      L('ui_infocard_ammo_penetration', 'Penetration'),
      `${atRange === pointBlank ? atRange : `${atRange} - ${pointBlank}`} mm ${armorTypeName}`.trim(),
    )
  }
  if (a.SupplyCost > 0)
    push(L('ui_infocard_ammo_supply_cost', 'Supply weight'), `${fmt(a.SupplyCost)} kg`)

  // Third compact column: trait icons for direct fire and guided missiles,
  // the accuracy value for everything else. Plane missiles/bombs show accuracy
  // only when aimed at the ground.
  const showAccuracy = planeMunitions
    ? a.TargetType === TARGET_GROUND
    : !TRAIT_COLUMN_TRAJECTORIES.has(a.TrajectoryType)

  return {
    icon: a.HUDIcon,
    name: db.cardLoc(a.HUDName) || a.Name || 'Ammo',
    // the count pill shows rounds: stored quantity × HUDMultiplier (machine
    // gun belts are stored in bursts of 5, so a PKT's 400 shows as 2000)
    quantity: `x${fmtInt(quantity * (a.HUDMultiplier || 1))}`,
    rangePill: bestRange > 0 ? `${fmtInt(effRange(bestRange))}m` : EMPTY_VALUE,
    traits,
    guidance,
    guidanceLabel,
    selfPropelled: a.TrajectoryType >= SELF_PROPELLED_TRAJECTORY_MIN,
    stats,
    compact: {
      // The game's compact row shows the penetration at MAXIMUM range
      // (PenetrationAtGroundRange) — T-90M's Svinets-1 reads 450, not its
      // 720 point-blank value. Zero shows "0" (e.g. SSO's Flashbang).
      penetration: fmt(a.PenetrationAtGroundRange),
      damage: damageValue,
      accuracy: showAccuracy
        ? `${fmt(effRange(a.DispersionHorizontalRadius))}m`
        : a.Seeker
          ? '100%'
          : a.DispersionHorizontalRadius > 0
            ? `${fmt(effRange(a.DispersionHorizontalRadius), 1)}m`
            : '0',
      isHeat,
      showAccuracy,
    },
  }
}
