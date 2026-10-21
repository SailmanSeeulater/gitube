import { DEFAULT_THEME_ID, THEME_STORAGE_KEY, isThemeId, type ThemeId } from './themes'

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

/** window.localStorage, or null where it is missing or merely touching it throws (blocked site data). */
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * The saved theme id, or the default (Obsidian) when nothing valid is saved: a first visit, an id
 * from a removed theme, or storage that is unavailable (private mode, blocked, node).
 */
export function readStoredThemeId(storage: ReadableStorage | null = browserStorage()): ThemeId {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY)
    return isThemeId(value) ? value : DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

/** Saves the theme id; silently does nothing where storage is unavailable (the choice then lasts this session). */
export function writeStoredThemeId(id: ThemeId, storage: WritableStorage | null = browserStorage()): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, id)
  } catch {
    // storage full or blocked: the theme still applies for this session
  }
}
