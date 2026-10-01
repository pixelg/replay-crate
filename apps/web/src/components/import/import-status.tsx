import type { ImportStatus as Status } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react'
import { buttonClasses } from '@/components/ui/button-classes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import { count, monthFormat } from './format.ts'

/** "1,200 plays and 40 podcast listens", leaving out either when there are none. */
const playsAndListens = (plays: number, listens: number) =>
  [plays > 0 || listens === 0 ? count(plays, 'play') : null, listens > 0 ? count(listens, 'podcast listen') : null].filter(Boolean).join(' and ')

/** How the most recent import is doing: still uploading, looking up tracks and episodes, or done. */
export function ImportStatus({ status }: { status: Status }) {
  const span =
    status.earliest && status.latest
      ? `${monthFormat.format(new Date(status.earliest))} to ${monthFormat.format(new Date(status.latest))}`
      : null

  if (!status.uploadedAt) {
    return (
      <Card size="sm" role="status" aria-label="Last import">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert aria-hidden className="size-4 text-primary" />
            The last import didn't finish uploading
          </CardTitle>
          <CardDescription>
            Started {formatRelative(new Date(status.createdAt))} with {playsAndListens(status.playCount, status.listenCount)} sent. Choose your Spotify data again to finish it;
            plays already added won't be doubled.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!status.done) {
    const all = status.playCount + status.listenCount
    const landed = all - status.waitingPlays - status.waitingListens
    const lookingUp = [
      status.tracksToFetch > 0 && count(status.tracksToFetch, 'track'),
      status.episodesToFetch > 0 && count(status.episodesToFetch, 'episode'),
    ].filter(Boolean)
    return (
      <Card size="sm" role="status" aria-label="Last import">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LoaderCircle aria-hidden className="size-4 text-primary motion-safe:animate-spin" />
            Looking up {lookingUp.length ? lookingUp.join(' and ') : 'the rest'} on Spotify
          </CardTitle>
          <CardDescription>
            Spotify only answers one at a time, so a big import takes a while. Plays and listens show up in your history
            as their tracks and episodes arrive. It carries on whenever Replay Crate is running, even if you leave this
            page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={all ? Math.floor((landed / all) * 100) : 0}>
            <ProgressLabel>
              {landed.toLocaleString()} of {status.listenCount ? all.toLocaleString() : count(status.playCount, 'play')}
              {span && <span className="font-normal text-muted-foreground"> ({span})</span>}
            </ProgressLabel>
            <ProgressValue />
          </Progress>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card size="sm" role="status" aria-label="Last import">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleCheck aria-hidden className="size-4 text-primary" />
          Imported {playsAndListens(status.playCount, status.listenCount)}
          {span && ` from ${span}`}
        </CardTitle>
        <CardDescription>
          Uploaded {formatRelative(new Date(status.uploadedAt))}.
          {status.unavailable > 0 &&
            ` ${count(status.unavailable, 'play')} of tracks Spotify no longer has ${status.unavailable === 1 ? 'was' : 'were'} left out.`}
          {status.listensUnavailable > 0 &&
            ` ${count(status.listensUnavailable, 'listen')} of episodes Spotify no longer has ${status.listensUnavailable === 1 ? 'was' : 'were'} left out.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Link to="/history" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
          See history
        </Link>
        <Link to="/stats" search={{ range: 'all' }} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
          All-time stats
        </Link>
      </CardContent>
    </Card>
  )
}
