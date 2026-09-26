import {
  Ban,
  Bug,
  CircleHelp,
  CloudOff,
  Crown,
  Hourglass,
  KeyRound,
  LogIn,
  MonitorSpeaker,
  ServerCrash,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { describeError, type ErrorAction, type ErrorKind } from '../lib/describe-error.ts'
import { cn } from 'cn'
import { startSpotifyLogin } from '../lib/spotify-login.ts'
import { Button } from './ui/button.tsx'

const icons: Record<ErrorKind, LucideIcon> = {
  offline: CloudOff,
  server: ServerCrash,
  rate_limited: Hourglass,
  signed_out: LogIn,
  reauth: KeyRound,
  not_found: CircleHelp,
  login: TriangleAlert,
  no_device: MonitorSpeaker,
  premium: Crown,
  refused: Ban,
  app: Bug,
}

const labels: Record<ErrorAction, string> = {
  retry: 'Try again',
  reload: 'Reload the page',
  sign_in: 'Sign in again',
  reconnect: 'Reconnect Spotify',
  home: 'Go to History',
}

/**
 * The one error screen for the whole UI. API errors and bugs in the app get
 * different wording and actions (see describeError).
 *
 * `fullScreen` when nothing else can render (the app or its layout failed);
 * otherwise it fills the page area and the navigation stays usable.
 */
export function ErrorPage({
  error,
  onRetry,
  fullScreen = false,
  title,
  message,
}: {
  error: unknown
  /** What "Try again" does, e.g. re-run the route's loaders. Defaults to a reload. */
  onRetry?: () => void
  fullScreen?: boolean
  /** Override the wording for a specific page, e.g. "Playlist not found". */
  title?: string
  message?: string
}) {
  const description = { ...describeError(error), ...(title && { title }), ...(message && { message }) }
  const Icon = icons[description.kind]

  function act() {
    switch (description.action) {
      case 'retry':
        return onRetry ? onRetry() : window.location.reload()
      case 'reload':
        return window.location.reload()
      case 'sign_in':
        // A full navigation also drops every cached query from the old session.
        return window.location.assign('/connect')
      case 'reconnect':
        return void startSpotifyLogin()
      case 'home':
        return window.location.assign('/history')
    }
  }

  return (
    <div
      role="alert"
      data-error-kind={description.kind}
      data-error-source={description.source}
      className={cn(
        'flex flex-col items-center justify-center px-4 py-12 text-center',
        fullScreen ? 'min-h-dvh' : 'min-h-[50dvh]',
      )}
    >
      {/* Red is reserved for genuine bugs; everything else is something the user can act on. */}
      <Icon aria-hidden className={cn('size-10', description.kind === 'app' ? 'text-destructive' : 'text-primary')} />
      <h1 className="mt-4 text-lg font-semibold">{description.title}</h1>
      <p className="mt-1 max-w-sm text-sm text-balance text-muted-foreground">{description.message}</p>
      <Button className="mt-6" onClick={act}>
        {labels[description.action]}
      </Button>
      {description.reference && (
        <p className="mt-4 text-xs text-muted-foreground">
          Reference <code className="font-mono select-all">{description.reference}</code>
        </p>
      )}
      {import.meta.env.DEV && description.details && (
        <pre className="mt-4 max-w-full overflow-x-auto rounded-lg bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
          {description.details}
        </pre>
      )}
    </div>
  )
}
