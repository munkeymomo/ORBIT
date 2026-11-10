/**
 * Asking a detail panel to show one of its sections (e.g. a system's belt list) when it opens, or at once when it
 * is already open. One request at a time; the panel that matches takes it.
 */
export type PanelSection = 'belt';

let pending: { id: string; section: PanelSection } | null = null;
const EVENT = 'orbit:panel-section';

export function requestPanelSection(id: string, section: PanelSection) {
  pending = { id, section };
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pending }));
}

/** Takes the request for this record, if there is one. */
export function takePanelSection(id: string): PanelSection | null {
  if (pending?.id !== id) return null;
  const s = pending.section;
  pending = null;
  return s;
}

export function onPanelSection(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
