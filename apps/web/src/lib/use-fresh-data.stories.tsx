import preview from '#storybook/preview'
import { playsPageQueryOptions, type SyncTiming } from '@replay-crate/api-client'
import { focusManager, useQuery, useQueryClient } from '@tanstack/react-query'
import { expect, fn, waitFor } from 'storybook/test'
import { devices, playback, playsPage, queue } from '../test/fixtures.ts'
import { handlers, http } from '../test/handlers.ts'
import { api } from './api.ts'
import { useFreshData } from './use-fresh-data.ts'
import { useDevices, usePlayback } from './use-player.ts'

// The app's timing, shrunk so the stories don't wait 15 s or 2 min.
const timing: SyncTiming = { afterTrackChangeMs: 400, staleAfterMs: 1_500 }

/** The app's automatic refreshes, with history, the player and the device list on screen. */
function FreshDataProbe() {
  useFreshData(true, timing)
  const queryClient = useQueryClient()
  const { playback: current } = usePlayback()
  useQuery(playsPageQueryOptions(api, { page: 1, size: 10 }))
  useDevices()
  return (
    <div className="space-y-2 p-4">
      <p>{current?.item?.name ?? 'Nothing'}</p>
      <p>On {current?.device.name ?? 'no device'}</p>
      {/* Stands in for the next poll. */}
      <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: ['player'], exact: true })}>
        Check playback
      </button>
    </div>
  )
}

const syncs = fn()
const playsRequests = fn()
const devicesRequests = fn()
// What Spotify reports: the fixture's track on the laptop, until a story moves on.
let spotify = { item: playback.item, device: playback.device }

const meta = preview.meta({
  title: 'Hooks/useFreshData',
  component: FreshDataProbe,
  beforeEach({ msw }) {
    for (const mock of [syncs, playsRequests, devicesRequests]) mock.mockClear()
    spotify = { item: playback.item, device: playback.device }
    msw.use(
      http.get('/api/v1/player', ({ response }) => response(200).json({ playback: { ...playback, ...spotify } })),
      http.get('/api/v1/player/devices', ({ response }) => {
        devicesRequests()
        return response(200).json({ devices })
      }),
      http.post('/api/v1/history/sync', ({ response }) => {
        syncs()
        return response(200).json({ status: 'synced', inserted: 1, lastSyncedAt: new Date().toISOString(), missedPlays: false })
      }),
      http.get('/api/v1/history/plays', ({ response }) => {
        playsRequests()
        return response(200).json(playsPage)
      }),
      ...handlers.player,
    )
    // Tell TanStack Query the tab's visibility again after a story fakes it.
    return () => focusManager.setFocused(undefined)
  },
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 200))

export const SyncsAfterTheTrackChanges = meta.story({
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText('Brass Monkey Business')).toBeVisible()
    // The sync on opening the app runs once per page load, so it may already be done.
    await settle()
    const before = syncs.mock.calls.length
    const playsBefore = playsRequests.mock.calls.length

    // The same item again isn't a change.
    await userEvent.click(canvas.getByRole('button', { name: 'Check playback' }))
    await new Promise((resolve) => setTimeout(resolve, timing.afterTrackChangeMs + 200))
    await expect(syncs).toHaveBeenCalledTimes(before)

    spotify = { ...spotify, item: queue.queue[0]! }
    await userEvent.click(canvas.getByRole('button', { name: 'Check playback' }))
    await expect(await canvas.findByText('Sunday Morning Static')).toBeVisible()
    // Not straight away: recently played takes a moment to list the track that just ended.
    await expect(syncs).toHaveBeenCalledTimes(before)
    await waitFor(() => expect(syncs).toHaveBeenCalledTimes(before + 1))
    // History is fetched again with the new plays.
    await waitFor(() => expect(playsRequests.mock.calls.length).toBeGreaterThan(playsBefore))
    await new Promise((resolve) => setTimeout(resolve, timing.afterTrackChangeMs + 200))
    await expect(syncs).toHaveBeenCalledTimes(before + 1)
  },
})

/** The tab goes out of view and comes back. */
const leaveAndComeBack = () => {
  focusManager.setFocused(false)
  focusManager.setFocused(true)
}

export const SyncsOnComingBackWhenStale = meta.story({
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Brass Monkey Business')).toBeVisible()
    // Whether or not this mount has seen the sync on opening, history is fresh after this.
    leaveAndComeBack()
    await settle()
    const fresh = syncs.mock.calls.length
    leaveAndComeBack()
    await settle()
    await expect(syncs).toHaveBeenCalledTimes(fresh)

    // Away for longer than `staleAfterMs`.
    focusManager.setFocused(false)
    await new Promise((resolve) => setTimeout(resolve, timing.staleAfterMs))
    focusManager.setFocused(true)
    await waitFor(() => expect(syncs).toHaveBeenCalledTimes(fresh + 1))
  },
})

export const RefetchesDevicesWhenPlaybackMoves = meta.story({
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText('On Studio Laptop')).toBeVisible()
    await waitFor(() => expect(devicesRequests).toHaveBeenCalledTimes(1))

    spotify = { ...spotify, device: { ...devices[1]!, isActive: true } }
    await userEvent.click(canvas.getByRole('button', { name: 'Check playback' }))
    await expect(await canvas.findByText('On Pixel Phone')).toBeVisible()
    await waitFor(() => expect(devicesRequests).toHaveBeenCalledTimes(2))
  },
})
