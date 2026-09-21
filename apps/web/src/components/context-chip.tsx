import type { PlayContext } from '@replay-crate/api-client'
import { Disc3, Heart, ListMusic, MicVocal, Radio, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'

const kinds: Record<string, { icon: LucideIcon; fallback: string }> = {
  playlist: { icon: ListMusic, fallback: 'Spotify playlist' },
  album: { icon: Disc3, fallback: 'Album' },
  artist: { icon: MicVocal, fallback: 'Artist' },
  collection: { icon: Heart, fallback: 'Liked Songs' },
}

/** Where a play came from: a playlist, album, artist page, Liked Songs... */
export function ContextChip({ context, className }: { context: PlayContext; className?: string }) {
  const kind = kinds[context.type] ?? { icon: Radio, fallback: context.type }
  const Icon = kind.icon
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground',
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{context.name ?? kind.fallback}</span>
    </span>
  )
}
