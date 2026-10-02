import { useQueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { useState } from 'react'
import { createAppRouter } from '../router.ts'

/** The whole app (real route tree + shell) at a given URL, handing its router to `onRouter` to check where it went. */
export function App({ path, onRouter }: { path: string; onRouter?: (router: ReturnType<typeof createAppRouter>) => void }) {
  const queryClient = useQueryClient()
  const [router] = useState(() => {
    const created = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) })
    onRouter?.(created)
    return created
  })
  return <RouterProvider router={router} />
}
