/**
 * The words of an error, whatever made it. A host living in another frame (the parent window) rejects with an
 * Error of that frame's realm, for which `e instanceof Error` is false: so the `message` property is read
 * whenever it is a string, and a thrown string is used as it is.
 */
export function errorMessage(e: unknown, fallback = ''): string {
  let m = '';
  if (typeof e === 'string') m = e;
  else if (e && (typeof e === 'object' || typeof e === 'function')) {
    try {
      const v = (e as { message?: unknown }).message;
      if (typeof v === 'string') m = v;
    } catch {
      /* a hostile getter: no words */
    }
    if (!m) {
      try {
        const s = String(e);
        if (s && s !== '[object Object]') m = s;
      } catch {
        /* no words */
      }
    }
  } else if (e !== undefined && e !== null) m = String(e);
  return m.trim() || fallback;
}
