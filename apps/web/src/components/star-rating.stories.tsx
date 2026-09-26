import preview from '#storybook/preview'
import { useState } from 'react'
import { expect, fn } from 'storybook/test'
import { StarRating } from './star-rating.tsx'

const onChange = fn()

/** Controlled like the app uses it: the rating follows each change. */
function Rated({ initial, ...props }: { initial: number | null; size?: 'sm' | 'md'; disabled?: boolean }) {
  const [rating, setRating] = useState(initial)
  return (
    <StarRating
      label="Rating for Brass Monkey Business"
      rating={rating}
      onChange={(next) => {
        onChange(next)
        setRating(next)
      }}
      {...props}
    />
  )
}

const meta = preview.meta({
  title: 'Components/Star Rating',
  component: Rated,
  args: { initial: null },
  beforeEach() {
    onChange.mockClear()
  },
  parameters: { layout: 'centered' },
})

const group = (canvas: { getByRole: (role: string, options: object) => HTMLElement }) =>
  canvas.getByRole('radiogroup', { name: 'Rating for Brass Monkey Business' })

export const Unrated = meta.story({
  play: async ({ canvas }) => {
    await expect(group(canvas)).toBeVisible()
    for (const star of canvas.getAllByRole('radio')) await expect(star).toHaveAttribute('aria-checked', 'false')
  },
})

export const FourStars = meta.story({
  args: { initial: 4 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true')
  },
})

export const ClickToRate = meta.story({
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('radio', { name: '3 stars' }))
    await expect(onChange).toHaveBeenLastCalledWith(3)
    await expect(canvas.getByRole('radio', { name: '3 stars' })).toHaveAttribute('aria-checked', 'true')
  },
})

export const ClickTheSameStarToClear = meta.story({
  args: { initial: 3 },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('radio', { name: '3 stars' }))
    await expect(onChange).toHaveBeenLastCalledWith(null)
    await expect(canvas.getByRole('radio', { name: '3 stars' })).toHaveAttribute('aria-checked', 'false')
  },
})

export const Keyboard = meta.story({
  args: { initial: 2 },
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole('radio', { name: '2 stars' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(onChange).toHaveBeenLastCalledWith(3)
    await userEvent.keyboard('{ArrowRight}')
    await expect(onChange).toHaveBeenLastCalledWith(4)
    // Delete (or Backspace) clears.
    await userEvent.keyboard('{Delete}')
    await expect(onChange).toHaveBeenLastCalledWith(null)
  },
})

export const Large = meta.story({ args: { initial: 5, size: 'md' } })
