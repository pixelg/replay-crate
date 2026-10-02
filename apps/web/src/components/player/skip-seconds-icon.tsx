import type { SVGProps } from 'react'

/**
 * A circular arrow with the seconds inside, as Spotify draws its jump back and forward buttons.
 * Stroked like the Lucide icons beside it.
 */
export function SkipSecondsIcon({
  direction,
  seconds,
  ...props
}: { direction: 'back' | 'forward'; seconds: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* Drawn going back; forward is its mirror image. */}
      <g transform={direction === 'forward' ? 'matrix(-1 0 0 1 24 0)' : undefined}>
        <path d="M12 3a9 9 0 1 1-7.8 4.5" />
        <path d="m14 1-2 2 2 2" />
      </g>
      <text
        x="12"
        y="12.75"
        fill="currentColor"
        stroke="none"
        fontSize="9.5"
        fontWeight="700"
        letterSpacing="-0.5"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {seconds}
      </text>
    </svg>
  )
}
