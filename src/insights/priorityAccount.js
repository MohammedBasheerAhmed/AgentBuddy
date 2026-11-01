// N28: the "priority account" mark on customer service cases. ServiceNow has no standard column for it, so the organisation names its
// priority accounts in its policy (`priorityAccounts`: account names as ServiceNow shows them). The case's account name, which the
// `glance` read already brings for the Account card and the Glance, is compared with that list: no read and no column of its own. Pure.

import { t } from '../i18n/index.js';

/** The form two account names are compared in: one Unicode form, spaces trimmed and collapsed, lower case. '' for anything else. */
export function accountKey(name) {
  if (typeof name !== 'string') return '';
  return name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Is `account` (the case's account, as its display name) one of the organisation's priority accounts?
 * @param {string} account
 * @param {string[]} priorityAccounts the policy's list (eff.policy.priorityAccounts); anything that is not a list names none
 */
export function isPriorityAccount(account, priorityAccounts) {
  const key = accountKey(account);
  if (!key || !Array.isArray(priorityAccounts)) return false;
  return priorityAccounts.some((name) => accountKey(name) === key);
}

/** The words of the mark and its tooltip, the same on the Account card and the Glance (read when shown, so they follow the language). */
export const PRIORITY_ACCOUNT_MARK = Object.freeze({
  get text() {
    return t('Priority account');
  },
  get title() {
    return t('Your organisation lists this account as a priority account.');
  },
});
