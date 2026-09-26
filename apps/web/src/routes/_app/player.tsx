import { playbackQueryOptions } from '@replay-crate/api-client'
import { createFileRoute } from '@tanstack/react-router'
import { MonitorSpeaker, RefreshCw } from 'lucide-react'
import { ErrorPage } from '@/components/error-page'
import { InlineError } from '@/components/inline-error'
import { PageHeader } from '@/components/page-header'
import { DeviceList } from '@/components/player/device-list'
import { IconButton } from '@/components/player/icon-button'
import { NowPlayingPanel } from '@/components/player/now-playing-panel'
import { isPlayable } from '@/components/player/items'
import { QueueList } from '@/components/player/queue-list'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useDevices, usePlayback, usePlayerControls, useQueue } from '@/lib/use-player'

export const Route = createFileRoute('/_app/player')({
  // Prefetch without blocking: Premium and permission problems belong on the page, not an error route.
  loader: ({ context }) => void context.queryClient.prefetchQuery(playbackQueryOptions(api)),
  component: PlayerPage,
})

function PlayerPage() {
  const { playback, progressMs, error, isPending } = usePlayback()
  const controls = usePlayerControls()
  const item = playback?.item ?? null
  const queue = useQueue(item?.uri ?? null)
  const devices = useDevices({ enabled: !error })

  return (
    <>
      <PageHeader title="Player" description="What Spotify is playing, what's next, and where." />
      {error ? (
        <ErrorPage error={error} />
      ) : (
        <div className="flex flex-col gap-8">
          {playback && item ? (
            <NowPlayingPanel playback={playback} item={item} progressMs={progressMs} send={controls.send} />
          ) : (
            !isPending && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-sm">
                <MonitorSpeaker aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <p>
                  {playback
                    ? `Nothing is playing on ${playback.device.name}. Start something in Spotify.`
                    : 'Nothing is playing. Open Spotify somewhere, or pick a device below to pick up where you left off.'}
                </p>
              </div>
            )
          )}
          {controls.error && <InlineError error={controls.error} action="Player" />}

          <div className="grid gap-6 md:grid-cols-2">
            {item && (
              <Card>
                <CardHeader>
                  <CardTitle>Up next</CardTitle>
                </CardHeader>
                <CardContent>
                  {queue.data ? (
                    <QueueList
                      items={queue.data.queue}
                      disabled={controls.isSending}
                      // Spotify can't jump ahead in its queue, so play that item and what follows it here.
                      onPlayNow={(from) =>
                        controls.send({ kind: 'play', uris: from.filter(isPlayable).slice(0, 100).map((next) => next.uri) })
                      }
                    />
                  ) : queue.error ? (
                    <InlineError error={queue.error} action="Loading the queue" />
                  ) : null}
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Devices</CardTitle>
                <CardAction>
                  <IconButton label="Refresh devices" onClick={() => void devices.refetch()} disabled={devices.isFetching}>
                    <RefreshCw aria-hidden className={devices.isFetching ? 'size-4 motion-safe:animate-spin' : 'size-4'} />
                  </IconButton>
                </CardAction>
              </CardHeader>
              <CardContent>
                {devices.data ? (
                  <DeviceList
                    devices={devices.data}
                    // Keep playing (or start, when nothing was) on the new device.
                    onPlayHere={(deviceId) => controls.send({ kind: 'transfer', deviceId, play: playback?.isPlaying ?? true })}
                  />
                ) : devices.error ? (
                  <InlineError error={devices.error} action="Loading devices" />
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
