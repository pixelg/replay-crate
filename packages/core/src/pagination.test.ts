import { describe, expect, it } from 'vitest'
import { formatRange, pageCount, pageOf, pageWindow, parsePage, parsePageSize } from './pagination.ts'

describe('parsePageSize', () => {
  it('accepts the offered sizes from URLs and storage', () => {
    expect(parsePageSize('20')).toBe(20)
    expect(parsePageSize(5)).toBe(5)
    expect(parsePageSize('all')).toBe('all')
  })

  it('rejects anything else', () => {
    for (const value of ['7', 7, 0, '-5', 'ALL', '', null, undefined, {}]) expect(parsePageSize(value)).toBeUndefined()
  })
})

describe('parsePage', () => {
  it('takes positive whole numbers', () => {
    expect(parsePage('3')).toBe(3)
    expect(parsePage(1)).toBe(1)
    for (const value of ['0', -1, 1.5, 'two', '', undefined]) expect(parsePage(value)).toBeUndefined()
  })
})

describe('pageCount and pageOf', () => {
  it('counts pages, with at least one', () => {
    expect(pageCount(0, 20)).toBe(1)
    expect(pageCount(20, 20)).toBe(1)
    expect(pageCount(21, 20)).toBe(2)
  })

  it('finds the page an item is on', () => {
    expect(pageOf(0, 10)).toBe(1)
    expect(pageOf(9, 10)).toBe(1)
    expect(pageOf(10, 10)).toBe(2)
    // Page 3 of 10 starts at item 20; at 25 per page that's page 1.
    expect(pageOf((3 - 1) * 10, 25)).toBe(1)
  })
})

describe('pageWindow', () => {
  it('lists every page when they fit', () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('elides the far side near either end', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 20])
    expect(pageWindow(4, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 20])
    expect(pageWindow(20, 20)).toEqual([1, 'ellipsis', 16, 17, 18, 19, 20])
    expect(pageWindow(17, 20)).toEqual([1, 'ellipsis', 16, 17, 18, 19, 20])
  })

  it('elides both sides in the middle', () => {
    expect(pageWindow(10, 20)).toEqual([1, 'ellipsis', 9, 10, 11, 'ellipsis', 20])
    expect(pageWindow(10, 20, 2)).toEqual([1, 'ellipsis', 8, 9, 10, 11, 12, 'ellipsis', 20])
  })

  it('keeps the same number of slots all the way through', () => {
    for (let page = 1; page <= 30; page++) expect(pageWindow(page, 30)).toHaveLength(7)
  })

  it('never hides a single page behind an ellipsis', () => {
    for (let page = 1; page <= 12; page++) {
      const window = pageWindow(page, 12)
      window.forEach((slot, i) => {
        if (slot !== 'ellipsis') return
        const before = window[i - 1] as number
        const after = window[i + 1] as number
        expect(after - before).toBeGreaterThan(2)
      })
    }
  })

  it('clamps a page outside the range', () => {
    expect(pageWindow(99, 20)).toEqual(pageWindow(20, 20))
  })
})

describe('formatRange', () => {
  it('says which items a page shows', () => {
    expect(formatRange(1, 20, 1234, 'en-US')).toBe('1–20 of 1,234')
    expect(formatRange(62, 20, 1234, 'en-US')).toBe('1,221–1,234 of 1,234')
    expect(formatRange(1, 20, 7, 'en-US')).toBe('1–7 of 7')
    expect(formatRange(1, 20, 0, 'en-US')).toBe('0 of 0')
  })
})
