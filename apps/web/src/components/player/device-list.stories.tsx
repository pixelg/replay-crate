import preview from '#storybook/preview'
import { ApiError } from '@replay-crate/api-client'
import { expect, fn, screen, within } from 'storybook/test'
import { devices } from '../../test/fixtures.ts'
import { DeviceList } from './device-list.tsx'

const available = devices.filter((device) => device.isAvailable)
const livingRoom = devices.find((device) => device.id === 'living-room')!
const transferFailed = (status: number, code: string) => new ApiError({ status, code, endpoint: 'PUT /api/v1/player/device' })

const meta = preview.meta({
  title: 'Player/Device List',
  component: DeviceList,
  args: { devices, onPlayHere: fn(), onForget: fn() },
  decorators: [(Story) => <div className="max-w-md p-4">{Story()}</div>],
})

export const OnlyAvailable = meta.story({
  args: { devices: available },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^Playing here/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Play on Pixel Phone' })).toBeEnabled()
    await expect(canvas.queryByRole('region', { name: 'Played on before' })).toBeNull()
  },
})

export const PlayedOnBefore = meta.story({
  play: async ({ args, canvas, userEvent }) => {
    const before = within(canvas.getByRole('region', { name: 'Played on before' }))
    await expect(before.getByText('TV · Last used 2 days ago')).toBeVisible()
    // Spotify can't address the car stereo at all, so it can't be tried; only forgotten.
    await expect(before.getByText('Car Stereo')).toBeVisible()
    await expect(before.queryByRole('button', { name: 'Try playing on Car Stereo' })).toBeNull()
    await expect(before.getByRole('button', { name: 'Options for Car Stereo' })).toBeVisible()

    await userEvent.click(before.getByRole('button', { name: 'Try playing on Living Room TV' }))
    await expect(args.onPlayHere).toHaveBeenCalledWith('living-room')
  },
})

export const NothingOpen = meta.story({
  args: { devices: devices.filter((device) => !device.isAvailable) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/No devices have Spotify open/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try playing on Living Room TV' })).toBeVisible()
  },
})

export const TryRefused = meta.story({
  args: { refusal: { deviceId: 'living-room', error: transferFailed(404, 'not_found') } },
  play: async ({ canvas }) => {
    const row = canvas.getByText('Living Room TV').closest('li')!
    await expect(within(row).getByRole('alert')).toHaveTextContent('Open Spotify on Living Room TV first.')
    await expect(canvas.getAllByRole('alert')).toHaveLength(1)
  },
})

export const TryFailedOtherwise = meta.story({
  args: { refusal: { deviceId: 'living-room', error: transferFailed(503, 'rate_limited') } },
  play: async ({ canvas }) => {
    const row = canvas.getByText('Living Room TV').closest('li')!
    await expect(within(row).getByRole('alert')).not.toHaveTextContent('Open Spotify')
  },
})

export const Forget = meta.story({
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Options for Living Room TV' }))
    // The menu renders in a portal, outside the story canvas.
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    await expect(args.onForget).toHaveBeenCalledWith(livingRoom)
  },
})
