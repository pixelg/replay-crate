import preview from '#storybook/preview'
import { Disc3 } from 'lucide-react'
import { expect, fn } from 'storybook/test'
import { Button } from './button.tsx'

const meta = preview.meta({
  component: Button,
  args: { children: 'Create playlist', onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
})

export const Primary = meta.story({
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Create playlist' }))
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
})

export const Secondary = meta.story({ args: { variant: 'secondary' } })

export const Ghost = meta.story({ args: { variant: 'ghost' } })

export const Small = meta.story({ args: { size: 'sm' } })

export const WithIcon = meta.story({
  args: {
    children: (
      <>
        <Disc3 aria-hidden className="size-4" /> Sync now
      </>
    ),
  },
})

export const Disabled = meta.story({
  args: { disabled: true },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Create playlist' }))
    await expect(args.onClick).not.toHaveBeenCalled()
  },
})
