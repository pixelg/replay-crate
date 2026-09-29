import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { expect, fn, screen, waitFor } from 'storybook/test'
import { onThisDay, timeline } from '../test/fixtures.ts'
import { TimelineStrip } from './timeline-strip.tsx'

const onJump = fn()
const year = new Date().getFullYear()

const meta = preview.meta({
  title: 'History/TimelineStrip',
  component: TimelineStrip,
  args: { months: timeline.months, current: '2019-03', onJump, onThisDay },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach() {
    onJump.mockClear()
  },
  // The On this day dots are links, so render inside a throwaway router.
  decorators: [
    (Story) => {
      const router = createRouter({ routeTree: createRootRoute({ component: Story }), history: createMemoryHistory() })
      return <RouterProvider router={router} />
    },
  ],
})

/** The month being read is the slider's value; arrow keys pick another, Enter goes there. */
export const Default = meta.story({
  play: async ({ canvas, userEvent }) => {
    const slider = await canvas.findByRole('slider', { name: 'Month to go to' })
    await expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^March 2019, [\d,]+ plays$/))

    slider.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^February 2019, /))
    await expect(onJump).not.toHaveBeenCalled()
    await userEvent.keyboard('{PageUp}{Enter}')
    await expect(onJump).toHaveBeenCalledWith('2020-02')

    // Escape lets go of a pick; the latest month is the present.
    await userEvent.keyboard('{ArrowRight}{Escape}{Enter}')
    await expect(onJump).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{End}{Enter}')
    await expect(onJump).toHaveBeenLastCalledWith(null)
  },
})

/** Months that were never recorded are there, as gaps. */
export const Gaps = meta.story({
  args: { current: '2014-09' },
  play: async ({ canvas, userEvent }) => {
    const slider = await canvas.findByRole('slider', { name: 'Month to go to' })
    slider.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(slider).toHaveAttribute('aria-valuetext', 'August 2014, 0 plays')
    await userEvent.keyboard('{Home}')
    await expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^June 2011, /))
  },
})

/** A click goes to the month under it. */
export const Click = meta.story({
  play: async ({ canvas, userEvent }) => {
    const slider = await canvas.findByRole('slider', { name: 'Month to go to' })
    await userEvent.click(slider)
    await waitFor(() => expect(onJump).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/)))
  },
})

/** On this day: a dot for each earlier year, each a link to that day. */
export const OnThisDayDots = meta.story({
  play: async ({ canvas, userEvent }) => {
    const dots = await canvas.findAllByRole('link', { name: /: [\d,]+ plays?$/ })
    await expect(dots).toHaveLength(3)
    await expect(dots[0]).toHaveAttribute('href', expect.stringContaining('/history?before='))
    await userEvent.hover(dots.find((dot) => dot.getAttribute('aria-label')!.includes(String(year - 1)))!)
    // Once it has faded in.
    await waitFor(() => expect(screen.getByText('Brass Monkey Business')).toBeVisible())
  },
})

export const NothingOnThisDay = meta.story({
  args: { onThisDay: undefined },
  play: async ({ canvas }) => {
    await canvas.findByRole('slider', { name: 'Month to go to' })
    await expect(canvas.queryByText('On this day')).toBeNull()
  },
})

export const Dark = meta.story({
  globals: { theme: 'dark', viewport: { value: 'desktop', isRotated: false } },
})
