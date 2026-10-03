import type { ReactNode } from 'react'

/**
 * A page's title and description, with a quiet `status` line under them (when it last synced...)
 * and its `actions`. The actions sit on the right while they fit beside the title, else on a line
 * of their own under it, from the left edge like the content. Keeping the status out of their line
 * means its changing text never moves the buttons.
 */
export function PageHeader({
  title,
  description,
  status,
  actions,
}: {
  title: string
  description?: ReactNode
  status?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 flex-[1_1_20rem]">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {status && <div className="mt-1 text-xs text-muted-foreground">{status}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
