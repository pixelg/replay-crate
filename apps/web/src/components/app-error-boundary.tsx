import { Component, type ReactNode } from 'react'
import { ErrorPage } from './error-page.tsx'

type State = { hasError: false } | { hasError: true; error: unknown }

/**
 * Last line of defence around the whole app. Route errors are handled by the router's
 * error components; this only catches what escapes them (providers, the router itself).
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error }
  }

  render() {
    return this.state.hasError ? <ErrorPage error={this.state.error} fullScreen /> : this.props.children
  }
}
