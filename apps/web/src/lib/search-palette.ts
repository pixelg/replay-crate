import { createContext, useContext } from 'react'

export type SearchPalette = {
  open: boolean
  /** Opens the palette, optionally with a query already typed. */
  show: (q?: string) => void
  hide: () => void
  /** What to type when it opens. */
  initialQuery: string
}

export const SearchPaletteContext = createContext<SearchPalette | null>(null)

export function useSearchPalette(): SearchPalette {
  const palette = useContext(SearchPaletteContext)
  if (!palette) throw new Error('useSearchPalette needs a SearchPaletteProvider')
  return palette
}

/** "⌘" on Apple devices, "Ctrl" elsewhere. */
export const modKey = () => (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl')
