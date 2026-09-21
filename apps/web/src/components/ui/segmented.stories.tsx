import preview from '#storybook/preview'
import { useState } from 'react'
import { expect } from 'storybook/test'
import { Segmented } from './segmented.tsx'

const options = [
  { value: 'order', label: 'Playlist order' },
  { value: 'most', label: 'Most played' },
  { value: 'least', label: 'Least played' },
] as const

function Demo() {
  const [value, setValue] = useState<(typeof options)[number]['value']>('order')
  return <Segmented label="Sort tracks" value={value} onChange={setValue} options={options} />
}

const meta = preview.meta({ component: Demo, parameters: { layout: 'centered' } })

export const Default = meta.story({})

export const SelectsAndStaysSelected = meta.story({
  play: async ({ canvas, userEvent }) => {
    const most = canvas.getByRole('button', { name: 'Most played' })
    await userEvent.click(most)
    await expect(most).toHaveAttribute('aria-pressed', 'true')
    // Clicking the active option again doesn't leave nothing selected.
    await userEvent.click(most)
    await expect(most).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.getByRole('button', { name: 'Playlist order' })).toHaveAttribute('aria-pressed', 'false')
  },
})
