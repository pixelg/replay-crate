import { meQueryOptions } from '@replay-crate/api-client'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ChartColumn, Disc3, History, ListMusic } from 'lucide-react'
import { Button } from '../components/ui/button.tsx'
import { api } from '../lib/api.ts'
import { startSpotifyLogin } from '../lib/spotify-login.ts'

export const Route = createFileRoute('/connect')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions(api))
    if (me) throw redirect({ to: '/history' })
  },
  component: ConnectPage,
})

const features = [
  { icon: History, text: 'Every play recorded, with the playlist it came from' },
  { icon: ListMusic, text: 'Play counts inside your playlists, and where else each track lives' },
  { icon: ChartColumn, text: 'Top tracks, artists, albums and genres over any time range' },
]

function ConnectPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Disc3 aria-hidden className="size-12 text-accent" />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Replay Crate</h1>
        <p className="mt-2 text-fg-muted">Your Spotify listening history, remembered.</p>

        <ul className="mt-8 flex flex-col gap-4">
          {features.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-3 text-sm">
              <Icon aria-hidden className="size-5 shrink-0 text-fg-muted" />
              {text}
            </li>
          ))}
        </ul>

        <Button className="mt-10 w-full" onClick={() => void startSpotifyLogin()}>
          Connect Spotify
        </Button>
        <p className="mt-3 text-center text-xs text-fg-muted">
          You'll sign in on Spotify's site. Replay Crate never sees your password.
        </p>
      </div>
    </main>
  )
}
