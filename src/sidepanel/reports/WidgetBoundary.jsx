import React, { Component } from 'react';
import { t, tm } from '../../i18n/index.js';
import { shown } from '../../reports/shown.js';

export const WIDGET_BROKEN_TEXT = tm('This section could not be drawn. The rest of the dashboard is not affected.');

/**
 * One boundary around each dashboard widget: a widget that throws while it draws (an answer of a shape it did not expect) shows one
 * calm line with "Try again" instead of taking the whole Team tab down with it. Nothing is logged: the error text can hold ticket
 * content. `resetKey` changing (a refresh, another scope) gives the widget another chance by itself.
 */
export default class WidgetBoundary extends Component {
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
    const title = this.props.title || t('Section');
    return (
      <section className="ab-card ab-widget" aria-label={title}>
        <div className="ab-widget-head">
          <h2 className="ab-h">{title}</h2>
        </div>
        <p className="ab-note ab-note-warn" role="alert">{shown(WIDGET_BROKEN_TEXT)}</p>
        <div className="ab-row">
          <button type="button" className="ab-btn ab-btn-sm" onClick={() => this.setState({ failed: false })}>{t('Try again')}</button>
        </div>
      </section>
    );
  }
}
