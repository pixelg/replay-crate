import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-control border border-dashed border-border px-6 py-12 text-center">
      <Icon aria-hidden className="size-10 text-fg-muted" />
      <h2 className="mt-4 font-medium">{title}</h2>
      {children && <div className="mt-1 max-w-sm text-sm text-fg-muted">{children}</div>}
    </div>
  )
}
