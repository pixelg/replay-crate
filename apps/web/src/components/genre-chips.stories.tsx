import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { expect } from 'storybook/test'
import { genre } from '../test/fixtures.ts'
import { GenreChips } from './genre-chips.tsx'

const meta = preview.meta({
  component: GenreChips,
  args: { genres: [genre.hipHop, genre.boomBap, genre.jazz] },
  parameters: { layout: 'centered' },
  // Chips link to History, so render inside a throwaway router.
  decorators: [
    (Story) => {
      const router = createRouter({ routeTree: createRootRoute({ component: Story }), history: createMemoryHistory() })
      return <RouterProvider router={router} />
    },
  ],
})

/** Each genre opens History filtered to it. */
export const Default = meta.story({
  play: async ({ canvas }) => {
    const chips = await canvas.findAllByRole('link')
    await expect(chips.map((chip) => chip.textContent)).toEqual(['hip hop', 'boom bap', 'jazz'])
    await expect(canvas.getByRole('link', { name: 'hip hop' })).toHaveAttribute('href', `/history?genre=${genre.hipHop.id}`)
  },
})

/** A list row shows the strongest few. */
export const Limited = meta.story({
  args: { max: 2 },
  play: async ({ canvas }) => {
    await expect(await canvas.findAllByRole('link')).toHaveLength(2)
    await expect(canvas.queryByText('jazz')).toBeNull()
  },
})

/** An artist not looked up yet: nothing, not an empty list. */
export const NoGenres = meta.story({
  args: { genres: [] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('ul')).toBeNull()
  },
})
