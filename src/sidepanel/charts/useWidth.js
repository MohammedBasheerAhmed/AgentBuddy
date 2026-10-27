import { useEffect, useState } from 'react';

/**
 * [ref, width]: the pixel width of the element `ref` is attached to, kept up to date. Charts that draw text inside an SVG use
 * it to build their layout for the real width, so the text is never scaled (a 320px panel gets 11px text, not 9px).
 * `ref` is a callback ref, so it also works when the element appears later (data arrives, or the table view is switched off).
 * Before the first measurement, and where ResizeObserver does not exist (tests, server rendering), the width is `initial`.
 */
export function useWidth(initial = 300) {
  const [node, setNode] = useState(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    if (!node) return undefined;
    const read = () => {
      const w = Math.round(node.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}
