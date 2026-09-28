import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyncScheduler, SYNC_TIMING } from './auto-sync.ts'

const { afterTrackChangeMs, staleAfterMs } = SYNC_TIMING

describe('createSyncScheduler', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  const setup = () => {
    const sync = vi.fn<() => void>()
    return { sync, scheduler: createSyncScheduler(sync) }
  }

  it('syncs once, a while after the playing item changes', () => {
    const { sync, scheduler } = setup()
    scheduler.itemChanged('spotify:track:a')
    scheduler.itemChanged('spotify:track:b')
    vi.advanceTimersByTime(afterTrackChangeMs - 1)
    expect(sync).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(sync).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10 * afterTrackChangeMs)
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('takes the first item and the same item again as no change', () => {
    const { sync, scheduler } = setup()
    scheduler.itemChanged('spotify:track:a')
    scheduler.itemChanged('spotify:track:a')
    vi.advanceTimersByTime(afterTrackChangeMs)
    expect(sync).not.toHaveBeenCalled()
  })

  it('counts an item ending in nothing, but not something starting after nothing', () => {
    const { sync, scheduler } = setup()
    scheduler.itemChanged(null)
    scheduler.itemChanged('spotify:track:a')
    vi.advanceTimersByTime(afterTrackChangeMs)
    expect(sync).not.toHaveBeenCalled()
    scheduler.itemChanged(null)
    vi.advanceTimersByTime(afterTrackChangeMs)
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('waits for skipping to stop: each change starts the wait again', () => {
    const { sync, scheduler } = setup()
    scheduler.itemChanged('spotify:track:a')
    for (const uri of ['b', 'c', 'd']) {
      vi.advanceTimersByTime(afterTrackChangeMs - 1_000)
      scheduler.itemChanged(`spotify:track:${uri}`)
    }
    expect(sync).not.toHaveBeenCalled()
    vi.advanceTimersByTime(afterTrackChangeMs)
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('syncs on coming back only when the last sync is stale', () => {
    const { sync, scheduler } = setup()
    // Nothing synced yet.
    scheduler.returned()
    expect(sync).toHaveBeenCalledTimes(1)
    // Visibility and focus often arrive together: the sync just started counts.
    scheduler.returned()
    expect(sync).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(staleAfterMs - 1)
    scheduler.returned()
    expect(sync).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    scheduler.returned()
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('counts syncs from elsewhere and from a track change', () => {
    const { sync, scheduler } = setup()
    scheduler.synced()
    scheduler.returned()
    expect(sync).not.toHaveBeenCalled()

    vi.advanceTimersByTime(staleAfterMs)
    scheduler.itemChanged('spotify:track:a')
    scheduler.itemChanged('spotify:track:b')
    vi.advanceTimersByTime(afterTrackChangeMs)
    expect(sync).toHaveBeenCalledTimes(1)
    scheduler.returned()
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('keeps a pending track-change sync when syncing now', () => {
    const { sync, scheduler } = setup()
    scheduler.itemChanged('spotify:track:a')
    scheduler.itemChanged('spotify:track:b')
    scheduler.syncNow()
    vi.advanceTimersByTime(afterTrackChangeMs)
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('drops a pending sync when stopped', () => {
    const { sync, scheduler } = setup()
    scheduler.itemChanged('spotify:track:a')
    scheduler.itemChanged('spotify:track:b')
    scheduler.stop()
    vi.advanceTimersByTime(afterTrackChangeMs)
    expect(sync).not.toHaveBeenCalled()
  })
})
