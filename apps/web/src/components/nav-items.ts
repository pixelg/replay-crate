import { ChartColumn, History, ListMusic, Settings, type LucideIcon } from 'lucide-react'

export type NavItem = {
  to: '/history' | '/playlists' | '/stats' | '/settings'
  label: string
  icon: LucideIcon
}

export const navItems: NavItem[] = [
  { to: '/history', label: 'History', icon: History },
  { to: '/playlists', label: 'Playlists', icon: ListMusic },
  { to: '/stats', label: 'Stats', icon: ChartColumn },
  { to: '/settings', label: 'Settings', icon: Settings },
]
