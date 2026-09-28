import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, Link, RouterProvider } from '@tanstack/react-router'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { monthCursor } from '../lib/months.ts'
import { timeline } from '../test/fixtures.ts'
import { TimelineJump, TimelineRail, type TimelineLink } from './history-timeline.tsx'

const linkTo: TimelineLink = (month, props) => <Link to="/" search={month ? { before: monthCursor(month) } : {}} {...props} />
const onJump = fn()

const meta = preview.meta({
  title: 'HistoryTimeline',
  component: TimelineRail,
  args: {
    months: timeline.months,
    current: '2019-03',
    linkTo,
    day: { first: '2011-06-01', last: '2026-09-28', onJump },
    className: 'w-36',
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

/** A day, typed or picked, and Go. */
export const RailJumpsToADay = meta.story({
  play: async ({ canvas, userEvent }) => {
    const field = await canvas.findByLabelText('Go to a day')
    await expect(field).toHaveAttribute('min', '2011-06-01')
    await userEvent.type(field, '2019-03-12')
    await userEvent.click(canvas.getByRole('button', { name: 'Go' }))
    await expect(onJump).toHaveBeenCalledWith('2019-03-12')
  },
})

export const RailDark = meta.story({
  globals: { theme: 'dark' },
})

export const JumpOnPhone = meta.story({
  render: (args) => <TimelineJump months={args.months} current={args.current} jumped linkTo={args.linkTo} day={args.day!} />,
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Jump to…' }))
    const picker = within(await screen.findByRole('dialog', { name: 'Jump to a month' }))
    // Opens at the year being read.
    await expect(picker.getByRole('button', { name: /^2019, / })).toHaveAttribute('aria-pressed', 'true')
    await expect(picker.getByRole('link', { name: /^March 2019, / })).toHaveAttribute('data-in-view', 'true')
    // Once it has faded in.
    await waitFor(() => expect(picker.getByRole('link', { name: 'Back to now' })).toBeVisible())

    // A day instead: the picker closes on the way there.
    await userEvent.type(picker.getByLabelText('Go to a day'), '2012-02-29')
    await userEvent.click(picker.getByRole('button', { name: 'Go' }))
    await expect(onJump).toHaveBeenCalledWith('2012-02-29')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Jump to a month' })).toBeNull())
  },
})
