import { describeError } from '../lib/describe-error.ts'

/** A one-line error for actions (like Sync now) that fail without taking over the page. */
export function InlineError({ error, action }: { error: unknown; action: string }) {
  return (
    <p role="alert" className="text-xs text-danger">
      {action} failed: {describeError(error).title}
    </p>
  )
}
