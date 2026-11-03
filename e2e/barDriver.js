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

  /** Move the pointer over an element, as a person's mouse does (no click). */
  async function hover(el) {
    const b = await box(el);
    if (!b) throw new Error(`The bar element "${el?.cls || el?.text}" is not on screen, so it cannot be hovered.`);
    await page.mouse.move(b.cx, b.cy, { steps: 4 });
  }

  /** Put the keyboard focus on an element without a click (a script's focus, which is not a key press: Tab then moves on from it). */
  async function focus(el) {
    await cdp.send('DOM.focus', { backendNodeId: el.backendNodeId });
  }

  /** What a person sees right now. */
  async function view() {
    const all = await elements();
    const byClass = (cls) => all.filter((e) => e.cls.split(/\s+/).includes(cls));
    const root = byClass('bar')[0] || null;
    const handle = byClass('handle')[0] || null;
    const dock = byClass('dock')[0] || null;
    const list = byClass('actions')[0] || null;
    const actions = [];
    for (const el of all.filter((e) => e.tag === 'button' && e.cls.split(/\s+/).includes('act'))) if (await box(el)) actions.push(el.text);
    const notice = byClass('notice')[0] || null;
    const tip = byClass('tip')[0] || null;
    const visible = Boolean(root) && Boolean(await box(root));
    const open = Boolean(await box(list)); // the action icons are on screen (the dock is open); false: only the mark (the small pill)
    return {
      present: Boolean(root),
      visible,
      handleShown: Boolean(await box(handle)),
      handleBox: await box(handle),
      dockBox: await box(dock),
      open,
      folded: visible && !open,
      actions,
      noticeText: notice && (await box(notice)) ? notice.text : '',
      tipShown: Boolean(tip && (await box(tip))),
      tipText: tip && (await box(tip)) ? tip.text : '',
      tipBox: tip ? await box(tip) : null,
      expanded: handle?.attrs['aria-expanded'] === 'true',
    };
  }

  /** Run a function with an element of the bar as `this` (in the page; the bar's closed root is reachable only this way) and return its result. */
  async function callOn(el, fn) {
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: el.backendNodeId });
    const { result, exceptionDetails } = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: String(fn), returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text || 'callOn failed');
    return result.value;
  }

  return { elements, find, box, click, hover, focus, callOn, view, close: () => cdp.detach().catch(() => {}) };
}

module.exports = { barDriver };
