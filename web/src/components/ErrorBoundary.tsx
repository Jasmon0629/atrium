import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { guardedReload } from '../lib/version';

interface State {
  error: Error | null;
}

interface Props {
  children: ReactNode;
  /** Night palette for the display routes. */
  dark?: boolean;
  /** Unattended screens: reload on their own after this many ms (rate-limited). */
  autoReloadMs?: number;
}

/** Catches render errors in a page so one broken screen never blanks the app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Atrium render error', error, info.componentStack);
    if (this.props.autoReloadMs) {
      this.timer = setTimeout(() => guardedReload('render error on an unattended screen'), this.props.autoReloadMs);
    }
  }

  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const dark = this.props.dark;
    return (
      <div
        className={
          dark
            ? 'flex h-screen flex-col items-center justify-center gap-3 bg-night-900 p-8 text-center text-night-text'
            : 'flex h-full flex-col items-center justify-center gap-3 p-8 text-center'
        }
      >
        <p className="font-display text-xl font-bold">Something went wrong on this screen</p>
        <p className={dark ? 'max-w-sm text-sm text-night-muted' : 'max-w-sm text-sm text-ink-400'}>
          {dark && this.props.autoReloadMs
            ? 'This display will reload itself in a moment.'
            : 'The rest of Atrium is fine. Reload the page — if it keeps happening, tell an admin what you clicked.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="btn-brand mt-2 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
        >
          <RefreshCw size={15} /> Reload
        </button>
      </div>
    );
  }
}
