/**
 * Writes the OpenAPI spec to openapi.json, for tools that need it without a running server
 * (the web app's typed MSW mocks). Committed, so CI can tell when it's stale.
 */
import { writeFile } from 'node:fs/promises'
import { API_BASE, createApp } from '../src/app.ts'
import type { AppDeps } from '../src/deps.ts'

// Building the spec touches no dependency; only the CSRF check reads the redirect URI.
const app = createApp({ redirectUri: 'http://127.0.0.1:5173/callback' } as AppDeps)
const res = await app.request(`${API_BASE}/openapi.json`)
if (!res.ok) throw new Error(`spec request failed: ${res.status}`)

const path = new URL('../openapi.json', import.meta.url)
await writeFile(path, `${JSON.stringify(await res.json(), null, 2)}\n`)
console.log(`wrote ${path.pathname}`)
