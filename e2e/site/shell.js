// The Next Experience shell around a classic form (/now/nav/ui/classic/params/target/<form>): the form is a normal classic page, inside an
// <iframe name="gsft_main"> that sits INSIDE the open shadow root of a component, so document.getElementById('gsft_main') finds nothing
// and only the named access of the window (window.frames['gsft_main']) reaches it (audit of 2026-11-07, S17/S18: the only evidence so far
// is one observation on a real instance, src/content/sessionToken.js).
class NowClassicFrame extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    const frame = document.createElement('iframe');
    frame.setAttribute('name', 'gsft_main');
    frame.setAttribute('id', 'gsft_main');
    frame.setAttribute('style', 'width:100%;height:560px;border:0');
    frame.setAttribute('src', this.getAttribute('src') || 'about:blank');
    root.append(frame);
  }
}
customElements.define('now-classic-frame', NowClassicFrame);
