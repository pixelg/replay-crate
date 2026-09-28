import preview from '#storybook/preview'
import { useQuery } from '@tanstack/react-query'
import { expect, fn, screen, waitFor } from 'storybook/test'
import { http } from '../test/handlers.ts'
import { TrackRating } from './star-rating.tsx'

const ratingRequests = fn()

/**
 * A row's rating as the app shows it: the track comes from the query cache, so a change shows
 * as soon as `useRateTrack` writes it there.
 */
function Rated({ initial }: { initial: number | null }) {
  const { data: track } = useQuery({
    queryKey: ['story-track', initial],
    queryFn: () => ({ id: 't1', name: 'Brass Monkey Business', rating: initial }),
    initialData: { id: 't1', name: 'Brass Monkey Business', rating: initial },
    staleTime: Infinity,
  })
  return <TrackRating track={track} compactOnPhones />
}

const meta = preview.meta({
  title: 'Components/Track Rating',
  component: Rated,
  args: { initial: 4 },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  parameters: { layout: 'centered' },
  beforeEach({ msw }) {
    ratingRequests.mockClear()
    msw.use(
      http.put('/api/v1/tracks/{id}/rating', async ({ params, request, response }) => {
        const { rating } = await request.json()
        ratingRequests('put', params.id, rating)
        return response(200).json({ rating })
      }),
      http.delete('/api/v1/tracks/{id}/rating', ({ params, response }) => {
        ratingRequests('delete', params.id)
        return response(204).empty()
      }),
    )
  },
})

const trigger = (canvas: { getByRole: (role: string, options: object) => HTMLElement }, shown: string) =>
  canvas.getByRole('button', { name: `Rating for Brass Monkey Business: ${shown}` })
const popover = () => screen.queryByRole('dialog', { name: 'Rate Brass Monkey Business' })

/** On a phone, a number and a star stand in for the five stars. */
export const OnPhone = meta.story({
  play: async ({ canvas }) => {
    await expect(trigger(canvas, '4 stars')).toHaveTextContent('4')
    await expect(canvas.queryByRole('radiogroup')).toBeNull()
  },
})

export const Unrated = meta.story({
  args: { initial: null },
  play: async ({ canvas }) => {
    await expect(trigger(canvas, 'not rated')).toHaveTextContent('–')
  },
})

export const TapToRate = meta.story({
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(trigger(canvas, '4 stars'))
    const dialog = await waitFor(() => popover()!)
    // Focus moves to the current rating.
    await waitFor(() => expect(screen.getByRole('radio', { name: '4 stars' })).toHaveFocus())
    await expect(dialog).toContainElement(screen.getByRole('radiogroup', { name: 'Rating for Brass Monkey Business' }))
    // Picking a star saves it and closes the stars.
    await userEvent.click(screen.getByRole('radio', { name: '2 stars' }))
    await waitFor(() => expect(ratingRequests).toHaveBeenCalledWith('put', 't1', 2))
    await waitFor(() => expect(popover()).toBeNull())
    await expect(trigger(canvas, '2 stars')).toHaveTextContent('2')
  },
})

export const TapTheSameStarToClear = meta.story({
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(trigger(canvas, '4 stars'))
    await userEvent.click(await screen.findByRole('radio', { name: '4 stars' }))
    await waitFor(() => expect(ratingRequests).toHaveBeenCalledWith('delete', 't1'))
    await waitFor(() => expect(popover()).toBeNull())
    await expect(trigger(canvas, 'not rated')).toHaveTextContent('–')
  },
})

export const Keyboard = meta.story({
  play: async ({ canvas, userEvent }) => {
    trigger(canvas, '4 stars').focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('radio', { name: '4 stars' })).toHaveFocus())
    // Arrow keys move the rating and leave the stars open...
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => expect(ratingRequests).toHaveBeenLastCalledWith('put', 't1', 3))
    await expect(popover()).not.toBeNull()
    // ...and Enter closes them, back on the (updated) number.
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(popover()).toBeNull())
    await waitFor(() => expect(trigger(canvas, '3 stars')).toHaveFocus())
  },
})

export const EscapeOrTapOutsideCloses = meta.story({
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(trigger(canvas, '4 stars'))
    await waitFor(() => expect(popover()).not.toBeNull())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(popover()).toBeNull())

    await userEvent.click(trigger(canvas, '4 stars'))
    await waitFor(() => expect(popover()).not.toBeNull())
    await userEvent.click(document.body)
    await waitFor(() => expect(popover()).toBeNull())
    await expect(ratingRequests).not.toHaveBeenCalled()
  },
})

/** From `md` up the row has room for the stars themselves. */
export const OnDesktop = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.queryByRole('button', { name: /^Rating for/ })).toBeNull()
  },
})
