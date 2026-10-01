/** Listening time as people say it: "45 min", "1 h 5 min", "under a minute". */
export function formatListened(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${minutes} min`
}

const releaseFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** A release date as precise as Spotify knows it: a day, or just the year (or month). */
export function formatRelease(date: string | null): string | null {
  if (!date) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? releaseFormat.format(new Date(`${date}T00:00:00`)) : date.slice(0, 4)
}
