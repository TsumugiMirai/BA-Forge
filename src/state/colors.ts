// Color overrides live on whichever model the current view shows — the card's
// `textColors` or the log's — keyed by a stable string (a text field's
// colorKey, or an icon's). One hook so texts and icons resolve them alike.
// A card shown read-only elsewhere passes its own colors (card/cardContext).

import { useContext } from 'react'
import { CardViewContext } from '../card/cardContext'
import { useAppStore } from './store'

/** Override for `key` on the current view's model; undefined = theme default. */
export function useColorOverride(key: string | undefined): string | undefined {
  const view = useContext(CardViewContext)
  const fromStore = useAppStore((s) => {
    if (!key || view?.colors) return undefined
    const colors = s.view === 'log' ? s.log.textColors : s.card?.textColors
    return colors?.[key]
  })
  return view?.colors ? (key ? view.colors[key] : undefined) : fromStore
}
