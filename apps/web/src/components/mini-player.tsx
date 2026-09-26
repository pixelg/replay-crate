import { isApiError, type Playback, type PlayerCommand, type PlayerItem } from '@replay-crate/api-client'
import { formatDuration } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { MonitorSpeaker, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { cn } from 'cn'
import { describeError } from '../lib/describe-error.ts'
import { usePlayback, usePlayerControls, useQueue } from '../lib/use-player.ts'
import { AlbumArt } from './album-art.tsx'
import { IconButton } from './player/icon-button.tsx'
import { subtitleOf, thumbOf } from './player/items.ts'
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
      <NowPlaying item={item} message={player.message} />
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
      {upNext && (
        <div className="ml-2 hidden min-w-0 items-center gap-2 border-l border-border pl-4 lg:flex">
          <AlbumArt src={thumbOf(upNext)} className="size-8" />
          <div className="min-w-0 text-xs">
            <p className="text-muted-foreground">Up next</p>
            <p className="truncate">
              {upNext.name} <span className="text-muted-foreground">· {subtitleOf(upNext)}</span>
            </p>
          </div>
        </div>
      )}
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
}: {
  item: PlayerItem | null
  message: string | null
  /** Where the title leads: the track's page, or (on phones) the player page. */
  opens?: 'track' | 'player'
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
    <div className="flex min-w-0 flex-1 items-center gap-3">
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

