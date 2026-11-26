import { create } from 'zustand'
import type { GameDb } from '../data/db'
import { loadGameDb } from '../data/db'
import type { VariantSelection } from '../data/resolve'
import { fillMissileFlags, resolveCard } from '../data/resolve'
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
import { CloudAuthError, CloudHttpError, CloudMissingTableError } from '../cloud/rest'
import type { Account, LoginResult, RegisterInput, RegisterResult } from '../auth/auth'
import {
  currentAccount,
  isLoggedIn,
  login as serverLogin,
  logout as forgetLogin,
  onLoginExpired,
  register as serverRegister,
  rememberAccount,
} from '../auth/auth'
import type { PasswordChangeResult } from '../cloud/account'
import { changePassword as serverChangePassword, fetchMe, saveDisplayName } from '../cloud/account'
import type { SpecRow } from '../cloud/specs'
import { ensureSpecs, listSpecs, setCardSpecs as serverSetCardSpecs } from '../cloud/specs'
import type { UiStringKey } from '../ui/i18n'

/** result line shown next to the online actions */
export interface CloudNotice {
  kind: 'ok' | 'error'
  key: UiStringKey
  /** raw error text appended to the message */
  detail?: string
}

export type Lang = 'eng' | 'chi'
/** which page is showing: the card maker (unit card, or its kill-log
 *  editor), the card library (#library) or the China specialization setup
 *  (#china) */
export type View = 'card' | 'log' | 'library' | 'china'
/** the card maker's two workspaces */
export type WorkView = 'card' | 'log'

/** the page an address opens (…/BA-ReCard/#library), null for the card maker */
export function viewFromHash(hash: string): View | null {
  if (hash === '#china') return 'china'
  if (hash === '#library') return 'library'
  return null
}

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
  /** current page */
  view: View
  /** what the card maker shows when it is opened again: card or kill log */
  workView: WorkView
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

  /** the logged-in account (null when logged out, and briefly for a login
   *  remembered from before accounts had names) */
  account: Account | null
  /** logged in (src/auth); the library and China pages need it */
  authed: boolean
  /** the server turned the remembered login down (it expired, or the
   *  password was changed); the login form says so */
  loginExpired: boolean
  /** the password used to log in is shorter than new ones may be (the old
   *  shared account); the account dialog suggests changing it */
  weakPassword: boolean
  /** the login/register dialog, opened from the header */
  authDialog: 'login' | 'register' | null
  /** the account dialog (name, password, admin page) */
  accountDialog: boolean

  /** the six China specializations (null until loaded) */
  specs: SpecRow[] | null
  specsLoading: boolean
  specsNotice: CloudNotice | null
  /** specializations picked for the displayed card before it is uploaded;
   *  the upload puts it into them */
  pendingSpecIds: number[]
  /** a card's specializations are being saved */
  specBusy: boolean

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
  /** save the displayed card where it came from: its online entry when it
   *  has one (and someone is logged in), else this browser; true on success */
  saveCurrent(): Promise<boolean>
  /** add an entry parsed from an exported .json file (overwrites same name) */
  importSavedCard(entry: SavedCard): void
  loadSavedCard(id: string): void
  deleteSavedCard(id: string): void
  /** upload a card saved in this browser to the online library as a new card */
  uploadSavedCard(id: string): Promise<void>
  /** run `action` now, or park it behind the unsaved-edits confirm dialog */
  guardEdits(action: () => void): void
  confirmPending(): void
  cancelPending(): void

  /** log in on the server; 'ok' also remembers the login in this browser */
  login(account: string, password: string): Promise<LoginResult>
  /** create an account with an invite code and log in with it */
  register(input: RegisterInput): Promise<RegisterResult>
  logout(): void
  /** ask the server who is logged in (name and role) */
  refreshAccount(): Promise<void>
  setDisplayName(name: string): Promise<boolean>
  changePassword(oldPassword: string, newPassword: string): Promise<PasswordChangeResult>
  openAuth(mode: 'login' | 'register' | null): void
  openAccount(open: boolean): void

  /** fetch the online library list */
  refreshCloud(): Promise<void>
  /** open an online card in the editor (callers guard unsaved edits);
   *  false when it could not be opened (the notice says why) */
  loadCloudCard(id: string): Promise<boolean>
  /** upload the displayed card: update its online entry, or add a new one
   *  when it has none or `asNew` is set; true on success */
  saveCloudCard(asNew?: boolean): Promise<boolean>
  removeCloudCard(id: string): Promise<void>

  /** fetch the specializations (creating missing preset rows) */
  refreshSpecs(): Promise<void>
  /** take a specialization row the China page just saved */
  replaceSpec(row: SpecRow): void
  /** put an online card into exactly these specializations; true on success */
  setCardSpecs(cardId: string, specIds: number[]): Promise<boolean>
  togglePendingSpec(specId: number): void
}

function resolve(db: GameDb, unitId: number, selection: VariantSelection): CardModel {
  return resolveCard(db, unitId, selection)
}

/** a stored card ready for the editor: a copy brought up to the current model */
function upgradeCard(db: GameDb | null, stored: CardModel): CardModel {
  const card = normalizeCard(structuredClone(stored))
  return db ? fillMissileFlags(db, card) : card
}

const LANG_KEY = 'ba-recard.lang'
/** the free-text nickname the library used before accounts; no longer used */
const OLD_AUTHOR_KEY = 'ba-recard.author'

/** The remembered language, Chinese when none (or storage is unavailable). */
function initialLang(): Lang {
  try {
    localStorage.removeItem(OLD_AUTHOR_KEY)
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

function errorText(e: unknown): string {
  if (e instanceof DOMException && e.name === 'AbortError') return 'timeout'
  return e instanceof Error ? e.message : String(e)
}

/** the notice for a failed online action; none when the login was turned
 *  down, since the login form replaces the online features then */
function cloudFailure(e: unknown): CloudNotice | null {
  if (e instanceof CloudAuthError) return null
  if (e instanceof CloudHttpError && e.reason === 'not_owner') return { kind: 'error', key: 'cloudNotOwner' }
  return { kind: 'error', key: 'cloudFailed', detail: errorText(e) }
}

/** the displayed card in the exported-file format, images compressed */
async function cardPayload(entry: SavedCard): Promise<unknown> {
  return compressCardImages(JSON.parse(serializeSavedCard(entry)) as unknown)
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
  // …/#library and …/#china open straight on those pages
  view: (typeof location !== 'undefined' && viewFromHash(location.hash)) || 'card',
  workView: 'card',
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
  account: currentAccount(),
  authed: isLoggedIn(),
  loginExpired: false,
  weakPassword: false,
  authDialog: null,
  accountDialog: false,
  specs: null,
  specsLoading: false,
  specsNotice: null,
  pendingSpecIds: [],
  specBusy: false,

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
    // a fresh card from the arsenal is not an online entry
    const fresh = { dirty: false, colorTarget: null, cloudLinked: null, pendingSpecIds: [], cloudNotice: null }
    if (!db || unitId == null) {
      set({ selectedUnitId: unitId, selection: {}, card: null, ...fresh })
      return
    }
    set({ selectedUnitId: unitId, selection: {}, card: resolve(db, unitId, {}), ...fresh })
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
    set({
      view,
      colorTarget: null,
      // notices belong to the page they were shown on
      cloudNotice: null,
      ...(view === 'card' || view === 'log' ? { workView: view } : {}),
    })
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
    if (!get().saveError) set({ dirty: false, cloudNotice: { kind: 'ok', key: 'savedLocally' } })
  },

  async saveCurrent() {
    const { cloudLinked, authed } = get()
    if (cloudLinked && authed) return get().saveCloudCard(false)
    get().saveCard()
    return !get().saveError
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
      card: upgradeCard(get().db, entry.card),
      dirty: false,
      colorTarget: null,
      cloudLinked: null,
      pendingSpecIds: [],
      cloudNotice: null,
    })
  },

  deleteSavedCard(id) {
    const next = get().savedCards.filter((s) => s.id !== id)
    persistSavedCards(next)
    set({ savedCards: next })
  },

  async uploadSavedCard(id) {
    const entry = get().savedCards.find((s) => s.id === id)
    if (!entry) return
    set({ cloudBusy: true, cloudNotice: null })
    try {
      await createCloudCard({ name: entry.name, unit_id: entry.card.unitId, data: await cardPayload(entry) })
      set({ cloudNotice: { kind: 'ok', key: 'cloudCreated' } })
      void get().refreshCloud()
    } catch (e) {
      set({ cloudNotice: cloudFailure(e) })
    } finally {
      set({ cloudBusy: false })
    }
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
    const result = await serverLogin(account, password)
    if (result === 'ok') {
      set({
        account: currentAccount(),
        authed: true,
        loginExpired: false,
        weakPassword: password.length < 6,
        authDialog: null,
      })
      void get().refreshCloud()
      void get().refreshSpecs()
    }
    return result
  },

  async register(input) {
    const result = await serverRegister(input)
    if (result === 'ok') {
      set({ account: currentAccount(), authed: true, loginExpired: false, weakPassword: false, authDialog: null })
      void get().refreshCloud()
      void get().refreshSpecs()
    }
    return result
  },

  logout() {
    forgetLogin()
    set({
      account: null,
      authed: false,
      loginExpired: false,
      weakPassword: false,
      accountDialog: false,
      cloudCards: [],
      cloudLinked: null,
      cloudNotice: null,
      specs: null,
      specsNotice: null,
    })
  },

  async refreshAccount() {
    if (!get().authed) return
    try {
      const account = await fetchMe()
      if (!account) {
        // the account behind this login no longer exists
        get().logout()
        return
      }
      rememberAccount(account)
      set({ account })
    } catch {
      // offline or refused: keep what is known; a turned-down login is
      // handled by onLoginExpired
    }
  },

  async setDisplayName(name) {
    try {
      const account = await saveDisplayName(name)
      if (!account) return false
      rememberAccount(account)
      set({ account })
      return true
    } catch {
      return false
    }
  },

  changePassword(oldPassword, newPassword) {
    return serverChangePassword(oldPassword, newPassword).then((result) => {
      if (result === 'ok') set({ weakPassword: false })
      return result
    })
  },

  openAuth(mode) {
    set({ authDialog: mode })
  },

  openAccount(open) {
    set({ accountDialog: open })
  },

  async refreshCloud() {
    if (!get().authed) return
    set({ cloudListing: true })
    try {
      set({ cloudCards: await listCloudCards() })
    } catch (e) {
      set({ cloudNotice: cloudFailure(e) })
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
        return false
      }
      set({
        selectedUnitId: entry.card.unitId,
        selection: entry.selection ?? {},
        compact: entry.compact,
        style: entry.style ?? get().style,
        card: upgradeCard(get().db, entry.card),
        dirty: false,
        colorTarget: null,
        cloudLinked: { id: row.id, version: row.version },
        pendingSpecIds: [],
      })
      // keep the list entry current (someone may have saved it meanwhile)
      set((s) => ({
        cloudCards: s.cloudCards.some((c) => c.id === row.id)
          ? s.cloudCards.map((c) => (c.id === row.id ? { ...c, ...metaOf(row) } : c))
          : [metaOf(row), ...s.cloudCards],
      }))
      return true
    } catch (e) {
      set({ cloudNotice: cloudFailure(e) })
      return false
    } finally {
      set({ cloudBusy: false })
    }
  },

  async saveCloudCard(asNew = false) {
    const { card, compact, style, selection, cloudLinked, pendingSpecIds } = get()
    if (!card) return false
    set({ cloudBusy: true, cloudNotice: null })
    try {
      const name = card.name.trim() || 'Untitled'
      // same JSON as an exported card file, so entries load like imports
      const data = await cardPayload({ id: '', name, savedAt: Date.now(), compact, style, selection, card })
      const input = { name, unit_id: card.unitId, data }
      const updating = !!cloudLinked && !asNew
      const row =
        cloudLinked && !asNew
          ? await updateCloudCard(cloudLinked.id, cloudLinked.version, input)
          : await createCloudCard(input)
      set((s) => ({
        cloudLinked: { id: row.id, version: row.version },
        dirty: false,
        cloudNotice: { kind: 'ok', key: updating ? 'cloudUpdated' : 'cloudCreated' },
        cloudCards: [metaOf(row), ...s.cloudCards.filter((c) => c.id !== row.id)],
        pendingSpecIds: [],
      }))
      // a card uploaded for the first time joins the specializations picked for it
      if (!cloudLinked && pendingSpecIds.length > 0) await get().setCardSpecs(row.id, pendingSpecIds)
      return true
    } catch (e) {
      set({
        cloudNotice: e instanceof CloudConflictError ? { kind: 'error', key: 'cloudConflict' } : cloudFailure(e),
      })
      return false
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
      // the server also took it out of its specializations
      void get().refreshSpecs()
    } catch (e) {
      set({ cloudNotice: cloudFailure(e) })
    } finally {
      set({ cloudBusy: false })
    }
  },

  async refreshSpecs() {
    if (!get().authed) return
    set({ specsLoading: true })
    try {
      set({ specs: await ensureSpecs(await listSpecs()), specsNotice: null })
    } catch (e) {
      if (e instanceof CloudAuthError) return
      set({
        specsNotice:
          e instanceof CloudMissingTableError
            ? { kind: 'error', key: 'specsMissing' }
            : { kind: 'error', key: 'cloudFailed', detail: errorText(e) },
      })
    } finally {
      set({ specsLoading: false })
    }
  },

  replaceSpec(row) {
    set((s) => ({ specs: s.specs?.map((r) => (r.id === row.id ? row : r)) ?? [row] }))
  },

  async setCardSpecs(cardId, specIds) {
    set({ specBusy: true })
    try {
      await serverSetCardSpecs(cardId, specIds)
      await get().refreshSpecs()
      return true
    } catch (e) {
      set({ cloudNotice: cloudFailure(e) })
      return false
    } finally {
      set({ specBusy: false })
    }
  },

  togglePendingSpec(specId) {
    set((s) => ({
      pendingSpecIds: s.pendingSpecIds.includes(specId)
        ? s.pendingSpecIds.filter((id) => id !== specId)
        : [...s.pendingSpecIds, specId].sort((a, b) => a - b),
    }))
  },
}))

/** the list fields of a full row */
function metaOf(row: CloudCardMeta): CloudCardMeta {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    editor: row.editor ?? '',
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    unit_id: row.unit_id,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// The server turned the remembered login down (expired, or the password was
// changed): show the login form again. The card being edited, and which
// online card it came from, stay, so it can still be saved after logging in.
onLoginExpired(() =>
  useAppStore.setState({
    account: null,
    authed: false,
    loginExpired: true,
    cloudCards: [],
    cloudNotice: null,
    specs: null,
  }),
)
