import addonA11y from '@storybook/addon-a11y'
import { definePreview } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import addonMsw from 'msw-storybook-addon'
import { useState } from 'react'
import '../src/styles.css'

// Stories use CSF Next: `preview.meta({...})` and `meta.story({...})`.
// Mock API calls per story with `beforeEach({ msw }) { msw.use(...) }`.
export default definePreview({
  addons: [addonA11y(), addonMsw()],
  decorators: [
    (Story) => {
      // Fresh cache per story so MSW handlers aren't masked by earlier results.
      const [queryClient] = useState(
        () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      )
      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      )
    },
  ],
  parameters: {
    // Accessibility violations fail the story's test.
    a11y: { test: 'error' },
  },
})
