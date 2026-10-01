import { ChartColumn, History, ListMusic, Music, Podcast, Radio, type LucideIcon } from 'lucide-react'
import type { Mode } from '../lib/mode.ts'

export type NavItem = {
  to: '/history' | '/tracks' | '/episodes' | '/player' | '/playlists' | '/stats'
  label: string
  icon: LucideIcon
  /** Also a bottom tab on phones. The player is reached there from its bar and the header. */
  tab: boolean
}

/**
 * The sidebar's sections: the player on its own, then the library, whose own list is Tracks in
 * music mode and Episodes in podcast mode. Settings lives in the account menu.
 */
export function navSectionsFor(mode: Mode): NavItem[][] {
  return [
    [{ to: '/player', label: 'Player', icon: Radio, tab: false }],
    [
      { to: '/history', label: 'History', icon: History, tab: true },
      mode === 'podcasts'
        ? { to: '/episodes', label: 'Episodes', icon: Podcast, tab: true }
        : { to: '/tracks', label: 'Tracks', icon: Music, tab: true },
      { to: '/playlists', label: 'Playlists', icon: ListMusic, tab: true },
      { to: '/stats', label: 'Stats', icon: ChartColumn, tab: true },
    ],
  ]
}
