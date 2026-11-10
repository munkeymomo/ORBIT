/**
 * Small UI memories kept in localStorage (theme before first paint, the last Universe view, a Day Board
 * toggle). When ORBIT runs inside a host application it keeps nothing in the browser of its own accord, so
 * these become no-ops and the values live in memory for the session.
 */
let allowed = true;
const memory = new Map<string, string>();

export function setLocalStorageAllowed(v: boolean) {
  allowed = v;
}

export function localGet(key: string): string | null {
  if (!allowed) return memory.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function localSet(key: string, value: string) {
  memory.set(key, value);
  if (!allowed) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage may be blocked */
  }
}
