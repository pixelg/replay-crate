import { ChartColumn, History, ListMusic, Radio, Settings, type LucideIcon } from 'lucide-react'

export type NavItem = {
  to: '/history' | '/player' | '/playlists' | '/stats' | '/settings'
  label: string
  icon: LucideIcon
  /** Also a bottom tab on phones. The player is reached there from its bar and the header. */
  tab: boolean
}

export const navItems: NavItem[] = [
  { to: '/history', label: 'History', icon: History, tab: true },
  { to: '/player', label: 'Player', icon: Radio, tab: false },
  { to: '/playlists', label: 'Playlists', icon: ListMusic, tab: true },
  { to: '/stats', label: 'Stats', icon: ChartColumn, tab: true },
  { to: '/settings', label: 'Settings', icon: Settings, tab: true },
]
