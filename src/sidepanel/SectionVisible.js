import { createContext, useContext } from 'react';

// Whether the section a component lives in is on screen right now. App keeps every section the person has opened mounted (hidden
// when another one shows) so their text and results survive; a hidden section must not keep working in the background. Anything
// that runs on a timer (a dashboard that refreshes itself) or reads on its own should check this and pause while it is false.
//
//   const visible = useSectionVisible();
const SectionVisible = createContext(true);

export const SectionVisibleProvider = SectionVisible.Provider;
export const useSectionVisible = () => useContext(SectionVisible);
