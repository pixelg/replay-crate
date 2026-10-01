import { describe, expect, it } from 'vitest'
import { isFinished, LISTEN_GAP_MS, mergeListen } from './listens.ts'

const MIN = 60_000
const HOUR = 60 * MIN
const at = (minutes: number) => minutes * MIN
const observe = (minutes: number, positionMs: number, isPlaying = true) => ({ at: at(minutes), positionMs, isPlaying, durationMs: HOUR })

describe('mergeListen', () => {
  it('starts a listen when an episode is playing and none is open', () => {
    expect(mergeListen(null, observe(10, 5 * MIN))).toEqual({ kind: 'start', startedAt: at(10), listenedMs: 0, positionMs: 5 * MIN })
  })

  it("dates the start from Spotify's last change when it's recent, never past the position", () => {
    expect(mergeListen(null, { ...observe(10, 5 * MIN), changedAt: at(8) })).toMatchObject({ startedAt: at(8), listenedMs: 2 * MIN })
    expect(mergeListen(null, { ...observe(10, 30_000), changedAt: at(8) })).toMatchObject({ startedAt: at(8), listenedMs: 30_000 })
    expect(mergeListen(null, { ...observe(60, 5 * MIN), changedAt: at(10) })).toMatchObject({ startedAt: at(60), listenedMs: 0 })
  })

  it('ignores a paused episode with no listen to carry on', () => {
    expect(mergeListen(null, observe(10, 5 * MIN, false))).toEqual({ kind: 'ignore' })
  })

  it('carries on a listen the position has moved along', () => {
    const open = { lastSeenAt: at(10), positionMs: 5 * MIN }
    expect(mergeListen(open, observe(12, 7 * MIN))).toEqual({ kind: 'continue', listenedMs: 2 * MIN, positionMs: 7 * MIN, advanced: true })
  })

  it('counts sped-up listening, up to 3.5×', () => {
    const open = { lastSeenAt: at(10), positionMs: 0 }
    expect(mergeListen(open, observe(12, 4 * MIN))).toMatchObject({ kind: 'continue', listenedMs: 4 * MIN })
    expect(mergeListen(open, observe(12, 7.5 * MIN))).toMatchObject({ kind: 'continue', listenedMs: 7 * MIN })
  })

  it('keeps a paused listen open without lengthening it', () => {
    const open = { lastSeenAt: at(10), positionMs: 5 * MIN }
    expect(mergeListen(open, observe(14, 5 * MIN, false))).toEqual({ kind: 'continue', listenedMs: 0, positionMs: 5 * MIN, advanced: false })
  })

  it('allows small rewinds and skips', () => {
    const open = { lastSeenAt: at(10), positionMs: 20 * MIN }
    expect(mergeListen(open, observe(11, 19.5 * MIN))).toMatchObject({ kind: 'continue', listenedMs: 0, advanced: false })
  })

  it('starts a new listen after a long gap', () => {
    const open = { lastSeenAt: at(10), positionMs: 5 * MIN }
    expect(mergeListen(open, { ...observe(10, 5 * MIN), at: at(10) + LISTEN_GAP_MS + 1 })).toMatchObject({ kind: 'start' })
  })

  it('never starts a new listen before the last one was last seen', () => {
    const open = { lastSeenAt: at(10), positionMs: 30 * MIN }
    expect(mergeListen(open, { ...observe(11, 2 * MIN), changedAt: at(9) })).toMatchObject({ kind: 'start', startedAt: at(10) + 1 })
  })

  it('starts a new listen after a jump in either direction', () => {
    const open = { lastSeenAt: at(10), positionMs: 30 * MIN }
    expect(mergeListen(open, observe(12, 2 * MIN))).toMatchObject({ kind: 'start', positionMs: 2 * MIN })
    expect(mergeListen(open, observe(12, 50 * MIN))).toMatchObject({ kind: 'start', positionMs: 50 * MIN })
  })
})

describe('isFinished', () => {
  it('is within a minute of the end, or 3% of long episodes', () => {
    expect(isFinished(29 * MIN, 30 * MIN)).toBe(true)
    expect(isFinished(28 * MIN, 30 * MIN)).toBe(false)
    expect(isFinished(3 * HOUR - 5 * MIN, 3 * HOUR)).toBe(true)
    expect(isFinished(0, 0)).toBe(false)
  })
})
