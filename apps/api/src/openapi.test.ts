import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { API_BASE } from './app.ts'
import { TAGS } from './lib/openapi.ts'
import { createTestContext } from './testing.ts'

/** `GET /a/:id` → `GET /a/{id}`, as the spec writes it. */
const toSpecPath = (route: string) => route.replaceAll(/:(\w+)/g, '{$1}')

type Operation = { tags?: string[]; operationId?: string; security?: unknown[]; responses: Record<string, unknown> }
type Spec = {
  openapi: string
  tags: { name: string }[]
  components: { securitySchemes: Record<string, unknown> }
  paths: Record<string, Record<string, Operation>>
}

describe('OpenAPI spec', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let spec: Spec
  let routes: string[]
  let operations: { key: string; path: string; op: Operation }[]

  beforeAll(async () => {
    ctx = await createTestContext()
    spec = (await (await ctx.app.request(`${API_BASE}/openapi.json`)).json()) as Spec
    // Each middleware on a route is its own entry; ALL entries are app-wide middleware.
    routes = [
      ...new Set(ctx.app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`)),
    ].filter((route) => route !== `GET ${API_BASE}/openapi.json`)
    operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, path, op })),
    )
  })
  afterAll(() => ctx.close())

  it('is OpenAPI 3.1 with every tag and both ways to sign in', () => {
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.tags.map((t) => t.name)).toEqual(TAGS.map((t) => t.name))
    expect(Object.keys(spec.components.securitySchemes).sort()).toEqual(['bearer', 'session'])
  })

  it('documents every route', () => {
    const documented = new Set(operations.map((o) => o.key))
    expect(routes.filter((route) => !documented.has(toSpecPath(route)))).toEqual([])
  })

  it('files each operation under one tag, matching its path prefix', () => {
    const misfiled = operations.filter(({ path, op }) => {
      const tag = op.tags?.length === 1 ? TAGS.find((t) => t.name === op.tags![0]) : undefined
      const prefix = `${API_BASE}/${tag?.name.toLowerCase()}`
      return !tag || !(path === prefix || path.startsWith(`${prefix}/`))
    })
    expect(misfiled.map((o) => o.key)).toEqual([])
  })

  it('gives every operation a unique operationId', () => {
    const ids = operations.map((o) => o.op.operationId)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('declares the errors every operation can return', () => {
    const missing = operations.filter(({ op }) => {
      const statuses = Object.keys(op.responses)
      return !statuses.includes('500') || (op.security?.length && !statuses.includes('401'))
    })
    expect(missing.map((o) => o.key)).toEqual([])
  })
})
