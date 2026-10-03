import { playbackQueryOptions, upNext } from '@replay-crate/api-client'
import { createFileRoute } from '@tanstack/react-router'
import { MonitorSpeaker, RefreshCw } from 'lucide-react'
import { ErrorPage } from '@/components/error-page'
import { InlineError } from '@/components/inline-error'
import { PageHeader } from '@/components/page-header'
import { DeviceList } from '@/components/player/device-list'
import { IconButton } from '@/components/player/icon-button'
import { NowPlayingPanel } from '@/components/player/now-playing-panel'
import { QueueList } from '@/components/player/queue-list'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useDevices, useForgetDevice, usePlayback, usePlayerControls, useQueue } from '@/lib/use-player'

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
  const forget = useForgetDevice()
  // A device that won't take playback says so on its own row, not for the whole page.
  const refusal =
    controls.error && controls.command?.kind === 'transfer' ? { deviceId: controls.command.deviceId, error: controls.error } : null

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
          {controls.error && !refusal && <InlineError error={controls.error} action="Player" />}

          <div className="grid gap-6 md:grid-cols-2">
            {item && (
              <Card>
                <CardHeader>
                  <CardTitle>Up next</CardTitle>
                  {/* Spotify doesn't say when Up next changes (a playlist reordered in Spotify, say). */}
                  <CardAction>
                    <IconButton label="Refresh Up next" onClick={() => void queue.refetch()} disabled={queue.isFetching}>
                      <RefreshCw aria-hidden className={queue.isFetching ? 'size-4 motion-safe:animate-spin' : 'size-4'} />
                    </IconButton>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {queue.data ? (
                    <QueueList
                      items={upNext(queue.data.queue, playback ?? null)}
                      disabled={controls.isSending}
                      // The API gets there from the context or by skipping: a bare URI won't start on an iPhone.
                      onPlayNow={(next, index) => controls.send({ kind: 'playQueued', uri: next.uri, index })}
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
                  <>
                    <DeviceList
                      devices={devices.data}
                      // Keep playing (or start, when nothing was) on the new device.
                      onPlayHere={(deviceId) => controls.send({ kind: 'transfer', deviceId, play: playback?.isPlaying ?? true })}
                      onForget={(device) => forget.mutate(device)}
                      refusal={refusal}
                    />
                    {forget.error && <InlineError error={forget.error} action="Removing the device" />}
                  </>
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
