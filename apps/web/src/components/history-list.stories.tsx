import preview from '#storybook/preview'
import { createRootRoute, createRouter, RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { expect, screen, within } from 'storybook/test'
import { plays } from '../test/fixtures.ts'
import { HistoryList } from './history-list.tsx'

// A row's chips are in the page twice, the chips and a phone's line of text, one of them hidden.
const visible = (elements: HTMLElement[]) => elements.filter((element) => element.checkVisibility())

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
    await expect(visible(canvas.getAllByText('Spotify playlist'))).toHaveLength(1)
  },
})

/**
 * Each row lists the playlists of yours holding the track, each a link to it. The one a play came
 * from leads; a play from somewhere else (an album, a Spotify playlist) keeps its own chip first.
 * Genres sit on their own line above.
 */
export const PlaylistsOfEachTrack = meta.story({
  play: async ({ canvas }) => {
    const [fromCrate, fromDiscover] = canvas.getAllByText('Brass Monkey Business').map((title) => within(title.closest('li')!))
    // Played from Late Night Crate, which holds it: first, then Boom Bap Essentials.
    const yoursFromCrate = within(fromCrate!.getByRole('list', { name: 'On your playlists' }))
    await expect(yoursFromCrate.getAllByRole('link').map((link) => link.textContent)).toEqual(['Late Night Crate', 'Boom Bap Essentials'])
    await expect(yoursFromCrate.getByRole('link', { name: 'Boom Bap Essentials' })).toHaveAttribute('href', '/playlists/p2')
    // The genres come first, on a line of their own.
    const genres = fromCrate!.getByRole('list', { name: 'Genres' })
    await expect(genres.compareDocumentPosition(fromCrate!.getByRole('list', { name: 'On your playlists' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    await expect(genres.parentElement).toBe(fromCrate!.getByRole('list', { name: 'On your playlists' }).parentElement!.parentElement)
    // Played from a Spotify playlist: that chip isn't a link, and both of yours follow.
    await expect(visible(fromDiscover!.getAllByText('Spotify playlist'))[0]!.closest('a')).toBeNull()
    const yours = within(fromDiscover!.getByRole('list', { name: 'On your playlists' }))
    for (const name of ['Late Night Crate', 'Boom Bap Essentials']) {
      await expect(yours.getByRole('link', { name })).toBeVisible()
    }
    // From an album: the album, then the playlist it's on.
    const fromAlbum = within(canvas.getByText('Sunday Morning Static').closest('li')!)
    await expect(visible(fromAlbum.getAllByText('Sunday Sessions'))[0]!.closest('a')).toBeNull()
    await expect(fromAlbum.getByRole('link', { name: 'Road Trip (with Sam)' })).toHaveAttribute('href', '/playlists/p3')
  },
})

/**
 * On a phone a row's chips are one line of text: one genre with "+N" for the rest, then one place
 * (the playlist the play came from, else wherever it was), and "+N" for the rest of its playlists.
 */
export const Mobile = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const [fromCrate, fromDiscover] = canvas.getAllByText('Brass Monkey Business').map((title) => within(title.closest('li')!))
    const yoursFromCrate = within(fromCrate!.getByRole('list', { name: 'On your playlists' }))
    await expect(yoursFromCrate.getAllByRole('link').map((link) => link.textContent)).toEqual(['Late Night Crate'])
    await expect(yoursFromCrate.getByRole('button', { name: '1 more playlist' })).toBeVisible()
    // One genre, and "+N" for the rest.
    const genres = within(fromCrate!.getByRole('list', { name: 'Genres' }))
    await expect(genres.getAllByRole('link')).toHaveLength(1)
    await userEvent.click(genres.getByRole('button', { name: /^\d+ more genres?$/ }))
    const more = within(await screen.findByRole('dialog'))
    await expect(more.getByRole('link', { name: 'boom bap' })).toHaveAttribute('href', expect.stringContaining('genre='))
    await userEvent.keyboard('{Escape}')
    // Played from somewhere else: that place, and both of yours behind "+2".
    await expect(visible(fromDiscover!.getAllByText('Spotify playlist'))).toHaveLength(1)
    const yoursFromDiscover = within(fromDiscover!.getByRole('list', { name: 'On your playlists' }))
    await expect(yoursFromDiscover.queryAllByRole('link')).toEqual([])
    await expect(yoursFromDiscover.getByRole('button', { name: '2 more playlists' })).toBeVisible()
    // The play button sits on the art; adding to a playlist, or starting one, is left to the ⋯ menu.
    await expect(fromCrate!.getByRole('button', { name: /^Play Brass Monkey Business/ })).toBeVisible()
    await expect(fromCrate!.queryByRole('button', { name: 'New playlist with Brass Monkey Business' })).toBeNull()
    await expect(fromCrate!.queryByRole('button', { name: 'Add Brass Monkey Business to a playlist' })).toBeNull()
  },
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
