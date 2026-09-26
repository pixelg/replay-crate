import type { Playback, PlayerCommand, PlayerItem, RepeatMode } from '@replay-crate/api-client'
import { formatDuration } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { cn } from 'cn'
import { useId, useState } from 'react'
import { AlbumArt } from '../album-art.tsx'
import { Slider } from '../ui/slider.tsx'
import { TrackRating } from '../star-rating.tsx'
import { IconButton } from './icon-button.tsx'
import { imageOf, subtitleOf } from './items.ts'

/** The value of a one-thumb slider (Base UI passes a number or an array). */
const thumb = (value: number | readonly number[]) => (typeof value === 'number' ? value : (value[0] ?? 0))

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'context', context: 'track', track: 'off' }
const REPEAT_LABEL: Record<RepeatMode, string> = { off: 'Repeat: off', context: 'Repeat: all', track: 'Repeat: this track' }

/** The player page's main panel: big art, what's playing, seek, transport, shuffle, repeat, volume. */
export function NowPlayingPanel({
  playback,
  item,
  progressMs,
  send,
}: {
  playback: Playback
  item: PlayerItem
  progressMs: number
  send: (command: PlayerCommand) => void
}) {
  const disallowed = new Set(playback.disallows)
  // Named after the item: the header's mini player is the "Now playing" landmark.
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex flex-col items-center gap-6 md:flex-row md:items-end">
      <AlbumArt src={imageOf(item)} className="size-56 rounded-lg shadow-lg md:size-64" />
      <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
        <div className="min-w-0 text-center md:text-left">
          {playback.context && (
            <p className="truncate text-xs text-muted-foreground">
              Playing from {playback.context.name ?? (playback.context.type === 'collection' ? 'Liked Songs' : playback.context.type)}
            </p>
          )}
          <h2 id={titleId} className="truncate text-2xl font-semibold tracking-tight">
            {item.type === 'track' && item.id ? (
              <Link to="/tracks/$trackId" params={{ trackId: item.id }} className="hover:underline">
                {item.name}
              </Link>
            ) : (
              item.name
            )}
          </h2>
          <p className="truncate text-muted-foreground">{subtitleOf(item)}</p>
          {item.type === 'track' && item.id && (
            <TrackRating track={{ ...item, id: item.id }} size="md" className="mt-2" />
          )}
        </div>

        <SeekBar progressMs={progressMs} durationMs={item.durationMs} disabled={disallowed.has('seeking')} send={send} />

        <div className="flex items-center justify-center gap-2 md:justify-start">
          <IconButton
            label="Shuffle"
            aria-pressed={playback.shuffle}
            disabled={disallowed.has('toggling_shuffle')}
            onClick={() => send({ kind: 'shuffle', on: !playback.shuffle })}
            className={cn(playback.shuffle && 'text-primary')}
          >
            <Shuffle aria-hidden className="size-4" />
          </IconButton>
          <IconButton label="Previous" disabled={disallowed.has('skipping_prev')} onClick={() => send({ kind: 'previous' })}>
            <SkipBack aria-hidden className="size-5" />
          </IconButton>
          <IconButton
            label={playback.isPlaying ? 'Pause' : 'Play'}
            disabled={disallowed.has(playback.isPlaying ? 'pausing' : 'resuming')}
            onClick={() => send({ kind: playback.isPlaying ? 'pause' : 'play' })}
            className="size-12 bg-primary text-primary-foreground hover:enabled:bg-primary/90"
          >
            {playback.isPlaying ? <Pause aria-hidden className="size-5" /> : <Play aria-hidden className="size-5" />}
          </IconButton>
          <IconButton label="Next" disabled={disallowed.has('skipping_next')} onClick={() => send({ kind: 'next' })}>
            <SkipForward aria-hidden className="size-5" />
          </IconButton>
          <IconButton
            label={REPEAT_LABEL[playback.repeat]}
            // Spotify allows each repeat mode separately; check the one this press turns on.
            disabled={disallowed.has(NEXT_REPEAT[playback.repeat] === 'context' ? 'toggling_repeat_context' : 'toggling_repeat_track')}
            onClick={() => send({ kind: 'repeat', state: NEXT_REPEAT[playback.repeat] })}
            className={cn(playback.repeat !== 'off' && 'text-primary')}
          >
            {playback.repeat === 'track' ? <Repeat1 aria-hidden className="size-4" /> : <Repeat aria-hidden className="size-4" />}
          </IconButton>
        </div>

        <VolumeControl playback={playback} send={send} />
      </div>
    </section>
  )
}

/** Drag or step to a position; playback only jumps when the thumb is let go. */
function SeekBar({
  progressMs,
  durationMs,
  disabled,
  send,
}: {
  progressMs: number
  durationMs: number
  disabled: boolean
  send: (command: PlayerCommand) => void
}) {
  const [dragging, setDragging] = useState<number | null>(null)
  const position = dragging ?? progressMs
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
      <span className="w-10 text-right">{formatDuration(position)}</span>
      <Slider
        label="Seek"
        valueText={(ms) => `${formatDuration(ms)} of ${formatDuration(durationMs)}`}
        value={[Math.min(position, durationMs)]}
        max={durationMs}
        step={1_000}
        disabled={disabled}
        onValueChange={(value) => setDragging(thumb(value))}
        onValueCommitted={(value) => {
          setDragging(null)
          send({ kind: 'seek', positionMs: Math.round(thumb(value)) })
        }}
      />
      <span className="w-10">-{formatDuration(Math.max(0, durationMs - position))}</span>
    </div>
  )
}

function VolumeControl({ playback, send }: { playback: Playback; send: (command: PlayerCommand) => void }) {
  const { device } = playback
  const [dragging, setDragging] = useState<number | null>(null)
  const volume = dragging ?? device.volumePercent ?? 0
  if (!device.supportsVolume) {
    return (
      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground md:justify-start">
        <VolumeX aria-hidden className="size-4" /> {device.name} doesn't let apps change its volume.
      </p>
    )
  }
  return (
    <div className="flex items-center gap-3 md:max-w-64">
      <Volume2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <Slider
        label="Volume"
        valueText={(percent) => `${Math.round(percent)}%`}
        value={[volume]}
        max={100}
        step={1}
        onValueChange={(value) => setDragging(thumb(value))}
        onValueCommitted={(value) => {
          setDragging(null)
          send({ kind: 'volume', percent: Math.round(thumb(value)) })
        }}
      />
    </div>
  )
}
