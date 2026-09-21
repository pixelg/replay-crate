import { latestImportQueryOptions, uploadImport } from '@replay-crate/api-client'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ImportDropZone } from '@/components/import/import-drop-zone'
import { ImportStatus } from '@/components/import/import-status'
import { ImportSummary } from '@/components/import/import-summary'
import { InlineError } from '@/components/inline-error'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { describeError } from '@/lib/describe-error'
import { readStreamingHistory, StreamingHistoryError, type StreamingHistory } from '@/lib/read-streaming-history'

export const Route = createFileRoute('/_app/import')({
  loader: ({ context }) => context.queryClient.ensureQueryData(latestImportQueryOptions(api)),
  component: ImportPage,
})

const PRIVACY_PAGE = 'https://www.spotify.com/account/privacy/'

function ImportPage() {
  const queryClient = useQueryClient()
  const { data: latest } = useSuspenseQuery(latestImportQueryOptions(api))
  const [history, setHistory] = useState<StreamingHistory | null>(null)
  const [reading, setReading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState<number>()

  async function choose(files: File[]) {
    setReading(true)
    setProblem(null)
    upload.reset()
    try {
      setHistory(await readStreamingHistory(files))
    } catch (error) {
      setHistory(null)
      setProblem(
        error instanceof StreamingHistoryError ? error.message : `Couldn't read that: ${describeError(error).title}`,
      )
    } finally {
      setReading(false)
    }
  }

  const upload = useMutation({
    mutationFn: (plays: StreamingHistory['plays']) => {
      setSent(0)
      return uploadImport(api, plays, setSent)
    },
    onSuccess: () => {
      setHistory(null)
      // Plays of tracks we already knew are in; history, gaps and stats all changed.
      void queryClient.invalidateQueries()
    },
    onSettled: () => setSent(undefined),
  })

  return (
    <>
      <PageHeader
        title="Import history"
        description="Fill in plays from before Replay Crate, or from while it wasn't running, with your Spotify data."
      />
      <div className="flex flex-col gap-4">
        {latest && !history && <ImportStatus status={latest} />}

        {history ? (
          <>
            <ImportSummary
              history={history}
              sent={sent}
              onImport={() => upload.mutate(history.plays)}
              onChooseAgain={() => {
                setHistory(null)
                upload.reset()
              }}
            />
            {upload.error && <InlineError error={upload.error} action="Import" />}
          </>
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-4">
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
                <li>
                  On Spotify's{' '}
                  <a href={PRIVACY_PAGE} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                    Account privacy page
                  </a>
                  , request your <strong className="font-medium">Extended streaming history</strong>. Spotify emails a
                  download link when it's ready, which can take up to 30 days.
                </li>
                <li>Download my_spotify_data.zip and add it below. No need to unzip it.</li>
              </ol>
              <ImportDropZone onFiles={(files) => void choose(files)} disabled={reading} />
              {reading && (
                <p role="status" className="text-sm text-muted-foreground">
                  Reading your files…
                </p>
              )}
              {problem && (
                <p role="alert" className="text-sm text-destructive">
                  {problem}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Your files are read on this device. Only each play's time, length and track are sent to Replay Crate.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
