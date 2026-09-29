import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, Link, RouterProvider } from '@tanstack/react-router'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { monthCursor } from '../lib/months.ts'
import { onThisDay, timeline } from '../test/fixtures.ts'
import { TimelineDrawer, TimelineRail, type TimelineLink } from './history-timeline.tsx'

const linkTo: TimelineLink = (month, props) => <Link to="/" search={month ? { before: monthCursor(month) } : {}} {...props} />
const onJump = fn()

const meta = preview.meta({
  title: 'HistoryTimeline',
  component: TimelineRail,
  args: {
    months: timeline.months,
    current: '2019-03',
    linkTo,
    className: 'w-72',
  },
  beforeEach() {
    onJump.mockClear()
  },
  decorators: [
    (Story) => {
      const router = createRouter({ routeTree: createRootRoute({ component: Story }), history: createMemoryHistory() })
      return <RouterProvider router={router} />
    },
  ],
})

const day = { first: '2011-06-01', last: '2026-09-28', onJump }

/** The year being read is open, with its month marked; the others open on a click. */
export const Rail = meta.story({
  play: async ({ canvas, userEvent }) => {
    const rail = within(await canvas.findByRole('navigation', { name: 'Timeline' }))
    await expect(rail.getByRole('button', { name: '2019, 9,050 plays' })).toHaveAttribute('aria-expanded', 'true')
    await expect(rail.getByRole('link', { name: /^March 2019, / })).toHaveAttribute('data-in-view', 'true')
    await expect(rail.getByRole('link', { name: /^March 2019, / })).toHaveAttribute('href', expect.stringContaining('before='))
    await expect(rail.getByRole('link', { name: 'Now' })).toBeVisible()

    // 2014 had a quiet stretch: only September on.
    await userEvent.click(rail.getByRole('button', { name: /^2014, / }))
    const months = within(rail.getByRole('button', { name: /^2014, / }).closest('li')!).getAllByRole('link')
    await expect(months.map((link) => link.getAttribute('aria-label')?.split(',')[0])).toEqual([
      'December 2014',
      'November 2014',
      'October 2014',
      'September 2014',
    ])
    await userEvent.click(rail.getByRole('button', { name: /^2014, / }))
    await expect(rail.queryByRole('link', { name: /^September 2014/ })).toBeNull()
  },
})

export const RailDark = meta.story({
  globals: { theme: 'dark' },
})

/** A button opening the drawer: a day field, then the years and months. */
export const Drawer = meta.story({
  render: (args) => <TimelineDrawer months={args.months} current={args.current} linkTo={args.linkTo} day={day} onThisDay={onThisDay} />,
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Timeline' }))
    const drawer = within(await screen.findByRole('dialog', { name: 'Timeline' }))
    await expect(drawer.getByRole('link', { name: /^March 2019, / })).toHaveAttribute('data-in-view', 'true')
    await expect(drawer.getByRole('link', { name: 'Now' })).toBeVisible()

    // On this day is a switch away.
    await userEvent.click(drawer.getByRole('button', { name: 'On this day' }))
    await expect(drawer.getByRole('heading', { name: 'On this day' })).toBeVisible()
    await expect(drawer.queryByRole('navigation', { name: 'Timeline' })).toBeNull()
    await userEvent.click(drawer.getByRole('button', { name: 'Months' }))

    // A day: the drawer closes on the way there.
    const field = drawer.getByLabelText('Go to a day')
    await expect(field).toHaveAttribute('min', '2011-06-01')
    await userEvent.type(field, '2019-03-12')
    await userEvent.click(drawer.getByRole('button', { name: 'Go' }))
    await expect(onJump).toHaveBeenCalledWith('2019-03-12')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Timeline' })).toBeNull())
  },
})

/** Following a link closes it too. */
export const DrawerClosesOnALink = meta.story({
  render: (args) => <TimelineDrawer months={args.months} current={args.current} linkTo={args.linkTo} day={day} />,
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Timeline' }))
    const drawer = within(await screen.findByRole('dialog', { name: 'Timeline' }))
    // Nothing on this day: no switch, straight to the months.
    await expect(drawer.queryByRole('button', { name: 'On this day' })).toBeNull()
    await userEvent.click(drawer.getByRole('link', { name: /^March 2019, / }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Timeline' })).toBeNull())
  },
})

export const DrawerDark = meta.story({
  render: (args) => <TimelineDrawer months={args.months} current={args.current} linkTo={args.linkTo} day={day} onThisDay={onThisDay} />,
  globals: { theme: 'dark' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Timeline' }))
    await expect(await screen.findByRole('dialog', { name: 'Timeline' })).toBeVisible()
  },
})
