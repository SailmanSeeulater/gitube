import { useGardenStore } from '../store/useGardenStore'
import { getTheme, type Theme } from './themes'

/** The active theme. getTheme returns one shared object per id, so this only re-renders on a switch. */
export function useTheme(): Theme {
  return getTheme(useGardenStore((s) => s.themeId))
}
