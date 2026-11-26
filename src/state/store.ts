import { create } from 'zustand'
import type { GameDb } from '../data/db'
import { loadGameDb } from '../data/db'
import type { VariantSelection } from '../data/resolve'
import { resolveCard } from '../data/resolve'
import type { CardModel, CardStyle } from '../card/model'
import { normalizeCard } from '../card/model'
import type { LogModel } from '../log/logModel'
import { emptyLog, emptyLogEntry, logUnitFromCard } from '../log/logModel'
import type { SavedCard } from './savedCards'
import {
  loadSavedCards,
  newSavedCardId,
  parseSavedCardFile,
  persistSavedCards,
  serializeSavedCard,
} from './savedCards'
import type { CloudCardMeta } from '../cloud/cloudCards'
import {
  CloudConflictError,
  createCloudCard,
  deleteCloudCard,
  getCloudCard,
  listCloudCards,
  updateCloudCard,
} from '../cloud/cloudCards'
import { compressCardImages } from '../cloud/compressImages'
import { checkLogin, isRemembered, rememberLogin } from '../auth/auth'
import type { UiStringKey } from '../ui/i18n'

/** result line shown under the online library */
export interface CloudNotice {
  kind: 'ok' | 'error'
  key: UiStringKey
  /** raw error text appended to the message */
  detail?: string
}

export type Lang = 'eng' | 'chi'
/** which workspace is showing: the unit card, the kill-log editor, or the
 *  China specialization setup page (#china) */
export type View = 'card' | 'log' | 'china'

interface AppState {
  db: GameDb | null
  loadError: string | null
  /** language of the UI and of the card text (labels, types, trajectories…
   *  from the game's own language files; names stay as in game). Chinese by
   *  default; the last choice is remembered in this browser. */
  lang: Lang
  selectedUnitId: number | null
  selection: VariantSelection
  compact: boolean
  /** card presentation: the current in-game style ('new') or the previous
   *  card style ('legacy'). Pure display toggle — the model already carries
   *  everything both styles need. */
  style: CardStyle
  editMode: boolean
  /** current workspace: unit card or kill-log editor */
  view: View
  /** the kill-log editor's model (edits live here, parallel to `card`) */
  log: LogModel
  /** the card as displayed; starts as the resolved model, then absorbs edits */
  card: CardModel | null
  /** the displayed card has manual edits that a re-resolve would discard */
  dirty: boolean
  /** colorKey of the last-focused editable text; the ColorPanel recolors it */
  colorTarget: string | null
  /** card-switch action awaiting "discard edits?" confirmation */
  pendingAction: (() => void) | null
  /** custom card database (persisted to localStorage as JSON) */
  savedCards: SavedCard[]
  /** the last saveCard() could not be persisted (storage full/unavailable) */
  saveError: boolean

  /** shared online library entries (metadata only), newest first */
  cloudCards: CloudCardMeta[]
  /** the library list is being fetched */
  cloudListing: boolean
  /** an online save/load/delete is running */
  cloudBusy: boolean
  cloudNotice: CloudNotice | null
  /** the online entry the displayed card came from, so Save updates it in
   *  place (version guards against overwriting someone else's newer save) */
  cloudLinked: { id: string; version: number } | null
  /** nickname stored with online cards (remembered in this browser) */
  author: string
  /** passed the page login (src/auth); online features need it */
  authed: boolean

  load(): Promise<void>
  setLang(lang: Lang): Promise<void>
  selectUnit(unitId: number | null): void
  selectOption(modificationId: number, optionId: number): void
  setCompact(compact: boolean): void
  setStyle(style: CardStyle): void
  setEditMode(on: boolean): void
  setView(view: View): void
  setColorTarget(key: string | null): void
  /** apply a partial or full replacement of the displayed card */
  updateCard(mutate: (card: CardModel) => void): void
  /** mutate the kill-log model (mirrors updateCard for the log view) */
  updateLog(mutate: (log: LogModel) => void): void
  /** clear the kill log and re-seed it from the current card (if any) */
  resetLog(): void
  /** trade the log's team colors (killers red, victims blue, and back) */
  swapLogSides(): void
  /** set/clear a text-color override on whichever model the view shows */
  setColor(key: string, hex: string): void
  clearColor(key: string): void
  resetEdits(): void
  /** snapshot the displayed card into the saved list (overwrites same name) */
  saveCard(): void
  /** add an entry parsed from an exported .json file (overwrites same name) */
  importSavedCard(entry: SavedCard): void
  loadSavedCard(id: string): void
  deleteSavedCard(id: string): void
  /** run `action` now, or park it behind the unsaved-edits confirm dialog */
  guardEdits(action: () => void): void
  confirmPending(): void
  cancelPending(): void

  setAuthor(name: string): void
  /** check the page login; true when it matches (and remember it) */
  login(account: string, password: string): Promise<boolean>
  logout(): void
  /** fetch the online library list */
  refreshCloud(): Promise<void>
  /** open an online card in the editor (callers guard unsaved edits) */
  loadCloudCard(id: string): Promise<void>
  /** upload the displayed card: update its online entry, or add a new one
   *  when it has none or `asNew` is set */
  saveCloudCard(asNew?: boolean): Promise<void>
  removeCloudCard(id: string): Promise<void>
}

function resolve(db: GameDb, unitId: number, selection: VariantSelection): CardModel {
  return resolveCard(db, unitId, selection)
}

const LANG_KEY = 'ba-recard.lang'

/** The remembered language, Chinese when none (or storage is unavailable). */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'eng' || saved === 'chi') return saved
  } catch {
    // private window / blocked storage: fall through to the default
  }
  return 'chi'
}

function rememberLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    // not fatal: the choice just isn't remembered
  }
}

const AUTHOR_KEY = 'ba-recard.author'

function initialAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? ''
  } catch {
    return ''
  }
}

function errorText(e: unknown): string {
  if (e instanceof DOMException && e.name === 'AbortError') return 'timeout'
  return e instanceof Error ? e.message : String(e)
}

export const useAppStore = create<AppState>((set, get) => ({
  db: null,
  loadError: null,
  lang: initialLang(),
  selectedUnitId: null,
  selection: {},
  compact: true, // the game opens cards in compact mode
  style: 'new', // the current in-game card style; Legacy is opt-in

  editMode: false,
  // …/#china opens straight on the China specialization page
  view: typeof location !== 'undefined' && location.hash === '#china' ? 'china' : 'card',
  log: emptyLog(),
  card: null,
  dirty: false,
  colorTarget: null,
  pendingAction: null,
  savedCards: loadSavedCards(),
  saveError: false,
  cloudCards: [],
  cloudListing: false,
  cloudBusy: false,
  cloudNotice: null,
  cloudLinked: null,
  author: initialAuthor(),
  authed: isRemembered(),

  async load() {
    try {
      const db = await loadGameDb(get().lang)
      set({ db })
    } catch (e) {
      set({ loadError: e instanceof Error ? e.message : String(e) })
    }
  },

  async setLang(lang) {
    if (lang === get().lang) return
    try {
      const db = await loadGameDb(lang)
      rememberLang(lang)
      // The card text follows the language too: re-resolve the displayed
      // card, unless it carries manual edits, which are kept as they are.
      const { selectedUnitId, selection, dirty, card } = get()
      const relocalize = card && !dirty && selectedUnitId != null && db.units.has(selectedUnitId)
      set({
        lang,
        db,
        ...(relocalize ? { card: resolve(db, selectedUnitId, selection), colorTarget: null } : {}),
      })
    } catch (e) {
      set({ loadError: e instanceof Error ? e.message : String(e) })
    }
  },

  selectUnit(unitId) {
    const { db } = get()
    if (!db || unitId == null) {
      set({ selectedUnitId: unitId, selection: {}, card: null, dirty: false, colorTarget: null, cloudLinked: null })
      return
    }
    set({
      selectedUnitId: unitId,
      selection: {},
      card: resolve(db, unitId, {}),
      dirty: false,
      colorTarget: null,
      // a fresh card from the arsenal is not an online entry
      cloudLinked: null,
    })
  },

  selectOption(modificationId, optionId) {
    const { db, selectedUnitId, selection } = get()
    if (!db || selectedUnitId == null) return
    const next = { ...selection, [modificationId]: optionId }
    set({
      selection: next,
      card: resolve(db, selectedUnitId, next),
      dirty: false,
      colorTarget: null,
    })
  },

  setCompact(compact) {
    set({ compact })
  },

  setStyle(style) {
    set({ style })
  },

  setEditMode(on) {
    set(on ? { editMode: true } : { editMode: false, colorTarget: null })
  },

  setView(view) {
    if (view === get().view) return
    // Entering an empty log auto-seeds a first entry from the current card and
    // opens edit mode so the user can build immediately.
    if (view === 'log' && get().log.entries.length === 0) {
      const { db, card } = get()
      if (db && card)
        set({ log: { entries: [emptyLogEntry(logUnitFromCard(db, card))] }, editMode: true })
    }
    set({ view, colorTarget: null })
  },

  setColorTarget(key) {
    set({ colorTarget: key })
  },

  updateCard(mutate) {
    const { card } = get()
    if (!card) return
    const copy = structuredClone(card)
    mutate(copy)
    set({ card: copy, dirty: true })
  },

  updateLog(mutate) {
    const copy = structuredClone(get().log)
    mutate(copy)
    set({ log: copy })
  },

  resetLog() {
    const { db, card, log } = get()
    const entries = db && card ? [emptyLogEntry(logUnitFromCard(db, card))] : []
    // which side is "yours" is a standing preference, not log content — keep it
    set({ log: { entries, swapped: log.swapped }, colorTarget: null })
  },

  swapLogSides() {
    get().updateLog((l) => void (l.swapped = !l.swapped))
  },

  setColor(key, hex) {
    if (get().view === 'log') get().updateLog((l) => void ((l.textColors ??= {})[key] = hex))
    else get().updateCard((c) => void ((c.textColors ??= {})[key] = hex))
  },

  clearColor(key) {
    if (get().view === 'log')
      get().updateLog((l) => void (l.textColors && delete l.textColors[key]))
    else get().updateCard((c) => void (c.textColors && delete c.textColors[key]))
  },

  resetEdits() {
    const { db, selectedUnitId, selection } = get()
    if (!db || selectedUnitId == null) return
    set({ card: resolve(db, selectedUnitId, selection), dirty: false, colorTarget: null })
  },

  saveCard() {
    const { card, compact, style, selection } = get()
    if (!card) return
    get().importSavedCard({
      id: newSavedCardId(),
      name: card.name.trim() || 'Untitled',
      savedAt: Date.now(),
      compact,
      style,
      selection,
      card: structuredClone(card),
    })
    if (!get().saveError) set({ dirty: false })
  },

  importSavedCard(entry) {
    const { savedCards } = get()
    const existing = savedCards.find((s) => s.name === entry.name)
    const merged = existing ? { ...entry, id: existing.id } : entry
    const next = existing
      ? savedCards.map((s) => (s.id === existing.id ? merged : s))
      : [merged, ...savedCards]
    const ok = persistSavedCards(next)
    // even when persistence fails the entry stays loadable for this session
    set({ savedCards: next, saveError: !ok })
  },

  loadSavedCard(id) {
    const entry = get().savedCards.find((s) => s.id === id)
    if (!entry) return
    set({
      selectedUnitId: entry.card.unitId,
      selection: entry.selection ?? {},
      compact: entry.compact,
      style: entry.style ?? get().style,
      card: normalizeCard(structuredClone(entry.card)),
      dirty: false,
      colorTarget: null,
      cloudLinked: null,
    })
  },

  deleteSavedCard(id) {
    const next = get().savedCards.filter((s) => s.id !== id)
    persistSavedCards(next)
    set({ savedCards: next })
  },

  guardEdits(action) {
    if (get().dirty) set({ pendingAction: action })
    else action()
  },

  confirmPending() {
    const action = get().pendingAction
    set({ pendingAction: null })
    action?.()
  },

  cancelPending() {
    set({ pendingAction: null })
  },

  async login(account, password) {
    const ok = await checkLogin(account, password)
    if (ok) {
      rememberLogin(true)
      set({ authed: true })
    }
    return ok
  },

  logout() {
    rememberLogin(false)
    set({ authed: false, cloudCards: [], cloudLinked: null, cloudNotice: null })
  },

  setAuthor(name) {
    set({ author: name })
    try {
      localStorage.setItem(AUTHOR_KEY, name)
    } catch {
      // not fatal: the nickname just isn't remembered
    }
  },

  async refreshCloud() {
    set({ cloudListing: true })
    try {
      set({ cloudCards: await listCloudCards() })
    } catch (e) {
      set({ cloudNotice: { kind: 'error', key: 'cloudFailed', detail: errorText(e) } })
    } finally {
      set({ cloudListing: false })
    }
  },

  async loadCloudCard(id) {
    set({ cloudBusy: true, cloudNotice: null })
    try {
      const row = await getCloudCard(id)
      const entry = row ? parseSavedCardFile(JSON.stringify(row.data)) : null
      if (!row || !entry) {
        set({ cloudNotice: { kind: 'error', key: 'cloudMissing' } })
        void get().refreshCloud()
        return
      }
      set({
        selectedUnitId: entry.card.unitId,
        selection: entry.selection ?? {},
        compact: entry.compact,
        style: entry.style ?? get().style,
        card: normalizeCard(structuredClone(entry.card)),
        dirty: false,
        colorTarget: null,
        cloudLinked: { id: row.id, version: row.version },
      })
    } catch (e) {
      set({ cloudNotice: { kind: 'error', key: 'cloudFailed', detail: errorText(e) } })
    } finally {
      set({ cloudBusy: false })
    }
  },

  async saveCloudCard(asNew = false) {
    const { card, compact, style, selection, author, cloudLinked } = get()
    if (!card) return
    set({ cloudBusy: true, cloudNotice: null })
    try {
      const name = card.name.trim() || 'Untitled'
      // same JSON as an exported card file, so entries load like imports
      const payload = await compressCardImages(
        JSON.parse(
          serializeSavedCard({ id: '', name, savedAt: Date.now(), compact, style, selection, card }),
        ) as unknown,
      )
      const input = { name, author: author.trim(), unit_id: card.unitId, data: payload }
      const row =
        cloudLinked && !asNew
          ? await updateCloudCard(cloudLinked.id, cloudLinked.version, input)
          : await createCloudCard(input)
      set({
        cloudLinked: { id: row.id, version: row.version },
        dirty: false,
        cloudNotice: { kind: 'ok', key: cloudLinked && !asNew ? 'cloudUpdated' : 'cloudCreated' },
      })
      void get().refreshCloud()
    } catch (e) {
      set({
        cloudNotice:
          e instanceof CloudConflictError
            ? { kind: 'error', key: 'cloudConflict' }
            : { kind: 'error', key: 'cloudFailed', detail: errorText(e) },
      })
    } finally {
      set({ cloudBusy: false })
    }
  },

  async removeCloudCard(id) {
    set({ cloudBusy: true, cloudNotice: null })
    try {
      await deleteCloudCard(id)
      set((s) => ({
        cloudCards: s.cloudCards.filter((c) => c.id !== id),
        cloudLinked: s.cloudLinked?.id === id ? null : s.cloudLinked,
        cloudNotice: { kind: 'ok', key: 'cloudDeleted' },
      }))
    } catch (e) {
      set({ cloudNotice: { kind: 'error', key: 'cloudFailed', detail: errorText(e) } })
    } finally {
      set({ cloudBusy: false })
    }
  },
}))
