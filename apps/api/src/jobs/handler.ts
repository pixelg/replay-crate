import type { AppDeps } from '../deps.ts'
import type { Api } from './budget.ts'

export type JobContext = {
  /** The job's user's Spotify access token, fetched on first use (and shared within a run). */
  accessToken: () => Promise<string>
}

/** How to do one kind of job. */
export type Handler = {
  /** The API it calls: each is paced, budgeted and paused on its own. */
  api: Api
  /**
   * Catching up on the catalog (an import's tracks, artists' images): there can be thousands, and
   * the daily budget can take days over them, so the lane's other jobs are claimed first.
   */
  backfill?: true
  /** Does the work; makes exactly one call to `api`. */
  run: (deps: AppDeps, ref: string, ctx: JobContext) => Promise<void>
  /** The API doesn't have the thing (404/400); clean up anything waiting on it. */
  gone?: (deps: AppDeps, ref: string) => Promise<void>
}
