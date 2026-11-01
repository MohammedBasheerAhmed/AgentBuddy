import { useEffect, useState } from 'react';
import { read } from '../../../ask.js';
import { stepsFromPack } from '../../../../checks/checklist.js';

// AI18: "Draft a checklist from the instructions" is offered only when the written instructions give no steps by themselves (the
// no-AI checklist in Insights is the better answer when they do). One read of the task's instructions per record, with the same
// spec the checklist uses; nothing is sent anywhere.
//
// Returns null while it is not known (the action stays hidden), true when no steps were found (or the read failed: the AI may still
// help), false when the instructions have steps.
export function useChecklistNeed({ page, eff, record, wanted }) {
  const key = `${page?.tabId ?? ''}|${record?.table || ''}|${record?.sysId || ''}`;
  const allowSensitive = Boolean(eff?.policy?.allowHrContent);
  const [state, setState] = useState({ key: '', need: null });
  useEffect(() => {
    if (!wanted || !record?.table || !record?.sysId) return undefined;
    let cancelled = false;
    read(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: 'fulfilment-checklist', allowSensitive })
      .then((pack) => !cancelled && setState({ key, need: stepsFromPack(pack).length === 0 }))
      .catch(() => !cancelled && setState({ key, need: true }));
    return () => {
      cancelled = true;
    };
    // The key is the record's identity; a new record reads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, wanted, allowSensitive]);
  return wanted && state.key === key ? state.need : null;
}
