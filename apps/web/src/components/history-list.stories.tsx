import preview from '#storybook/preview'
import { createRootRoute, createRouter, RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { expect, within } from 'storybook/test'
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
    await expect(canvas.getAllByText('Late Night Crate')[0]).toBeVisible()
    // Spotify won't name its own algorithmic playlists; fall back to a generic label.
    await expect(canvas.getByText('Spotify playlist')).toBeVisible()
  },
})

/**
 * Each row lists the playlists of yours holding the track, each a link to it. The one a play came
 * from leads, ringed; a play from somewhere else (an album, a Spotify playlist) keeps its own chip.
 */
export const PlaylistsOfEachTrack = meta.story({
  play: async ({ canvas }) => {
    const [fromCrate, fromDiscover] = canvas.getAllByText('Brass Monkey Business').map((title) => within(title.closest('li')!))
    // Played from Late Night Crate, which holds it: ringed, and also on Boom Bap Essentials.
    const source = fromCrate!.getByRole('link', { name: 'Late Night Crate' })
    await expect(source).toHaveAttribute('href', '/playlists/p1')
    await expect(source).toHaveAttribute('title', 'Played from Late Night Crate')
    await expect(source).toHaveClass('ring-1')
    const alsoOn = within(fromCrate!.getByRole('list', { name: 'Also on' }))
    await expect(alsoOn.getByRole('link', { name: 'Boom Bap Essentials' })).toHaveAttribute('href', '/playlists/p2')
    await expect(alsoOn.queryByText('Late Night Crate')).toBeNull()
    // Played from a Spotify playlist: that chip isn't a link, and both of yours follow, unringed.
    await expect(fromDiscover!.getByText('Spotify playlist').closest('a')).toBeNull()
    const yours = within(fromDiscover!.getByRole('list', { name: 'On your playlists' }))
    for (const name of ['Late Night Crate', 'Boom Bap Essentials']) {
      await expect(yours.getByRole('link', { name })).not.toHaveClass('ring-1')
    }
    // From an album: the album, then the playlist it's on.
    const fromAlbum = within(canvas.getByText('Sunday Morning Static').closest('li')!)
    await expect(fromAlbum.getByText('Sunday Sessions').closest('a')).toBeNull()
    await expect(fromAlbum.getByRole('link', { name: 'Road Trip (with Sam)' })).toHaveAttribute('href', '/playlists/p3')
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
