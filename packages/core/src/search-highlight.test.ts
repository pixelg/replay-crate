import { describe, expect, it } from 'vitest'
import { foldText, highlightRanges } from './search-highlight.ts'

const marked = (text: string, words: string[]) => {
  let out = ''
  let last = 0
  for (const [start, end] of highlightRanges(text, words)) {
    out += `${text.slice(last, start)}[${text.slice(start, end)}]`
    last = end
  }
  return out + text.slice(last)
}

describe('foldText', () => {
  it('lowercases and strips accents', () => {
    expect(foldText('Beyoncé Mötley Crüe')).toBe('beyonce motley crue')
  })
})

describe('highlightRanges', () => {
  it('marks word prefixes as you type', () => {
    expect(marked('Brass Monkey Business', ['brass', 'mon'])).toBe('[Brass] [Mon]key Business')
  })

  it('ignores case and accents, and keeps offsets into the original text', () => {
    expect(marked('Beyoncé – Déjà Vu', ['beyonce', 'deja'])).toBe('[Beyoncé] – [Déjà] Vu')
  })

  it('marks whole words within a typo', () => {
    expect(marked('Pete Rock & C.L. Smooth', ['pete', 'rok'])).toBe('[Pete] [Rock] & C.L. Smooth')
    expect(marked('Pete Rock', ['pt'])).toBe('Pete Rock')
    expect(marked('Pete Rock & C.L. Smooth', ['smoth'])).toBe('Pete Rock & C.L. [Smooth]')
  })

  it('only matches at word starts', () => {
    expect(marked('Showbiz', ['biz'])).toBe('Showbiz')
  })

  it('returns nothing for no words', () => {
    expect(highlightRanges('Anything', [])).toEqual([])
  })
})
