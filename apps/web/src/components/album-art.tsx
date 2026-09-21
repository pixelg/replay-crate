import { Disc3 } from 'lucide-react'
import { cx } from '../lib/cx.ts'

/** Square cover image with a neutral placeholder when Spotify has none. */
export function AlbumArt({ src, className }: { src: string | null; className?: string }) {
  return src ? (
    <img src={src} alt="" loading="lazy" className={cx('shrink-0 rounded-sm bg-surface-sunken object-cover', className)} />
  ) : (
    <span aria-hidden className={cx('flex shrink-0 items-center justify-center rounded-sm bg-surface-sunken', className)}>
      <Disc3 className="size-1/2 text-fg-muted" />
    </span>
  )
}
