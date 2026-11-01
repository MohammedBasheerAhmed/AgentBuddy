import { Fragment } from 'react';
import { t } from './index.js';

/**
 * A text with elements inside it: tx('Write {mark} where a value should go', { mark: <span className="ab-mono">{'{{name}}'}</span> }).
 * The text is translated like any other (the English text is the key, in Arabic the sentence may put {mark} anywhere), then each
 * {name} is replaced by the value given for it: a string, a number or a React element. A {name} with no value stays as written.
 */
export function tx(text, values = {}) {
  const parts = t(text).split(/\{([A-Za-z][A-Za-z0-9_]*)\}/);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part ? <Fragment key={i}>{part}</Fragment> : null;
        const has = Object.prototype.hasOwnProperty.call(values, part) && values[part] !== undefined && values[part] !== null;
        return <Fragment key={i}>{has ? values[part] : `{${part}}`}</Fragment>;
      })}
    </>
  );
}
