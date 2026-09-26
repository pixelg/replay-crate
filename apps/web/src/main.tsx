import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ENV } from 'varlock/env'
import { AppErrorBoundary } from './components/app-error-boundary.tsx'
import { urlOnAppOrigin } from './lib/app-origin.ts'
import { startThemeSync } from './lib/theme.ts'
import { createAppRouter } from './router.ts'
import './styles.css'

// Sign-in only works on the origin Spotify redirects to, so move there first.
const appUrl = urlOnAppOrigin(new URL(window.location.href), ENV.SPOTIFY_REDIRECT_URI)
if (appUrl) window.location.replace(appUrl)
else render()

function render() {
  startThemeSync()
  const queryClient = new QueryClient()
  const router = createAppRouter({ queryClient })

  createRoot(document.getElementById('root')!, {
    // One place to see every error React handles. Swap in an error reporter here later.
    onCaughtError: (error, info) => console.error('Caught by an error boundary:', error, info.componentStack),
    onUncaughtError: (error, info) => console.error('Uncaught error:', error, info.componentStack),
  }).render(
    <StrictMode>
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AppErrorBoundary>
    </StrictMode>,
  )
}
