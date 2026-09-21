import preview from '#storybook/preview'
import { expect } from 'storybook/test'
import { ContextChip } from './context-chip.tsx'

const meta = preview.meta({
  component: ContextChip,
  args: { context: { type: 'playlist', uri: 'spotify:playlist:p1', name: 'Late Night Crate', imageUrl: null } },
  parameters: { layout: 'centered' },
})

export const Playlist = meta.story({})

export const Album = meta.story({
  args: { context: { type: 'album', uri: 'spotify:album:a1', name: 'Dusty Grooves', imageUrl: null } },
})

export const Artist = meta.story({
  args: { context: { type: 'artist', uri: 'spotify:artist:a1', name: 'The Loop Collective', imageUrl: null } },
})

export const LikedSongs = meta.story({
  args: { context: { type: 'collection', uri: 'spotify:user:u:collection', name: 'Liked Songs', imageUrl: null } },
})

export const UnnamedPlaylist = meta.story({
  args: { context: { type: 'playlist', uri: 'spotify:playlist:x', name: null, imageUrl: null } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Spotify playlist')).toBeVisible()
  },
})
