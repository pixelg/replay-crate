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
 * is the number of plays uploaded so far.
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
  const skipped = [
    history.tooShort && `${count(history.tooShort, 'play')} under 30 seconds, which Spotify doesn't count either`,
    history.notMusic && `${count(history.notMusic, 'podcast, audiobook or video', 'podcasts, audiobooks and videos')}`,
    history.repeated && `${count(history.repeated, 'play')} repeated across files`,
    history.malformed && `${count(history.malformed, 'entry', 'entries')} that couldn't be read`,
  ].filter(Boolean)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{summary.plays ? `${count(summary.plays, 'play')} of ${count(summary.tracks, 'track')}` : 'No plays to import'}</CardTitle>
        <CardDescription>
          {summary.earliest && summary.latest
            ? `${monthFormat.format(new Date(summary.earliest))} to ${monthFormat.format(new Date(summary.latest))}, from ${count(history.files, 'file')}`
            : `Nothing in ${history.files === 1 ? 'that file' : 'those files'} is music played for 30 seconds or more.`}
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
        {summary.plays > 0 && (
          <p className="text-muted-foreground">
            Plays Replay Crate already has are skipped, so importing the same data again is safe. Only each play's time,
            length and track are sent; nothing else in the export leaves this device.
          </p>
        )}
        {uploading && (
          <Progress value={Math.round((sent / summary.plays) * 100)}>
            <ProgressLabel>Uploading {count(sent, 'play')}</ProgressLabel>
            <ProgressValue />
          </Progress>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {summary.plays > 0 && (
          <Button onClick={onImport} disabled={uploading}>
            <Upload aria-hidden className="size-4" />
            {uploading ? 'Importing…' : `Import ${count(summary.plays, 'play')}`}
          </Button>
        )}
        <Button variant="ghost" onClick={onChooseAgain} disabled={uploading}>
          Choose other files
        </Button>
      </CardFooter>
    </Card>
  )
}
