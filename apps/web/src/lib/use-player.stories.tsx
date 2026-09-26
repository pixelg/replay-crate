import preview from '#storybook/preview'
import { formatDuration } from '@replay-crate/core'
import { expect, fn, waitFor } from 'storybook/test'
import { pausedPlayback } from '../test/fixtures.ts'
import { handlers, http } from '../test/handlers.ts'
import { describeError } from './describe-error.ts'
import { usePlayback, usePlayerControls } from './use-player.ts'

/**
 * The player hooks on their own (the mini player and player page build on them): polling,
 * the position ticking between polls, optimistic commands and their rollback.
 */
function PlayerProbe() {
  const { playback: current, progressMs, error } = usePlayback()
  const { send, error: commandError } = usePlayerControls()
  if (error) return <p role="alert">{describeError(error).title}</p>
  if (!current) return <p>Nothing is active</p>
  return (
    <div className="space-y-2 p-4">
      <p>{current.item?.name}</p>
      <p aria-label="Position">{formatDuration(progressMs)}</p>
      <p aria-label="State">{current.isPlaying ? 'Playing' : 'Paused'}</p>
      <p aria-label="Volume">{current.device.volumePercent}%</p>
      <button type="button" onClick={() => send(current.isPlaying ? { kind: 'pause' } : { kind: 'play' })}>
        {current.isPlaying ? 'Pause' : 'Play'}
      </button>
      <button type="button" onClick={() => send({ kind: 'volume', percent: 20 })}>
        Volume 20%
      </button>
      {commandError && <p role="alert">{describeError(commandError).message}</p>}
    </div>
  )
}

const meta = preview.meta({
  title: 'Hooks/usePlayback',
  component: PlayerProbe,
  beforeEach({ msw }) {
    msw.use(...handlers.player)
  },
})

export const TicksWhilePlaying = meta.story({
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Brass Monkey Business')).toBeVisible()
    await expect(canvas.getByLabelText('Position')).toHaveTextContent('1:21')
    // No new poll yet: the position moves on locally.
    await waitFor(() => expect(canvas.getByLabelText('Position')).toHaveTextContent('1:22'), { timeout: 2_500 })
  },
})

export const StaysPutWhilePaused = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(200).json({ playback: pausedPlayback })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByLabelText('State')).toHaveTextContent('Paused')
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    await expect(canvas.getByLabelText('Position')).toHaveTextContent('1:21')
  },
})

const requests = fn()

export const PauseShowsAtOnce = meta.story({
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.put('/api/v1/player/pause', async ({ request, response }) => {
        requests(await request.json())
        // Spotify is slow to confirm; the UI shouldn't wait for it.
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        return response(204).empty()
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Pause' }))
    await expect(canvas.getByLabelText('State')).toHaveTextContent('Paused')
    await expect(canvas.getByRole('button', { name: 'Play' })).toBeVisible()
    await waitFor(() => expect(requests).toHaveBeenCalledWith({}))
  },
})

export const RefusalRollsBack = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.put('/api/v1/player/volume', ({ response }) =>
        response(403).json({ error: 'command_refused', reason: 'VOLUME_CONTROL_DISALLOW' }),
      ),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByLabelText('Volume')).toHaveTextContent('70%')
    await userEvent.click(canvas.getByRole('button', { name: 'Volume 20%' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent("This device doesn't let apps change its volume.")
    await expect(canvas.getByLabelText('Volume')).toHaveTextContent('70%')
  },
})

export const NothingActive = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(200).json({ playback: null })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Nothing is active')).toBeVisible()
  },
})

export const NoPremium = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(403).json({ error: 'premium_required' })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Spotify Premium needed')
  },
})
