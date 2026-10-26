// Renders model output with plain React elements only. The text is parsed into data blocks first (safeText.js), and
// every string reaches the page as a React text child, so React escapes it. There is no markup injection, no image,
// and no link element: urls are shown as text. No CSS here; the host UI styles the ab-safe-* classes.
import React, { useMemo } from 'react';
import { parseSafeText, toPlainText } from './safeText.js';

export { parseSafeText, toPlainText };

// A text run with "\n" becomes text and line breaks.
function Lines({ value }) {
  if (value.indexOf('\n') < 0) return value;
  const out = [];
  value.split('\n').forEach((part, i) => {
    if (i) out.push(<br key={`br${i}`} />);
    if (part) out.push(part);
  });
  return out;
}

function Inlines({ inlines }) {
  return (inlines || []).map((x, i) => {
    switch (x.type) {
      case 'bold':
        return (
          <strong key={i} className="ab-safe-bold">
            <Lines value={x.text} />
          </strong>
        );
      case 'italic':
        return (
          <em key={i} className="ab-safe-italic">
            <Lines value={x.text} />
          </em>
        );
      case 'code':
        return (
          <code key={i} className="ab-safe-inline-code">
            {x.text}
          </code>
        );
      case 'url':
        // Shown, never followed: a span, not a link.
        return (
          <span key={i} className="ab-safe-url">
            {x.text}
          </span>
        );
      default:
        return (
          <React.Fragment key={i}>
            <Lines value={x.text} />
          </React.Fragment>
        );
    }
  });
}

// Ballot box glyphs for task items, written as numbers to keep the file plain ASCII.
const CHECKED = String.fromCharCode(0x2611);
const UNCHECKED = String.fromCharCode(0x2610);

const HEADING_TAG = { 1: 'h3', 2: 'h4', 3: 'h5' };

function Block({ block }) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className={block.truncated ? 'ab-safe-p ab-safe-notice' : 'ab-safe-p'}>
          <Inlines inlines={block.inlines} />
        </p>
      );
    case 'heading': {
      const Tag = HEADING_TAG[block.level] || 'h5';
      return (
        <Tag className={`ab-safe-heading ab-safe-h${HEADING_TAG[block.level] ? block.level : 3}`}>
          <Inlines inlines={block.inlines} />
        </Tag>
      );
    }
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      const start = Math.trunc(Number(block.start));
      const props = block.ordered && Number.isFinite(start) && start !== 1 ? { start } : {};
      return (
        <Tag className={block.ordered ? 'ab-safe-list ab-safe-ol' : 'ab-safe-list ab-safe-ul'} {...props}>
          {block.items.map((item, i) => (
            <li key={i} className={item.checked === null ? 'ab-safe-item' : 'ab-safe-item ab-safe-task'}>
              {item.checked === null ? null : (
                <span className="ab-safe-check" role="img" aria-label={item.checked ? 'Done' : 'Not done'}>
                  {item.checked ? CHECKED : UNCHECKED}
                </span>
              )}
              <Inlines inlines={item.inlines} />
              <Blocks blocks={item.children} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote className="ab-safe-quote">
          <Blocks blocks={block.blocks} />
        </blockquote>
      );
    case 'code':
      return (
        <pre className="ab-safe-code" data-lang={block.lang || undefined}>
          <code>{block.text}</code>
        </pre>
      );
    case 'rule':
      return <hr className="ab-safe-rule" />;
    default:
      return null;
  }
}

function Blocks({ blocks }) {
  return (blocks || []).map((b, i) => <Block key={i} block={b} />);
}

/** <SafeText text={modelOutput} /> shows model output safely. Optional: className, maxChars, maxDepth. */
export function SafeText({ text, className, maxChars, maxDepth }) {
  const blocks = useMemo(() => parseSafeText(text, { maxChars, maxDepth }), [text, maxChars, maxDepth]);
  return (
    <div className={className ? `ab-safe-text ${className}` : 'ab-safe-text'}>
      <Blocks blocks={blocks} />
    </div>
  );
}

export default SafeText;
