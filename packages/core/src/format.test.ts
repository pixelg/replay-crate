import { describe, expect, it } from 'vitest'
import { formatDayLabel, formatDuration, formatRelative, groupByDay, localDayKey } from './format.ts'

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(215_000)).toBe('3:35')
    expect(formatDuration(59_600)).toBe('1:00')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })
})

describe('formatDayLabel', () => {
  const now = new Date(2026, 8, 21, 15, 0) // Mon 21 Sep 2026, local time

  it('names recent days', () => {
    expect(formatDayLabel(new Date(2026, 8, 21, 0, 5), now, 'en-US')).toBe('Today')
    expect(formatDayLabel(new Date(2026, 8, 20, 23, 59), now, 'en-US')).toBe('Yesterday')
    expect(formatDayLabel(new Date(2026, 8, 17, 12), now, 'en-US')).toBe('Thursday')
  })

  it('uses a date for older days, with the year only when it differs', () => {
    expect(formatDayLabel(new Date(2026, 8, 1, 12), now, 'en-US')).toBe('Tue, Sep 1')
    expect(formatDayLabel(new Date(2025, 11, 31, 12), now, 'en-US')).toBe('Wed, Dec 31, 2025')
  })
})

describe('formatRelative', () => {
  const now = new Date(2026, 8, 21, 5, 30) // Monday 05:30 local
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000)

  it('uses minutes and hours for recent plays', () => {
    expect(formatRelative(ago(10), now, 'en-US')).toBe('just now')
    expect(formatRelative(ago(5 * 60), now, 'en-US')).toBe('5 minutes ago')
    expect(formatRelative(ago(3 * 3600), now, 'en-US')).toBe('3 hours ago')
  })

  it('counts calendar days once it is more than a few hours ago', () => {
    expect(formatRelative(new Date(2026, 8, 20, 18, 0), now, 'en-US')).toBe('yesterday')
    expect(formatRelative(new Date(2026, 8, 19, 21, 42), now, 'en-US')).toBe('2 days ago') // Saturday night
    expect(formatRelative(new Date(2026, 8, 7, 12, 0), now, 'en-US')).toBe('2 weeks ago')
    expect(formatRelative(new Date(2026, 5, 21, 12, 0), now, 'en-US')).toBe('3 months ago')
  })
})

describe('groupByDay', () => {
  it('groups consecutive items by local day', () => {
    const items = [new Date(2026, 8, 21, 10), new Date(2026, 8, 21, 9), new Date(2026, 8, 20, 22)]
    const groups = groupByDay(items, (d) => d)
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([
      ['2026-09-21', 2],
      ['2026-09-20', 1],
    ])
    expect(localDayKey(items[2]!)).toBe('2026-09-20')
  })
})
