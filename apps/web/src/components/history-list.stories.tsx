import preview from '#storybook/preview'
import { createRootRoute, createRouter, RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { expect } from 'storybook/test'
import { plays } from '../test/fixtures.ts'
import { HistoryList } from './history-list.tsx'

const meta = preview.meta({
  component: HistoryList,
  args: { plays },
  // Rows link to track pages, so render inside a throwaway router.
  decorators: [
    (Story) => {
      const router = createRouter({
        routeTree: createRootRoute({ component: Story }),
        history: createMemoryHistory(),
      })
      return <RouterProvider router={router} />
    },
  ],
})

export const Default = meta.story({
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Yesterday' })).toBeVisible()
    await expect(canvas.getByText('Late Night Crate')).toBeVisible()
    // Spotify won't name its own algorithmic playlists; fall back to a generic label.
    await expect(canvas.getByText('Spotify playlist')).toBeVisible()
  },
})

export const Mobile = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
})

/** Brass Monkey Business is playing: both of its plays are marked, nothing else is. */
export const NowPlaying = meta.story({
  args: { playingTrackId: 't1' },
  play: async ({ canvas }) => {
    const rows = canvas.getAllByText('Brass Monkey Business').map((title) => title.closest('[aria-current]'))
    await expect(rows).toHaveLength(2)
    for (const row of rows) await expect(row).toHaveAttribute('aria-current', 'true')
    await expect(canvas.getByText('Sunday Morning Static').closest('[aria-current]')).toBeNull()
  },
})
