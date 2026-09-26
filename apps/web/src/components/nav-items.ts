import { ChartColumn, History, ListMusic, Music, Radio, type LucideIcon } from 'lucide-react'

export type NavItem = {
  to: '/history' | '/tracks' | '/player' | '/playlists' | '/stats'
  label: string
  icon: LucideIcon
  /** Also a bottom tab on phones. The player is reached there from its bar and the header. */
  tab: boolean
}

/**
 * The sidebar's sections: the player on its own, then the library. Settings lives in the
 * account menu.
 */
export const navSections: NavItem[][] = [
  [{ to: '/player', label: 'Player', icon: Radio, tab: false }],
  [
    { to: '/history', label: 'History', icon: History, tab: true },
    { to: '/tracks', label: 'Tracks', icon: Music, tab: true },
    { to: '/playlists', label: 'Playlists', icon: ListMusic, tab: true },
    { to: '/stats', label: 'Stats', icon: ChartColumn, tab: true },
  ],
]

export const navItems: NavItem[] = navSections.flat()
