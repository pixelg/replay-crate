import { createSyncScheduler, playbackQueryOptions, SYNC_TIMING, type Playback, type SyncTiming } from '@replay-crate/api-client'
import { focusManager, hashKey, matchMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from './api.ts'
import { SYNC_KEY, useSync } from './use-sync.ts'

const PLAYBACK_HASH = hashKey(playbackQueryOptions(api).queryKey)

let syncedOnOpen = false

/**
 * Keeps history and the player fresh from what the app already sees, rather than by polling more:
 * history syncs when the app opens, a while after the playing item changes (the last one has
 * probably finished), and on coming back to the tab after a couple of minutes away; the device
 * list is fetched again when playback moves to another device. Mount it once, for the signed-in
 * app. `timing` is for tests.
 */
export function useFreshData(enabled: boolean, timing: SyncTiming = SYNC_TIMING) {
  const queryClient = useQueryClient()
  const { sync } = useSync()

  useEffect(() => {
    if (!enabled) return
    const scheduler = createSyncScheduler(() => {
      if (!queryClient.isMutating({ mutationKey: SYNC_KEY })) sync()
    }, timing)
    // Once per page load, not on every mount (StrictMode mounts twice).
    if (!syncedOnOpen) {
      syncedOnOpen = true
      scheduler.syncNow()
    }

    // Watch the playback the player polls anyway, rather than asking Spotify again.
    let deviceId: string | null | undefined
    const seen = (playback: Playback | null) => {
      scheduler.itemChanged(playback?.item?.uri ?? null)
      const device = playback?.device.id ?? null
      if (deviceId !== undefined && device !== deviceId) {
        void queryClient.invalidateQueries({ queryKey: ['player', 'devices'] })
      }
      deviceId = device
    }
    const playback = queryClient.getQueryCache().get<Playback | null>(PLAYBACK_HASH)
    if (playback?.state.status === 'success') seen(playback.state.data ?? null)
    const unsubscribePlayback = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success' && event.query.queryHash === PLAYBACK_HASH) {
        seen(event.action.data as Playback | null)
      }
    })

    // Sync now counts as a sync too.
    const unsubscribeSyncs = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success' && matchMutation({ mutationKey: SYNC_KEY }, event.mutation)) {
        scheduler.synced()
      }
    })

    // The tab is back in view (the playback query refetches then too).
    const unsubscribeFocus = focusManager.subscribe((focused) => {
      if (focused) scheduler.returned()
    })

    return () => {
      scheduler.stop()
      unsubscribePlayback()
      unsubscribeSyncs()
      unsubscribeFocus()
    }
  }, [enabled, queryClient, sync, timing])
}
