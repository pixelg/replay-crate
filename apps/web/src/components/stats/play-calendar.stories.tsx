import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { expect, fn, waitFor } from 'storybook/test'
import { localDayKey } from '@replay-crate/core'
import { calendarYears, statsCalendar } from '../../test/fixtures.ts'
import { PlayCalendar } from './play-calendar.tsx'

const today = localDayKey(new Date())
const dayOf = (root: HTMLElement, day: string) => root.querySelector<HTMLElement>(`[data-day="${day}"]`)!

const meta = preview.meta({
  title: 'Stats/PlayCalendar',
  component: PlayCalendar,
  // 2024 starts on a Monday and is a leap year.
  args: { calendar: statsCalendar(2024), year: 2024, today, onYearChange: fn() },
  // Days link to History, so render inside a throwaway router.
  decorators: [
    (Story) => {
      const router = createRouter({ routeTree: createRootRoute({ component: Story }), history: createMemoryHistory() })
      return <RouterProvider router={router} />
    },
  ],
})

export const Default = meta.story({
  play: async ({ canvas, canvasElement }) => {
    const grid = await canvas.findByRole('grid', { name: 'Plays per day in 2024' })
    await expect(grid).toBeVisible()
    // Every day of the year, each a link to that day in History.
    await expect(canvas.getAllByRole('link')).toHaveLength(366)
    const busy = dayOf(canvasElement, '2024-03-04')
    await expect(busy.getAttribute('aria-label')).toMatch(/^40 plays on /)
    await expect(busy.getAttribute('href')).toContain('before=')
    await expect(dayOf(canvasElement, '2024-01-11').getAttribute('aria-label')).toMatch(/^No plays on /)
    for (const month of ['Jan', 'Jun', 'Dec']) await expect(canvas.getByRole('columnheader', { name: month })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Shades, from no plays to the most' })).toBeVisible()
    await expect(canvas.getByText(/ plays in 2024 · busiest /)).toBeVisible()
  },
})

export const KeyboardMovesBetweenDays = meta.story({
  play: async ({ canvas, canvasElement, userEvent }) => {
    await canvas.findByRole('grid')
    // One day is in the tab order: the latest.
    const latest = dayOf(canvasElement, '2024-12-31')
    await expect(latest).toHaveAttribute('tabindex', '0')
    latest.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(dayOf(canvasElement, '2024-12-24')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    await expect(dayOf(canvasElement, '2024-12-23')).toHaveFocus()
    await expect(dayOf(canvasElement, '2024-12-23')).toHaveAttribute('tabindex', '0')
    await expect(latest).toHaveAttribute('tabindex', '-1')
    await userEvent.keyboard('{Home}')
    await expect(dayOf(canvasElement, '2024-01-01')).toHaveFocus()
    // The year's edges hold.
    await userEvent.keyboard('{ArrowLeft}')
    await expect(dayOf(canvasElement, '2024-01-01')).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect(latest).toHaveFocus()
    // Focus shows the day's count, as hovering does.
    await expect(canvas.getByText(latest.getAttribute('aria-label')!)).toBeVisible()
  },
})

export const HoverShowsCount = meta.story({
  play: async ({ canvas, canvasElement, userEvent }) => {
    await canvas.findByRole('grid')
    const day = dayOf(canvasElement, '2024-03-04')
    await userEvent.hover(day)
    await expect(canvas.getByText(day.getAttribute('aria-label')!)).toBeVisible()
    await userEvent.unhover(day)
    await expect(canvas.queryByText(day.getAttribute('aria-label')!)).toBeNull()
  },
})

export const SwitchesYear = meta.story({
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Later year' }))
    await expect(args.onYearChange).toHaveBeenLastCalledWith(2025)
    await userEvent.click(canvas.getByRole('button', { name: 'Earlier year' }))
    await expect(args.onYearChange).toHaveBeenLastCalledWith(2023)
  },
})

/** The first year: nothing earlier to go to. 2020 had no plays, so the arrows skip it. */
export const FirstYear = meta.story({
  args: { calendar: statsCalendar(2019), year: 2019 },
  play: async ({ args, canvas, userEvent }) => {
    await expect(await canvas.findByRole('button', { name: 'Earlier year' })).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Later year' }))
    await expect(args.onYearChange).toHaveBeenLastCalledWith(calendarYears[1])
  },
})

/** This year so far: days still to come aren't links. */
export const ThisYear = meta.story({
  args: { calendar: statsCalendar(), year: new Date().getFullYear() },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('grid')
    const start = new Date(new Date().getFullYear(), 0, 1)
    const soFar = Math.round((new Date(`${today}T00:00:00`).getTime() - start.getTime()) / 86_400_000) + 1
    await expect(canvas.getAllByRole('link')).toHaveLength(soFar)
    await expect(dayOf(canvasElement, today)).toHaveAttribute('tabindex', '0')
    await expect(canvas.getByRole('button', { name: 'Later year' })).toBeDisabled()
  },
})

export const EmptyYear = meta.story({
  args: { calendar: { ...statsCalendar(2020), days: [] }, year: 2020 },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByText('No plays in 2020')).toBeVisible()
    await expect(dayOf(canvasElement, '2020-02-29').getAttribute('aria-label')).toMatch(/^No plays on /)
  },
})

/** Scrolls sideways on a phone, starting at December. */
export const Mobile = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    const grid = await canvas.findByRole('grid')
    const scroller = grid.parentElement!
    await waitFor(() => expect(scroller.scrollLeft).toBeGreaterThan(0))
    const box = scroller.getBoundingClientRect()
    const december = dayOf(canvasElement, '2024-12-31').getBoundingClientRect()
    await expect(december.right).toBeLessThanOrEqual(box.right)
    await expect(dayOf(canvasElement, '2024-01-01').getBoundingClientRect().left).toBeLessThan(box.left)
  },
})

export const Dark = meta.story({
  globals: { theme: 'dark' },
})

export const Loading = meta.story({
  args: { year: 2025, pending: true },
  play: async ({ canvas }) => {
    // The year asked for is picked while the last one stays on screen.
    await expect(await canvas.findByRole('grid', { name: 'Plays per day in 2024' })).toBeVisible()
    await expect(canvas.getByRole('combobox', { name: 'Calendar year' })).toHaveTextContent('2025')
  },
})
