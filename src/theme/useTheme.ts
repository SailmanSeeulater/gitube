import { useAppStore } from '../store/useAppStore'
import { getTheme, type Theme } from './themes'

/** The active theme. getTheme returns one shared object per id, so this only re-renders on a switch. */
export function useTheme(): Theme {
  return getTheme(useAppStore((s) => s.themeId))
}
