import { useAppStore } from '../state/store'
import { gameModSlots } from '../data/gameMods'
import { ModificationsPanel } from './ModificationsPanel'

/** The game unit's modification slots (in-game variants) for the card being
 *  edited; picking an option rebuilds the card from game data. */
export function VariantPanel() {
  const db = useAppStore((s) => s.db)
  const unitId = useAppStore((s) => s.selectedUnitId)
  const selection = useAppStore((s) => s.selection)
  const selectOption = useAppStore((s) => s.selectOption)
  const guardEdits = useAppStore((s) => s.guardEdits)

  if (!db || unitId == null) return null
  return (
    <ModificationsPanel
      className="variant-panel"
      slots={gameModSlots(db, unitId, selection)}
      // variant changes re-resolve the card, so they discard edits too
      onSelect={(slot, option) => guardEdits(() => selectOption(Number(slot), Number(option)))}
    />
  )
}
