import { useRouterState } from '@tanstack/react-router'
import { Music, Podcast } from 'lucide-react'
import { useMode } from '../lib/mode.ts'
import { dismissModeOffer, useModeOffers } from '../lib/mode-offer.ts'
import { useSwitchMode } from '../lib/mode-routes.ts'
import { useNowPlaying } from '../lib/use-player.ts'
import { Button } from './ui/button.tsx'

/**
 * "A podcast is playing. Switch to Podcasts?" when what's playing is the other kind from the
 * mode on screen. Only an offer: the mode changes on Switch alone, and Not now puts it away
 * for that item. Never on the player page, which shows either kind, and never while paused.
 */
export function ModeOffer() {
  const mode = useMode()
  const switchMode = useSwitchMode()
  const nowPlaying = useNowPlaying()
  const offers = useModeOffers()
  const onPlayer = useRouterState({ select: (state) => state.location.pathname === '/player' })
  const item = nowPlaying?.isPlaying ? nowPlaying.item : null
  if (!item || onPlayer || !offers.enabled || offers.isDismissed(item.uri)) return null
  const other = item.type === 'episode' ? 'podcasts' : 'music'
  if (other === mode) return null

  const Icon = other === 'podcasts' ? Podcast : Music
  return (
    <div
      role="status"
      aria-label="Switch mode"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-4 py-2 text-sm md:px-8"
    >
      <Icon aria-hidden className="size-5 shrink-0 text-primary" />
      {/* At least this wide, so on a phone the buttons wrap under it rather than squeezing it. */}
      <p className="min-w-[14rem] flex-1">
        {other === 'podcasts' ? 'A podcast is playing.' : 'Music is playing.'}{' '}
        <span className="text-muted-foreground">Switch to {other === 'podcasts' ? 'Podcasts' : 'Music'} to see it here?</span>
      </p>
      <div className="ml-7 flex items-center gap-1 sm:ml-0">
        <Button size="sm" onClick={() => switchMode(other)}>
          Switch to {other === 'podcasts' ? 'Podcasts' : 'Music'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismissModeOffer(item.uri)}>
          Not now
        </Button>
      </div>
    </div>
  )
}
