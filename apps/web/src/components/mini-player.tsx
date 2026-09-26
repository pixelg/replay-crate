import { isApiError, type Playback, type PlayerCommand, type PlayerItem } from '@replay-crate/api-client'
import { formatDuration } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { MonitorSpeaker, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'cn'
import { describeError } from '../lib/describe-error.ts'
import { usePlayback, usePlayerControls, useQueue } from '../lib/use-player.ts'
import { AlbumArt } from './album-art.tsx'
import { IconButton } from './player/icon-button.tsx'
import { imageOf, subtitleOf, thumbOf } from './player/items.ts'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card.tsx'
import { TrackRating } from './star-rating.tsx'

// What Spotify is playing, with transport controls: in the header from `md` up, and as a bar
// above the bottom tabs on phones. Both read the same polled playback (lib/use-player.ts).

/** The header's mini player: art, title, controls and times, and up next from `lg`. */
export function MiniPlayer({ className }: { className?: string }) {
  const player = useMiniPlayer()
  const upNext = useQueue(player.item?.uri ?? null).data?.queue[0]

  if (player.state !== 'ready') {
    return <PlayerNotice state={player.state} deviceName={player.deviceName} className={className} />
  }
  const { playback, progressMs, item } = player
  return (
    <section aria-label="Now playing" className={cn('flex min-w-0 items-center gap-3', className)}>
      {/* Keeps a little room when a long up-next title takes its share. */}
      <NowPlaying item={item} message={player.message} className="min-w-48" />
      {item?.type === 'track' && item.id && (
        <TrackRating track={{ ...item, id: item.id }} className="hidden shrink-0 lg:inline-flex" />
      )}
      <Transport playback={playback} send={player.send} />
      {item && (
        <p className="hidden shrink-0 text-xs text-muted-foreground tabular-nums lg:block">
          {formatDuration(progressMs)}
          <span aria-hidden> / </span>
          <span className="sr-only">, remaining </span>-{formatDuration(Math.max(0, item.durationMs - progressMs))}
        </p>
      )}
      {upNext && <UpNext item={upNext} />}
      <ProgressLine progressMs={progressMs} durationMs={item?.durationMs ?? 0} className="absolute inset-x-0 bottom-0" />
    </section>
  )
}

/** The phone bar: art, title and play/pause, with the position along its top edge. */
export function MiniPlayerBar() {
  const player = useMiniPlayer()
  // Nothing to control: leave the space to the page.
  if (player.state !== 'ready' || !player.item) return null
  const { playback, progressMs, item } = player
  return (
    <section
      aria-label="Now playing"
      data-mini-player-bar=""
      className="relative flex h-14 items-center gap-3 border-t border-border bg-card px-4"
    >
      <ProgressLine progressMs={progressMs} durationMs={item.durationMs} className="absolute inset-x-0 top-0" />
      {/* The title's link covers the bar; play/pause sits above it. */}
      <NowPlaying item={item} message={player.message} opens="player" />
      <PlayPause playback={playback} send={player.send} className="relative z-10" />
    </section>
  )
}

type MiniPlayerState =
  | { state: 'ready'; playback: Playback; item: PlayerItem | null; progressMs: number; message: string | null; send: (command: PlayerCommand) => void; deviceName: string }
  | { state: 'idle' | 'no_device' | 'premium' | 'permissions' | 'hidden'; item?: undefined; deviceName: string | null }

function useMiniPlayer(): MiniPlayerState {
  const { playback, progressMs, error } = usePlayback()
  const controls = usePlayerControls()
  if (error) {
    if (isApiError(error) && error.code === 'premium_required') return { state: 'premium', deviceName: null }
    if (isApiError(error) && error.code === 'missing_scopes') return { state: 'permissions', deviceName: null }
    // Offline, rate limited...: the next poll may do better; no need to shout here.
    return { state: 'hidden', deviceName: null }
  }
  if (!playback) return { state: 'no_device', deviceName: null }
  if (!playback.item) return { state: 'idle', deviceName: playback.device.name }
  return {
    state: 'ready',
    playback,
    item: playback.item,
    progressMs,
    // A refused command says why in place of the artist, until the next command.
    message: controls.error ? describeError(controls.error).title : null,
    send: (command) => {
      controls.reset()
      controls.send(command)
    },
    deviceName: playback.device.name,
  }
}

function PlayerNotice({
  state,
  deviceName,
  className,
}: {
  state: Exclude<MiniPlayerState['state'], 'ready'>
  deviceName: string | null
  className?: string
}) {
  const text = {
    idle: `Nothing playing${deviceName ? ` on ${deviceName}` : ''}`,
    no_device: 'Nothing playing. Open Spotify on a device to see it here.',
    premium: 'Playback controls need Spotify Premium.',
    permissions: "Reconnect Spotify to see what's playing.",
    hidden: null,
  }[state]
  if (!text) return null
  return (
    <p className={cn('flex min-w-0 items-center gap-2 text-sm text-muted-foreground', className)}>
      <MonitorSpeaker aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{text}</span>
    </p>
  )
}

function NowPlaying({
  item,
  message,
  opens = 'track',
  className,
}: {
  item: PlayerItem | null
  message: string | null
  /** Where the title leads: the track's page, or (on phones) the player page. */
  opens?: 'track' | 'player'
  className?: string
}) {
  if (!item) return null
  const title =
    opens === 'player' ? (
      <Link to="/player" className="truncate font-medium after:absolute after:inset-0">
        {item.name}
      </Link>
    ) : item.type === 'track' && item.id ? (
      <Link to="/tracks/$trackId" params={{ trackId: item.id }} className="truncate font-medium hover:underline">
        {item.name}
      </Link>
    ) : (
      <span className="truncate font-medium">{item.name}</span>
    )
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-3', className)}>
      <AlbumArt src={thumbOf(item)} className="size-10" />
      <div className="flex min-w-0 flex-col text-sm leading-tight">
        {title}
        {message ? (
          <span role="status" className="truncate text-xs text-destructive">
            {message}
          </span>
        ) : (
          <span className="truncate text-xs text-muted-foreground">{subtitleOf(item)}</span>
        )}
      </div>
    </div>
  )
}

/**
 * What plays after this, from `lg` up. It takes the room its title needs, up to half the header
 * (over half on wide screens), and wraps to two lines past that; the whole of it shows in a hover
 * card (tap on touch).
 */
function UpNext({ item }: { item: PlayerItem }) {
  const [open, setOpen] = useState(false)
  const title = item.name
  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        // A button, not the default link: a tap opens the card (touch has no hover), and the
        // card links to the track.
        render={<button type="button" />}
        onClick={() => setOpen(true)}
        delay={300}
        className="ml-2 hidden min-w-0 shrink items-center gap-2 border-l border-border py-1 pl-4 text-left lg:flex lg:max-w-1/2 xl:max-w-3/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <AlbumArt src={thumbOf(item)} className="size-8" />
        <span className="min-w-0 text-xs leading-tight">
          <span className="block text-muted-foreground">Up next</span>
          <span className="line-clamp-2 break-words">
            {title} <span className="text-muted-foreground">· {subtitleOf(item)}</span>
          </span>
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="flex w-72 gap-3">
        <AlbumArt src={imageOf(item)} className="size-16" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Up next</p>
          {item.type === 'track' && item.id ? (
            <Link to="/tracks/$trackId" params={{ trackId: item.id }} className="font-medium hover:underline">
              {title}
            </Link>
          ) : (
            <p className="font-medium">{title}</p>
          )}
          <p className="text-muted-foreground">{subtitleOf(item)}</p>
          <p className="text-xs text-muted-foreground">
            {item.type === 'track' ? item.album.name : 'Episode'} · {formatDuration(item.durationMs)}
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

function Transport({ playback, send }: { playback: Playback; send: (command: PlayerCommand) => void }) {
  const disallowed = new Set(playback.disallows)
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton label="Previous" disabled={disallowed.has('skipping_prev')} onClick={() => send({ kind: 'previous' })}>
        <SkipBack aria-hidden className="size-4" />
      </IconButton>
      <PlayPause playback={playback} send={send} />
      <IconButton label="Next" disabled={disallowed.has('skipping_next')} onClick={() => send({ kind: 'next' })}>
        <SkipForward aria-hidden className="size-4" />
      </IconButton>
    </div>
  )
}

function PlayPause({
  playback,
  send,
  className,
}: {
  playback: Playback
  send: (command: PlayerCommand) => void
  className?: string
}) {
  const playing = playback.isPlaying
  const disallowed = playback.disallows.includes(playing ? 'pausing' : 'resuming')
  return (
    <IconButton
      label={playing ? 'Pause' : 'Play'}
      disabled={disallowed || !playback.item}
      onClick={() => send({ kind: playing ? 'pause' : 'play' })}
      className={cn('bg-primary text-primary-foreground hover:enabled:bg-primary/90', className)}
    >
      {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
    </IconButton>
  )
}

/** A thin bar showing how far into the item playback is. */
function ProgressLine({ progressMs, durationMs, className }: { progressMs: number; durationMs: number; className?: string }) {
  const percent = durationMs ? Math.min(100, (progressMs / durationMs) * 100) : 0
  return (
    <div
      role="progressbar"
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(progressMs / 1000)}
      aria-valuetext={`${formatDuration(progressMs)} of ${formatDuration(durationMs)}`}
      className={cn('h-0.5 bg-border', className)}
    >
      <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  )
}

