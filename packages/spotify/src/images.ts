import type { SpotifyImage } from './types.ts'

/**
 * Picks the image closest to `targetWidth` (preferring larger), e.g. ~64px for list
 * thumbnails and ~300px for detail views. Spotify usually offers 64, 300 and 640.
 */
export function pickImage(images: SpotifyImage[] | null | undefined, targetWidth: number): string | null {
  if (!images?.length) return null
  const sized = images.filter((image) => image.width != null)
  if (!sized.length) return images[0]!.url

  const atLeast = sized.filter((image) => image.width! >= targetWidth).sort((a, b) => a.width! - b.width!)
  return (atLeast[0] ?? sized.sort((a, b) => b.width! - a.width!)[0]!).url
}
