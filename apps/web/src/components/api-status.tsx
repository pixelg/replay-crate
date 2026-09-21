import { healthQueryOptions } from '@replay-crate/api-client'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.ts'
import { cn } from 'cn'

export function ApiStatus() {
  const { status } = useQuery(healthQueryOptions(api))

  const { label, dot } = {
    pending: { label: 'Checking API…', dot: 'bg-muted-foreground animate-pulse' },
    success: { label: 'API connected', dot: 'bg-green-600 dark:bg-green-400' },
    error: { label: 'API unreachable', dot: 'bg-red-600 dark:bg-red-400' },
  }[status]

  return (
    <p role="status" className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden className={cn('size-2.5 rounded-full', dot)} />
      {label}
    </p>
  )
}
