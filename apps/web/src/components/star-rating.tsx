import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Star } from 'lucide-react'
import { cn } from 'cn'
import { useState } from 'react'
import { useRateEpisode, useRateTrack } from '../lib/use-rate-track.ts'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx'

const STARS = [1, 2, 3, 4, 5] as const

/**
 * Five stars as a radio group: arrow keys move between them, clicking or Space picks one.
 * Clicking the current star again, or pressing Delete or Backspace, clears the rating.
 */
export function StarRating({
  label,
  rating,
  onChange,
  size = 'sm',
  disabled,
  className,
}: {
  /** The group's accessible name, e.g. "Rating for Brass Monkey Business". */
  label: string
  rating: number | null
  onChange: (rating: number | null) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}) {
  // Hovering shows what a click would set.
  const [hovered, setHovered] = useState<number | null>(null)
  const shown = hovered ?? rating ?? 0
  return (
    <RadioGroup
      aria-label={label}
      value={rating}
      onValueChange={(value) => onChange(value as number)}
      disabled={disabled}
      onKeyDown={(event) => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && rating !== null) {
          event.preventDefault()
          onChange(null)
        }
      }}
      onPointerLeave={() => setHovered(null)}
      className={cn('inline-flex items-center', size === 'sm' ? 'gap-0.5' : 'gap-1', className)}
    >
      {STARS.map((value) => (
        <Radio.Root
          key={value}
          value={value}
          aria-label={value === 1 ? '1 star' : `${value} stars`}
          onPointerEnter={() => setHovered(value)}
          onClick={() => {
            if (value === rating) onChange(null)
          }}
          className="rounded-sm text-muted-foreground outline-none hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring data-disabled:opacity-50"
        >
          <Star
            aria-hidden
            className={cn(size === 'sm' ? 'size-4' : 'size-5', value <= shown && 'fill-primary text-primary')}
          />
        </Radio.Root>
      ))}
    </RadioGroup>
  )
}

type RatedTrack = { id: string; name: string; rating: number | null }
type Rate = ReturnType<typeof useRateTrack>

/**
 * The signed-in user's rating of a track, saved as it changes. With `compactOnPhones` (inside a
 * `TrackRow`, which is a container), rows too narrow for five stars show `CompactTrackRating`, and
 * rows of `@2xl` and up the stars.
 */
export function TrackRating({
  track,
  size,
  compactOnPhones,
  className,
}: {
  track: RatedTrack
  size?: 'sm' | 'md'
  compactOnPhones?: boolean
  className?: string
}) {
  return <ItemRating item={track} rate={useRateTrack()} size={size} compactOnPhones={compactOnPhones} className={className} />
}

/** The signed-in user's rating of an episode, like `TrackRating`. */
export function EpisodeRating(props: {
  episode: RatedTrack
  size?: 'sm' | 'md'
  compactOnPhones?: boolean
  className?: string
}) {
  const { episode, ...rest } = props
  return <ItemRating item={episode} rate={useRateEpisode()} {...rest} />
}

function ItemRating({
  item: track,
  rate,
  size,
  compactOnPhones,
  className,
}: {
  item: RatedTrack
  rate: Rate
  size?: 'sm' | 'md'
  compactOnPhones?: boolean
  className?: string
}) {
  const stars = (
    <StarRating
      label={`Rating for ${track.name}`}
      rating={track.rating}
      onChange={(rating) => rate.mutate({ trackId: track.id, rating })}
      size={size}
      className={cn(compactOnPhones && 'hidden @2xl:inline-flex', className)}
    />
  )
  if (!compactOnPhones) return stars
  return (
    <>
      <CompactRating track={track} rate={rate} className={cn('@2xl:hidden', className)} />
      {stars}
    </>
  )
}

/**
 * A track's rating as a number and a star (`4 ★`, or `– ☆` unrated). Tapping it opens the five
 * stars in a popover; picking one saves it and closes the popover, as do Esc, Enter and a tap
 * outside. Arrow keys move the rating without closing, like the inline stars.
 */
export function CompactTrackRating({ track, className }: { track: RatedTrack; className?: string }) {
  return <CompactRating track={track} rate={useRateTrack()} className={className} />
}

function CompactRating({ track, rate, className }: { track: RatedTrack; rate: Rate; className?: string }) {
  const [open, setOpen] = useState(false)
  const { rating } = track
  const label = `Rating for ${track.name}`
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${label}: ${rating === null ? 'not rated' : rating === 1 ? '1 star' : `${rating} stars`}`}
        // 24px tall to sit in a row's corner; the ::after stretches the tap target to 36px.
        className={cn(
          'relative inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm tabular-nums after:absolute after:-inset-y-1.5 after:inset-x-0 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring data-popup-open:bg-accent',
          rating === null ? 'text-muted-foreground' : 'font-medium',
          className,
        )}
      >
        {rating ?? '–'}
        <Star aria-hidden className={cn('size-4', rating === null ? 'text-muted-foreground' : 'fill-primary text-primary')} />
      </PopoverTrigger>
      <PopoverContent
        aria-label={`Rate ${track.name}`}
        align="end"
        className="w-auto p-3"
        // A click on a star (a tap, or Space) is a pick; arrow keys change the rating without one.
        onClick={(event) => {
          if ((event.target as Element).closest('[role=radio]')) setOpen(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') setOpen(false)
        }}
      >
        <StarRating
          label={label}
          rating={rating}
          onChange={(next) => rate.mutate({ trackId: track.id, rating: next })}
          size="md"
        />
      </PopoverContent>
    </Popover>
  )
}
