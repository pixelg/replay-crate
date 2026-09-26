import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Star } from 'lucide-react'
import { cn } from 'cn'
import { useState } from 'react'
import { useRateTrack } from '../lib/use-rate-track.ts'

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

/** The signed-in user's rating of a track, saved as it changes. */
export function TrackRating({
  track,
  size,
  className,
}: {
  track: { id: string; name: string; rating: number | null }
  size?: 'sm' | 'md'
  className?: string
}) {
  const rate = useRateTrack()
  return (
    <StarRating
      label={`Rating for ${track.name}`}
      rating={track.rating}
      onChange={(rating) => rate.mutate({ trackId: track.id, rating })}
      size={size}
      className={className}
    />
  )
}
