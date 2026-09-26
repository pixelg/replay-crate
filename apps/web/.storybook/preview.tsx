import addonA11y from '@storybook/addon-a11y'
import { definePreview } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import addonMsw from 'msw-storybook-addon'
import { useLayoutEffect, useState } from 'react'
import { configure } from 'storybook/test'
import { setThemePreference } from '../src/lib/theme.ts'
import '../src/styles.css'

// findBy* gives up after 1s by default. A run's first story also loads the app cold, and turbo
// runs the other packages' tests alongside, so a busy CI runner can need longer.
configure({ asyncUtilTimeout: 5000 })

// Stories use CSF Next: `preview.meta({...})` and `meta.story({...})`.
// Mock API calls per story with `beforeEach({ msw }) { msw.use(...) }`.
export default definePreview({
  addons: [addonA11y(), addonMsw()],
  // Theme toolbar: stories render light unless they (or the toolbar) ask for dark.
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: { title: 'Theme', icon: 'mirror', items: ['light', 'dark'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light' },
  beforeEach() {
    // Forget what earlier stories picked: the theme and the lists' page sizes live in localStorage.
    setThemePreference('system')
    for (const key of Object.keys(localStorage)) if (key.startsWith('rc:page-size:')) localStorage.removeItem(key)
  },
  decorators: [
    (Story, { globals }) => {
      const theme = globals.theme === 'dark' ? 'dark' : 'light'
      useLayoutEffect(() => {
        document.documentElement.dataset.theme = theme
      }, [theme])
      return <Story />
    },
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
