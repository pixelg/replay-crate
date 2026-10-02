import {
  healthQueryOptions,
  meQueryOptions,
  settingsQueryOptions,
  updateSettings,
  type PlayTracksFrom,
  type Settings,
} from '@replay-crate/api-client'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ApiStatus } from '../../components/api-status.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { Button } from '../../components/ui/button.tsx'
import { buttonClasses } from '../../components/ui/button-classes.ts'
import { Segmented } from '../../components/ui/segmented.tsx'
import { ModeToggle } from '../../components/mode-toggle.tsx'
import { UserAvatar } from '../../components/user-avatar.tsx'
import { api } from '../../lib/api.ts'
import { describeError } from '../../lib/describe-error.ts'
import { setModeOffers, useModeOffers } from '../../lib/mode-offer.ts'
import { useLogout } from '../../lib/use-logout.ts'
import { type ThemePreference, useTheme } from '../../lib/theme.ts'

export const Route = createFileRoute('/_app/settings')({
  // Start the health check and settings during navigation without blocking the page on them.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(healthQueryOptions(api))
    void context.queryClient.prefetchQuery(settingsQueryOptions(api))
  },
  component: SettingsPage,
})

const themeOptions = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

function SettingsPage() {
  const { data: me } = useSuspenseQuery(meQueryOptions(api))
  const logout = useLogout()
  const { preference, setPreference } = useTheme()
  const offers = useModeOffers()

  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-4">
        {me && (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-medium">Account</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <UserAvatar user={me} className="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{me.displayName ?? me.id}</p>
                <p className="text-sm text-muted-foreground">Connected to Spotify</p>
              </div>
              <Button variant="secondary" onClick={() => void logout()}>
                Log out
              </Button>
            </div>
          </section>
        )}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Library</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              Music or podcasts: what History, the library, Playlists and Stats show on this device. The player plays either.
            </p>
            <ModeToggle className="w-auto" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              Offer to switch when what's playing is the other kind. It only asks; it never switches by itself.
            </p>
            <Segmented<'on' | 'off'>
              label="Offer to switch"
              value={offers.enabled ? 'on' : 'off'}
              onChange={(next) => setModeOffers(next === 'on')}
              options={[
                { value: 'on', label: 'Offer' },
                { value: 'off', label: "Don't" },
              ]}
            />
          </div>
        </section>
        <PlaybackSettings />
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Appearance</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              System follows your device's light or dark setting.
            </p>
            <Segmented<ThemePreference>
              label="Theme"
              value={preference}
              onChange={setPreference}
              options={themeOptions}
            />
          </div>
        </section>
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Import history</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              Add plays from before Replay Crate, or from while it wasn't running, with your Spotify data export.
            </p>
            <Link to="/import" className={buttonClasses({ variant: 'secondary' })}>
              Import
            </Link>
          </div>
        </section>
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Status</h2>
          <div className="mt-2">
            <ApiStatus />
          </div>
        </section>
      </div>
    </>
  )
}

const playTracksFromOptions = [
  { value: 'album', label: 'Album' },
  { value: 'playlist', label: 'Last playlist' },
] as const

/** Settings kept with the account, so every device plays the same way. */
function PlaybackSettings() {
  const queryClient = useQueryClient()
  const { queryKey } = settingsQueryOptions(api)
  const settings = useQuery(settingsQueryOptions(api)).data
  const change = useMutation({
    mutationFn: (changes: Partial<Settings>) => updateSettings(api, changes),
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData(queryKey)
      if (previous) queryClient.setQueryData(queryKey, { ...previous, ...changes })
      return { previous }
    },
    onError: (error, _changes, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
      const { title, message } = describeError(error)
      toast.error(title, { description: message })
    },
    onSuccess: (saved) => queryClient.setQueryData(queryKey, saved),
  })

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-medium">Playback</h2>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Play a track on its own from its album, or from the playlist you last played it from (its album when there's
          none). Up next is the rest of it. Episodes play from their show.
        </p>
        {settings && (
          <Segmented<PlayTracksFrom>
            label="Play tracks from"
            value={settings.playTracksFrom}
            onChange={(playTracksFrom) => change.mutate({ playTracksFrom })}
            options={playTracksFromOptions}
          />
        )}
      </div>
    </section>
  )
}
