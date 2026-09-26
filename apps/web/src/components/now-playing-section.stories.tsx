import preview from '#storybook/preview'
import type { PlayerItem } from '@replay-crate/api-client'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { expect } from 'storybook/test'
import { nowPlaying, playback, queue } from '../test/fixtures.ts'
import { NowPlayingSection } from './history-list.tsx'

const episode = queue.queue.find((item) => item.type === 'episode')!
const localFile: PlayerItem = { ...(nowPlaying as Extract<PlayerItem, { type: 'track' }>), id: null, name: 'demo-take-3.mp3' }

const meta = preview.meta({
  title: 'History/NowPlayingSection',
  component: NowPlayingSection,
  args: { item: nowPlaying, context: playback.context },
  decorators: [
    (Story) => {
      const router = createRouter({ routeTree: createRootRoute({ component: Story }), history: createMemoryHistory() })
      return <RouterProvider router={router} />
    },
  ],
})

export const Track = meta.story({
  play: async ({ canvas }) => {
    const section = await canvas.findByRole('group', { name: 'Now playing' })
    await expect(section).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Brass Monkey Business' })).toHaveAttribute('href', '/tracks/t1')
    await expect(canvas.getByText('The Loop Collective, MC Vinyl')).toBeVisible()
    await expect(canvas.getByText('Late Night Crate')).toBeVisible()
    await expect(canvas.getByText('Playing')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Actions for Brass Monkey Business' })).toBeVisible()
    // Not a recorded play yet: nothing to select, no time.
    await expect(canvas.queryByRole('checkbox')).toBeNull()
    await expect(canvas.queryByRole('time')).toBeNull()
  },
})

export const Episode = meta.story({
  args: { item: episode, context: null },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('The History of the Breakbeat')).toBeVisible()
    await expect(canvas.getByText('Sample Science')).toBeVisible()
    // Episodes have no track page, rating or track menu.
    await expect(canvas.queryByRole('link')).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Actions for/ })).toBeNull()
  },
})

export const LocalFile = meta.story({
  args: { item: localFile, context: null },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('demo-take-3.mp3')).toBeVisible()
    await expect(canvas.queryByRole('link')).toBeNull()
  },
})

export const Mobile = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
})
