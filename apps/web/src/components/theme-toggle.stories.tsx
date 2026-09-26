import preview from '#storybook/preview'
import { expect, waitFor } from 'storybook/test'
import { ThemeToggle } from './theme-toggle.tsx'

const meta = preview.meta({ component: ThemeToggle, parameters: { layout: 'centered' } })

const shown = () => document.documentElement.dataset.theme

export const Light = meta.story({
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()
  },
})

export const Dark = meta.story({
  globals: { theme: 'dark' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Switch to light theme' })).toBeVisible()
  },
})

export const TogglesAndRemembers = meta.story({
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Switch to dark theme' }))
    await waitFor(() => expect(shown()).toBe('dark'))
    await expect(localStorage.getItem('rc:theme')).toBe('dark')

    await userEvent.click(await canvas.findByRole('button', { name: 'Switch to light theme' }))
    await waitFor(() => expect(shown()).toBe('light'))
    await expect(localStorage.getItem('rc:theme')).toBe('light')
  },
})
