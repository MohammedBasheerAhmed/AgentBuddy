// The part of the Duplicates tool that decides whether a late answer still belongs on screen. "Compare their text" reads the text
// of the ticked articles; if the person ticks another one, picks another group or searches again while that read is on its way,
// the answer is for something that is no longer on screen and must be dropped (it would end up in the merge draft).

/** One string for "this group with exactly these articles ticked" (order does not matter). */
export const selectionKey = (clusterId, ids) => `${clusterId}|${[...ids].sort().join(',')}`;

/**
 * @param {{ token: number, key: string }} request what the read was started for
 * @param {{ token: number, picked: { cluster?: { id: string }, selected?: Set<string>|string[], phase?: string }|null }} now the screen now
 * @returns {boolean} true when the answer may be applied
 */
export function compareStillCurrent(request, now) {
  const picked = now.picked;
  if (!picked || !picked.cluster || picked.phase !== 'loading') return false;
  if (request.token !== now.token) return false;
  return selectionKey(picked.cluster.id, picked.selected || []) === request.key;
}

/** The controls that must be off while a read is loading, so the screen cannot change under it. */
export const compareLocked = (picked) => picked?.phase === 'loading';
