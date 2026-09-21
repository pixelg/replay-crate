import { createApiClient } from '@replay-crate/api-client'

// The API is always same-origin: Vite proxies /api in dev, and prod serves both from one domain.
export const api = createApiClient(window.location.origin)
