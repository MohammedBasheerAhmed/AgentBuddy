import React, { Component } from 'react';

export const BOUNDARY_TEXT = 'Something went wrong in this part of Agent Buddy. Reload the panel.';

/**
 * One small boundary around each section and around the whole panel: a view that throws while it draws no longer blanks everything.
 * The fallback says so in plain words and keeps a way out (Settings). Nothing is logged: the error text can hold ticket content.
 *
 * `resetKey`: when it changes (another record, another section) the view gets another chance.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // Deliberately empty: no console output, no storage, no message to anyone.
  }

  componentDidUpdate(prev) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="ab-note ab-note-danger" role="alert">
        <p className="ab-boundary-text">{BOUNDARY_TEXT}</p>
        <button type="button" className="ab-btn ab-btn-sm" onClick={() => chrome.runtime.openOptionsPage()}>
          Open Settings
        </button>
      </div>
    );
  }
}
