import preview from '#storybook/preview'
import { delay, http, HttpResponse } from 'msw'
import { expect } from 'storybook/test'
import { ApiStatus } from './api-status.tsx'

const meta = preview.meta({
  component: ApiStatus,
  parameters: { layout: 'centered' },
})

export const Connected = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/health', () => HttpResponse.json({ ok: true })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('API connected')).toBeVisible()
  },
})

export const Unreachable = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/health', () => new HttpResponse(null, { status: 502 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('API unreachable')).toBeVisible()
  },
})

export const Checking = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/v1/health', async () => {
        await delay('infinite')
        return HttpResponse.json({ ok: true })
      }),
    )
  },
})
