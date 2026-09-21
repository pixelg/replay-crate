import { Link } from '@tanstack/react-router'
import { CircleUser, Disc3, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../lib/cx.ts'
import { navItems } from './nav-items.ts'
import { MenuContent, MenuLinkItem, MenuRoot, MenuSeparator, MenuTrigger } from './ui/menu.tsx'

// Nav links style their active state from the `data-status="active"` attribute that
// TanStack Router's <Link> sets (it also sets aria-current="page").

/**
 * Mobile-first layout: top bar + bottom tab bar below `md`, persistent sidebar from `md` up.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-border bg-surface-sunken p-4 md:flex">
        <Brand />
        <SidebarNav />
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur md:px-8">
          <Brand className="md:hidden" />
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </header>
        <main className="flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10">
          {children}
        </main>
      </div>

      <BottomTabs />
    </div>
  )
}

function Brand({ className }: { className?: string }) {
  return (
    <Link to="/" className={cx('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <Disc3 aria-hidden className="size-6 text-accent" />
      Replay Crate
    </Link>
  )
}

function SidebarNav() {
  return (
    <nav aria-label="Main">
      <ul className="flex flex-col gap-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface hover:text-fg data-[status=active]:bg-surface data-[status=active]:text-fg"
            >
              <Icon aria-hidden className="size-5" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function BottomTabs() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-4">
        {navItems.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-fg-muted data-[status=active]:text-accent"
            >
              <Icon aria-hidden className="size-6" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function AccountMenu() {
  return (
    <MenuRoot>
      <MenuTrigger aria-label="Account">
        <CircleUser aria-hidden className="size-6" />
      </MenuTrigger>
      <MenuContent>
        <MenuLinkItem render={<Link to="/settings" />}>Settings</MenuLinkItem>
        <MenuSeparator />
        <MenuLinkItem href="https://github.com/pixelg/replay-crate" target="_blank" rel="noreferrer">
          Source on GitHub <ExternalLink aria-hidden className="ml-auto size-4 text-fg-muted" />
        </MenuLinkItem>
      </MenuContent>
    </MenuRoot>
  )
}
