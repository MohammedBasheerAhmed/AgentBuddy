// The Luhn check digit, which payment card numbers and the Emirates ID end with. Shared by the English detectors (detectors.js)
// and the Arabic ones (arabic.js); a module of its own because detectors.js imports arabic.js. Pure.

/** True when `digits` (ASCII digits only, at least one) passes the Luhn check. */
export function luhnOk(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}
