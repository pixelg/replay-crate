import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { ZodType } from 'zod'
import { invalidRequest } from './openapi.ts'

/**
 * zValidator with the API's standard 400 body, for routes not yet declared with
 * createRoute (those get the same body from openapi.ts's defaultHook).
 */
export function validate<Target extends keyof ValidationTargets, Schema extends ZodType>(target: Target, schema: Schema) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json(invalidRequest(result.error), 400)
  })
}
