import preview from '#storybook/preview'
import { expect } from 'storybook/test'
import { AppErrorBoundary } from './app-error-boundary.tsx'

function Crashes(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'name')")
}

const meta = preview.meta({
  component: AppErrorBoundary,
  parameters: { layout: 'fullscreen' },
})

export const CatchesARenderCrash = meta.story({
  render: () => (
    <AppErrorBoundary>
      <Crashes />
    </AppErrorBoundary>
  ),
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: 'Something broke in the app' })).toBeVisible()
    await expect(canvas.getByRole('alert')).toHaveAttribute('data-error-source', 'app')
  },
})
