import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { expect, within } from 'storybook/test'
import { onThisDay } from '../test/fixtures.ts'
import { OnThisDay } from './on-this-day.tsx'

const year = new Date().getFullYear()

const meta = preview.meta({
  title: 'History/OnThisDay',
  component: OnThisDay,
  args: { onThisDay },
  // Years and tracks are links, so render inside a throwaway router.
  decorators: [
    (Story) => {
      const router = createRouter({ routeTree: createRootRoute({ component: Story }), history: createMemoryHistory() })
      return <RouterProvider router={router} />
    },
  ],
})

export const Default = meta.story({
  play: async ({ canvas }) => {
    const section = await canvas.findByRole('region', { name: 'On this day' })
    await expect(within(section).getByText(/in 3 earlier years$/)).toBeVisible()
    // Newest year first; each opens that day in History.
    const years = within(section).getAllByRole('link', { name: /^\d{4} · / })
    await expect(years.map((link) => link.textContent)).toEqual([`${year - 1} · 42 plays`, `${year - 3} · 17 plays`, `${year - 7} · 1 play`])
    await expect(years[0]).toHaveAttribute('href', expect.stringContaining('/history?before='))
    // Most played first, each to its track page.
    const top = within(section).getByRole('list', { name: `Most played on this day in ${year - 1}` })
    const tracks = within(top).getAllByRole('link')
    await expect(tracks[0]).toHaveTextContent('Brass Monkey Business')
    await expect(tracks[0]).toHaveAttribute('href', '/tracks/t1')
    await expect(within(top).getByText('6')).toBeVisible()
  },
})

export const OneYear = meta.story({
  args: { onThisDay: { ...onThisDay, years: onThisDay.years.slice(-1) } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/in an earlier year$/)).toBeVisible()
  },
})

export const Dark = meta.story({
  globals: { theme: 'dark' },
})
