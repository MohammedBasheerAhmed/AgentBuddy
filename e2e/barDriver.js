// Drives the bar that Agent Buddy puts on a ServiceNow page.
//
// The bar lives in a CLOSED shadow root on purpose: the page's own scripts (and so page.evaluate) cannot see into it. The browser's
// devtools protocol can, which is also how a person's devtools shows it, so this reads the bar's elements through it and presses
// them with real mouse clicks (trusted events, like a person's).

const ATTR = (node) => {
  const out = {};
  const list = node.attributes || [];
  for (let i = 0; i < list.length; i += 2) out[list[i]] = list[i + 1];
  return out;
};
const textOfNode = (node) => (node.nodeType === 3 ? node.nodeValue : (node.children || []).map(textOfNode).join(''));

function closedRoots(node, out = []) {
  for (const root of node.shadowRoots || []) if (root.shadowRootType === 'closed') out.push(root);
  for (const child of node.children || []) closedRoots(child, out);
  for (const root of node.shadowRoots || []) closedRoots(root, out);
  return out;
}

function elementsIn(node, out = []) {
  if (node.nodeType === 1) out.push({ tag: node.nodeName.toLowerCase(), attrs: ATTR(node), cls: ATTR(node).class || '', text: textOfNode(node).replace(/\s+/g, ' ').trim(), backendNodeId: node.backendNodeId });
  for (const child of node.children || []) elementsIn(child, out);
  return out;
}

async function barDriver(page) {
  const cdp = await page.createCDPSession();
  await cdp.send('DOM.enable');

  /** Every element of the bar (none when the page has no bar at all). */
  async function elements() {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    return closedRoots(root).flatMap((shadow) => elementsIn(shadow));
  }

  /** The first element with exactly this class (or a class list that includes it). */
  const find = async (cls) => (await elements()).find((e) => e.cls.split(/\s+/).includes(cls)) || null;

  /** On screen: it has a box with a size. (display:none and the hidden attribute give no box.) */
  async function box(el) {
    if (!el) return null;
    try {
      const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: el.backendNodeId });
      const q = model.border; // the whole box, border included, as a person sees it
      const x = [q[0], q[2], q[4], q[6]];
      const y = [q[1], q[3], q[5], q[7]];
      const left = Math.min(...x);
      const top = Math.min(...y);
      const width = Math.max(...x) - left;
      const height = Math.max(...y) - top;
      return width > 0 && height > 0 ? { left, top, width, height, cx: left + width / 2, cy: top + height / 2 } : null;
    } catch {
      return null;
    }
  }

  async function click(el) {
    const b = await box(el);
    if (!b) throw new Error(`The bar element "${el?.cls || el?.text}" is not on screen, so it cannot be pressed.`);
    await page.mouse.click(b.cx, b.cy);
  }

  /** What a person sees right now. */
  async function view() {
    const all = await elements();
    const byClass = (cls) => all.filter((e) => e.cls.split(/\s+/).includes(cls));
    const root = byClass('bar')[0] || null;
    const handle = byClass('handle')[0] || null;
    const card = byClass('card')[0] || null;
    const actions = [];
    for (const el of all.filter((e) => e.tag === 'button' && e.cls.split(/\s+/).includes('act'))) if (await box(el)) actions.push(el.text);
    const notice = byClass('notice')[0] || null;
    return {
      present: Boolean(root),
      visible: Boolean(root) && Boolean(await box(root)),
      handleShown: Boolean(await box(handle)),
      handleBox: await box(handle),
      cardShown: Boolean(await box(card)),
      actions,
      noticeText: notice && (await box(notice)) ? notice.text : '',
      side: root?.attrs['data-side'] || '',
      expanded: handle?.attrs['aria-expanded'] === 'true',
    };
  }

  return { elements, find, box, click, view, close: () => cdp.detach().catch(() => {}) };
}

module.exports = { barDriver };
