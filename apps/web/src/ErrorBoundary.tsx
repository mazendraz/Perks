import { Component, type ErrorInfo, type ReactNode } from 'react';

// A part of the screen that crashes must not blank the whole app (a cashier mid-shift loses the
// sidebar, the queue, everything). This shows a short message in place of the broken part and
// lets the person try again; the rest of the page keeps working.
type Props = {
  children: ReactNode;
  /** Inline: a small card inside a page. Otherwise: the whole workspace area. */
  inline?: boolean;
  /** Changing this (for example the route) clears the error and renders the children again. */
  resetKey?: unknown;
};
type State = { error: Error | null; key: unknown };

const RELOAD_FLAG = 'nuqta-chunk-reload';
// The browser asked for a script of an older release that the server no longer has.
const chunkFailure = (error: Error) =>
  /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(
    error.message || '',
  );

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    // A release changed under an open tab: one quiet reload picks up the new files. The flag
    // stops a reload loop if the file is really missing.
    if (chunkFailure(error)) {
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
        location.reload();
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const ar = document.documentElement.lang !== 'en';
    const retry = () => this.setState({ error: null });
    if (this.props.inline)
      return (
        <div className="notice error" role="alert">
          {ar ? 'الجزء ده ماتحمّلش. ' : 'This part did not load. '}
          <button type="button" className="text-button" onClick={retry}>
            {ar ? 'جرّب تاني' : 'Try again'}
          </button>
        </div>
      );
    return (
      <section className="empty-state" role="alert">
        <h2>{ar ? 'حصلت مشكلة في الصفحة دي' : 'Something went wrong on this page'}</h2>
        <p>
          {ar
            ? 'بياناتك محفوظة. جرّب تاني، ولو المشكلة فضلت حدّث الصفحة.'
            : 'Your data is safe. Try again, and reload the page if it keeps happening.'}
        </p>
        <div className="form-actions">
          <button type="button" className="primary" onClick={retry}>
            {ar ? 'جرّب تاني' : 'Try again'}
          </button>
          <button type="button" className="secondary" onClick={() => location.reload()}>
            {ar ? 'حدّث الصفحة' : 'Reload'}
          </button>
        </div>
      </section>
    );
  }
}
