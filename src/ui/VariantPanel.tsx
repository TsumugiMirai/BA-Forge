import { useAppStore } from '../state/store'
import { gameModSlots } from '../data/gameMods'
import { ModificationsPanel } from './ModificationsPanel'

/** The game unit's modification slots (in-game variants) for the card being
 *  edited; picking an option rebuilds a game card from game data, while a
 *  changed card makes the slots its own (store.selectOption). */
export function VariantPanel() {
  const db = useAppStore((s) => s.db)
  const unitId = useAppStore((s) => s.selectedUnitId)
  const selection = useAppStore((s) => s.selection)
  const selectOption = useAppStore((s) => s.selectOption)

  if (!db || unitId == null) return null
  return (
    <ModificationsPanel
      className="variant-panel"
      slots={gameModSlots(db, unitId, selection)}
      // a game card is rebuilt for the variant; a changed card keeps its
      // edits and takes the slots as its own (store.selectOption)
      onSelect={(slot, option) => selectOption(Number(slot), Number(option))}
    />
  )
}
