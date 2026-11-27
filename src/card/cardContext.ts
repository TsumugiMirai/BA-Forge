// A card can be shown outside the card maker (the arsenal page, a
// specialization's unit popup) without touching the card being edited: wrap
// it in <CardView value={{ readOnly, compact, colors }}> and the card, its
// texts and icons read these instead of the editor's state.

import { createContext, useContext } from 'react'
import { useAppStore } from '../state/store'

export interface CardViewOptions {
  /** never editable, whatever the editor's edit mode */
  readOnly?: boolean
  /** compact or expanded layout; absent = the editor's choice */
  compact?: boolean
  /** this card's color overrides (the editor's card has its own) */
  colors?: Record<string, string>
}

export const CardViewContext = createContext<CardViewOptions | null>(null)
export const CardView = CardViewContext.Provider

export function useCardView(): CardViewOptions | null {
  return useContext(CardViewContext)
}

export function useCardEditMode(): boolean {
  const view = useContext(CardViewContext)
  const editMode = useAppStore((s) => s.editMode)
  return editMode && !view?.readOnly
}

export function useCardCompact(): boolean {
  const view = useContext(CardViewContext)
  const compact = useAppStore((s) => s.compact)
  return view?.compact ?? compact
}
