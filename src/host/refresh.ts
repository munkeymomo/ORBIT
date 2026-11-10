/**
 * When ORBIT asks the host for a fresh verse (PROTOCOL.md, "Refresh"): when the page gains focus, when it
 * becomes visible, and every 30 seconds while it is visible. Never two at once.
 */
export const REFRESH_EVERY_MS = 30_000;

export function startHostRefresh(
  refresh: () => Promise<unknown> | unknown,
  opts: { win?: Window; doc?: Document; everyMs?: number } = {},
): () => void {
  const win = opts.win ?? window;
  const doc = opts.doc ?? document;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await refresh();
    } catch (e) {
      console.error('[orbit] host refresh failed', e);
    } finally {
      busy = false;
    }
  };
  const onFocus = () => void run();
  const onVisible = () => {
    if (doc.visibilityState === 'visible') void run();
  };
  const timer = win.setInterval(() => {
    if (doc.visibilityState === 'visible') void run();
  }, opts.everyMs ?? REFRESH_EVERY_MS);
  win.addEventListener('focus', onFocus);
  doc.addEventListener('visibilitychange', onVisible);
  return () => {
    win.clearInterval(timer);
    win.removeEventListener('focus', onFocus);
    doc.removeEventListener('visibilitychange', onVisible);
  };
}
