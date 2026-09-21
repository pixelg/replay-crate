import { Disc3 } from 'lucide-react'
import { cn } from 'cn'

/** Square cover image with a neutral placeholder when Spotify has none. */
export function AlbumArt({ src, className }: { src: string | null; className?: string }) {
  return src ? (
    <img src={src} alt="" loading="lazy" className={cn('shrink-0 rounded-sm bg-muted object-cover', className)} />
  ) : (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-sm bg-muted', className)}>
      <Disc3 className="size-1/2 text-muted-foreground" />
    </span>
  )
}
