import type { ReactNode } from 'react'

/** `text` with the ranges the search matched in bold (the server says which, as character offsets). */
export function Highlighted({ text, ranges }: { text: string; ranges: ReadonlyArray<readonly [number, number]> }) {
  if (!ranges.length) return text
  const parts: ReactNode[] = []
  let last = 0
  for (const [start, end] of ranges) {
    if (start > last) parts.push(text.slice(last, start))
    parts.push(
      <mark key={start} className="bg-transparent font-semibold text-primary">
        {text.slice(start, end)}
      </mark>,
    )
    last = end
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
