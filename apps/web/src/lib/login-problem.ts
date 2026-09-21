/** A Spotify login that didn't complete (cancelled, expired state...). The user can simply retry. */
export class LoginProblem extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoginProblem'
  }
}
