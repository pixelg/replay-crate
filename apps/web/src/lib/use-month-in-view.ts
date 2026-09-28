import { useEffect, useState, type RefObject } from 'react'

/**
 * The month (`YYYY-MM`) being read in a list of day groups (`[data-day="YYYY-MM-DD"]` inside
 * `container`) as the page scrolls: that of the first day still showing below `top` px (the
 * sticky header, and whatever else sticks under it). `key` changes when the list does.
 */
export function useMonthInView(container: RefObject<HTMLElement | null>, top: number, key: unknown): string | null {
  const [month, setMonth] = useState<string | null>(null)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const days = [...(container.current?.querySelectorAll<HTMLElement>('[data-day]') ?? [])]
      // Scrolled past them all (onto the buttons under the list): still the last one.
      const day = days.find((element) => element.getBoundingClientRect().bottom > top) ?? days.at(-1)
      setMonth(day?.dataset.day?.slice(0, 7) ?? null)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [container, top, key])
  return month
}
