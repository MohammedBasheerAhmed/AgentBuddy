import React, { Component } from 'react';
import { t, tm, t as tr } from '../i18n/index.js';

export const BOUNDARY_TEXT = tm('Something went wrong in this part of Agent Buddy. Try again, or reload the panel.');

/**
 * One small boundary around each section, each record tab and the whole panel: a view that throws while it draws no longer blanks
 * everything around it. The fallback says so in plain words and offers the next steps: try that part again, reload the panel, or
 * open Settings. Nothing is logged: the error text can hold ticket content.
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
        <p className="ab-boundary-text">{tr(BOUNDARY_TEXT)}</p>
        <div className="ab-row">
          <button type="button" className="ab-btn ab-btn-sm" onClick={() => this.setState({ failed: false })}>
            {t('Try again')}
          </button>
          <button type="button" className="ab-btn ab-btn-sm" onClick={() => window.location.reload()}>
            {t('Reload the panel')}
          </button>
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => chrome.runtime.openOptionsPage()}>
            {t('Open Settings')}
          </button>
        </div>
      </div>
    );
  }
}
