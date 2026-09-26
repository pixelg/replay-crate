import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SearchPaletteContext } from '../../lib/search-palette.ts'

/** Whether a key press belongs to something being typed in, where "/" is just a slash. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** The search palette's open state, and its keyboard shortcuts: ⌘K / Ctrl+K anywhere, "/" when not typing. */
export function SearchPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [initialQuery, setInitialQuery] = useState('')
  const show = useCallback((q = '') => {
    setInitialQuery(q)
    setOpen(true)
  }, [])
  const hide = useCallback(() => setOpen(false), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        setOpen((current) => {
          if (!current) setInitialQuery('')
          return !current
        })
      } else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)) {
        event.preventDefault()
        show()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [show])

  const value = useMemo(() => ({ open, show, hide, initialQuery }), [open, show, hide, initialQuery])
  return <SearchPaletteContext value={value}>{children}</SearchPaletteContext>
}
