import { summarizeImport } from '@replay-crate/core'
import { Upload } from 'lucide-react'
import { useMemo } from 'react'
import type { StreamingHistory } from '@/lib/read-streaming-history'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import { count, monthFormat } from './format.ts'

/**
 * What was found in the chosen files, before anything is sent. While uploading, `sent`
 * is the number of plays and listens uploaded so far.
 */
export function ImportSummary({
  history,
  sent,
  onImport,
  onChooseAgain,
}: {
  history: StreamingHistory
  sent?: number
  onImport: () => void
  onChooseAgain: () => void
}) {
  const summary = useMemo(() => summarizeImport(history.plays), [history])
  const uploading = sent !== undefined
  const listens = history.listens.length
  const episodes = useMemo(() => new Set(history.listens.map((listen) => listen.episodeId)).size, [history])
  const total = summary.plays + listens
  const found = [
    summary.plays > 0 && `${count(summary.plays, 'play')} of ${count(summary.tracks, 'track')}`,
    listens > 0 && `${count(listens, 'podcast listen')} of ${count(episodes, 'episode')}`,
  ].filter(Boolean)
  const skipped = [
    history.tooShort && `${count(history.tooShort, 'play')} under 30 seconds, which Spotify doesn't count either`,
    history.tooShortListens && `${count(history.tooShortListens, 'podcast listen')} under 30 seconds`,
    history.other && `${count(history.other, 'audiobook or video', 'audiobooks and videos')}`,
    history.repeated && `${count(history.repeated, 'play')} repeated across files`,
    history.malformed && `${count(history.malformed, 'entry', 'entries')} that couldn't be read`,
  ].filter(Boolean)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{found.length ? found.join(', and ') : 'No plays to import'}</CardTitle>
        <CardDescription>
          {summary.earliest && summary.latest
            ? `${monthFormat.format(new Date(summary.earliest))} to ${monthFormat.format(new Date(summary.latest))}, from ${count(history.files, 'file')}`
            : total
              ? `From ${count(history.files, 'file')}`
              : `Nothing in ${history.files === 1 ? 'that file' : 'those files'} is music or a podcast played for 30 seconds or more.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {skipped.length > 0 && (
          <div>
            <p className="font-medium">Left out</p>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {skipped.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {total > 0 && (
          <p className="text-muted-foreground">
            Plays and listens Replay Crate already has are skipped, so importing the same data again is safe. Only each
            play's time, length and track (or episode) are sent; nothing else in the export leaves this device.
          </p>
        )}
        {uploading && (
          <Progress value={Math.round((sent / total) * 100)}>
            <ProgressLabel>
              Uploading {sent.toLocaleString()} of {total.toLocaleString()}
            </ProgressLabel>
            <ProgressValue />
          </Progress>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {total > 0 && (
          <Button onClick={onImport} disabled={uploading}>
            <Upload aria-hidden className="size-4" />
            {uploading
              ? 'Importing…'
              : `Import ${[summary.plays > 0 && count(summary.plays, 'play'), listens > 0 && count(listens, 'listen')].filter(Boolean).join(' and ')}`}
          </Button>
        )}
        <Button variant="ghost" onClick={onChooseAgain} disabled={uploading}>
          Choose other files
        </Button>
      </CardFooter>
    </Card>
  )
}
