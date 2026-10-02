import type { AnyRoute } from '@tanstack/react-router'
import { fn, within } from 'storybook/test'
import { routeTree } from '../routeTree.gen.ts'
import { http } from './handlers.ts'

const routesIn = (route: AnyRoute): AnyRoute[] => [route, ...Object.values<AnyRoute>(route.children ?? {}).flatMap(routesIn)]

/**
 * Loads every route's code-split chunks (the router's own split; Stats pulls in Recharts). The
 * full-app story files run side by side, each in its own frame, and a cold CI runner can take
 * seconds over a chunk: loading them before the story, under the test's timeout, keeps the
 * stories' waits about the page rather than the download. After the first call it's cached.
 */
export const preloadRoutes = () =>
  Promise.all(
    routesIn(routeTree).flatMap((route) =>
      (['component', 'errorComponent', 'pendingComponent', 'notFoundComponent'] as const).map((type) => {
        const component = route.options[type]
        return component && 'preload' in component ? component.preload?.() : undefined
      }),
    ),
  )

/** A list's rows: its items, without the chip lists nested in them. */
export const rowsOf = (container: HTMLElement) =>
  within(container)
    .getAllByRole('listitem')
    .filter((item) => !item.parentElement?.closest('li'))

/** Turns on select mode and picks rows by their checkbox labels. */
export const pick = async (
  canvas: { findByRole: (role: string, options: object) => Promise<HTMLElement>; getAllByRole: (role: string, options: object) => HTMLElement[] },
  userEvent: { click: (element: Element) => Promise<void> },
  names: RegExp[],
) => {
  await userEvent.click(await canvas.findByRole('button', { name: 'Select' }))
  for (const name of names) await userEvent.click(canvas.getAllByRole('checkbox', { name })[0]!)
  return within(await canvas.findByRole('toolbar', { name: 'Selected tracks' }))
}

export const requests = fn()

export const playerRequests = fn()

export const recordPlays = () => {
  playerRequests.mockClear()
  return http.put('/api/v1/player/play', async ({ request, response }) => {
    playerRequests('play', await request.json())
    return response(204).empty()
  })
}

/** Records each player command's body under its name. */
export const recordPlayerCommands = () => {
  playerRequests.mockClear()
  const record =
    (name: string) =>
    async ({ request, response }: { request: Request; response: (status: 204) => { empty: () => Response } }) => {
      playerRequests(name, await request.json())
      return response(204).empty()
    }
  return [
    http.put('/api/v1/player/seek', record('seek')),
    http.put('/api/v1/player/volume', record('volume')),
    http.put('/api/v1/player/shuffle', record('shuffle')),
    http.put('/api/v1/player/repeat', record('repeat')),
    http.put('/api/v1/player/device', record('transfer')),
  ]
}

/** The names of the "Crate Cut" tracks (`manyTracks`) the page lists, in order. */
export const rowNames = (main: ReturnType<typeof within>) =>
  main.getAllByRole('link', { name: /^Crate Cut \d+$/ }).map((link: HTMLElement) => link.textContent)
