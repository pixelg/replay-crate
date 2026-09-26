import type { Me } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { ChevronsUpDown, Disc3, ExternalLink, LogOut, Radio, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from 'cn'
import { modKey, useSearchPalette } from '../lib/search-palette.ts'
import { SearchPaletteProvider } from './search/search-palette-provider.tsx'
import { useIsPlaying } from '../lib/use-player.ts'
import { SearchPalette } from './search/search-palette.tsx'
import { ThemeToggle } from './theme-toggle.tsx'
import { MiniPlayer, MiniPlayerBar } from './mini-player.tsx'
import { Toaster } from './ui/sonner.tsx'
import { navItems, navSections } from './nav-items.ts'
import { MenuContent, MenuItem, MenuLinkItem, MenuRoot, MenuSeparator, MenuTrigger } from './ui/menu.tsx'
import { UserAvatar } from './user-avatar.tsx'

// Nav links style their active state from the `data-status="active"` attribute that
// TanStack Router's <Link> sets (it also sets aria-current="page").

/**
 * Mobile-first layout: top bar + bottom tab bar below `md`, persistent sidebar from `md` up.
 */
export function AppShell({
  user,
  onLogout,
  banner,
  children,
}: {
  user: Me
  onLogout: () => void
  /** Full-width notice under the top bar, e.g. the re-auth prompt. */
  banner?: ReactNode
  children: ReactNode
}) {
  return (
    <SearchPaletteProvider>
      {/* While the phone's mini player bar shows, the page needs that much more room at the bottom. */}
      <div className="min-h-dvh [--player-bar:0px] has-data-mini-player-bar:[--player-bar:3.5rem] md:grid md:grid-cols-[15rem_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-border bg-muted p-4 md:flex">
          <Brand />
          <SearchButton />
          <SidebarNav />
          <div className="mt-auto flex items-center gap-1 border-t border-border pt-4">
            <div className="min-w-0 flex-1">
              <AccountMenu user={user} onLogout={onLogout} placement="sidebar" />
            </div>
            <ThemeToggle />
          </div>
        </aside>

        <div className="flex min-h-dvh min-w-0 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur md:px-8">
            <Brand className="md:hidden" />
            <MiniPlayer className="hidden flex-1 md:flex" />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* Phones have no player tab; this and the player bar lead there. */}
              <Link
                to="/player"
                aria-label="Player"
                title="Player"
                className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted data-[status=active]:text-primary md:hidden"
              >
                <Radio aria-hidden className="size-5" />
              </Link>
              {/* The sidebar holds these from `md` up. */}
              <SearchIconButton />
              <ThemeToggle className="hover:bg-muted md:hidden" />
              <div className="md:hidden">
                <AccountMenu user={user} onLogout={onLogout} placement="header" />
              </div>
            </div>
          </header>
          {banner}
          <main className="flex-1 px-4 pt-6 pb-[calc(5rem+var(--player-bar)+env(safe-area-inset-bottom))] md:px-8 md:pb-10">
            {children}
          </main>
        </div>

        <BottomTabs />
        {/* Clear of the phone's tabs and player bar. */}
        <Toaster position="bottom-center" mobileOffset={{ bottom: 'calc(8.5rem + env(safe-area-inset-bottom))' }} />
        <SearchPalette />
      </div>
    </SearchPaletteProvider>
  )
}

/** The sidebar's way into search: looks like a box, opens the palette. */
function SearchButton() {
  const palette = useSearchPalette()
  return (
    <button
      type="button"
      onClick={() => palette.show()}
      aria-keyshortcuts="Meta+K Control+K /"
      className="-mt-2 flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Search aria-hidden className="size-4" />
      <span className="flex-1 text-left">Search…</span>
      <kbd aria-hidden className="rounded border border-border px-1 font-sans text-xs">
        {modKey()}K
      </kbd>
    </button>
  )
}

/** Phones: a search icon in the top bar (the palette opens full screen). */
function SearchIconButton() {
  const palette = useSearchPalette()
  return (
    <button
      type="button"
      onClick={() => palette.show()}
      aria-label="Search"
      className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted md:hidden"
    >
      <Search aria-hidden className="size-5" />
    </button>
  )
}

function Brand({ className }: { className?: string }) {
  const playing = useIsPlaying()
  return (
    <Link to="/" className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      {/* Turns while music plays and stops where it is, not back at the start (a paused animation
          keeps its angle). No turning at all for reduced motion. */}
      <Disc3
        aria-hidden
        data-playing={playing}
        // The pause is `!important`: the animation shorthand would otherwise reset it to running.
        className="size-6 text-primary motion-safe:animate-spin-record data-[playing=false]:[animation-play-state:paused]!"
      />
      Replay Crate
    </Link>
  )
}

function SidebarNav() {
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {navSections.map((section) => (
        <ul key={section[0]!.to} className="flex flex-col gap-1">
          {section.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground data-[status=active]:bg-background data-[status=active]:text-foreground"
              >
                <Icon aria-hidden className="size-5" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      ))}
    </nav>
  )
}

const tabs = navItems.filter((item) => item.tab)

function BottomTabs() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 md:hidden">
      <MiniPlayerBar />
      <nav aria-label="Main" className="border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground data-[status=active]:text-primary"
              >
                <Icon aria-hidden className="size-6" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

function AccountMenu({
  user,
  onLogout,
  placement,
}: {
  user: Me
  onLogout: () => void
  /** The sidebar's footer row opens the menu upwards; the phone header's avatar opens it downwards. */
  placement: 'sidebar' | 'header'
}) {
  const name = user.displayName ?? user.id
  return (
    <MenuRoot>
      {placement === 'sidebar' ? (
        <MenuTrigger
          aria-label={`Account: ${name}`}
          className="h-auto w-full justify-start gap-3 rounded-lg px-2 py-2 text-left text-foreground hover:bg-background data-popup-open:bg-background"
        >
          <UserAvatar user={user} className="size-8 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </MenuTrigger>
      ) : (
        <MenuTrigger aria-label={`Account: ${name}`}>
          <UserAvatar user={user} className="size-8" />
        </MenuTrigger>
      )}
      <MenuContent
        {...(placement === 'sidebar' ? { side: 'top', align: 'start' } : {})}
        className={placement === 'sidebar' ? 'w-(--anchor-width)' : undefined}
      >
        {/* The sidebar's trigger already shows who's signed in. */}
        {placement === 'header' && (
          <>
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="text-xs text-muted-foreground">Spotify account</p>
            </div>
            <MenuSeparator />
          </>
        )}
        <MenuLinkItem render={<Link to="/settings" />}>Settings</MenuLinkItem>
        <MenuLinkItem href="https://github.com/pixelg/replay-crate" target="_blank" rel="noreferrer">
          Source on GitHub <ExternalLink aria-hidden className="ml-auto size-4 text-muted-foreground" />
        </MenuLinkItem>
        <MenuSeparator />
        <MenuItem onClick={onLogout}>
          <LogOut aria-hidden className="size-4 text-muted-foreground" /> Log out
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  )
}
