import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { ZodType } from 'zod'

/**
 * zValidator with the API's standard 400 body:
 * `{ error: 'invalid_request', issues: [{ path, message }] }`.
 */
export function validate<Target extends keyof ValidationTargets, Schema extends ZodType>(target: Target, schema: Schema) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      return c.json({ error: 'invalid_request' as const, issues }, 400)
    }
  })
}
