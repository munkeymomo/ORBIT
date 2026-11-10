/**
 * Finding a host at start-up (PROTOCOL.md, "Finding a host"). ORBIT looks for `window.orbitHost`, then, inside
 * a same-origin frame, `window.parent.orbitHost`, and asks it for a handshake. Nothing here throws: a host that
 * speaks another protocol, or does not answer, is refused with a reason ORBIT shows on screen, and ORBIT then
 * runs on its own, in memory.
 *
 * `?orbit-host=demo` in the address installs the built-in demo host first (for demos, tests and e2e).
 */
import { HOST_PROTOCOL, type Handshake, type OrbitHost } from './types';

export type Detection =
  | { kind: 'none' }
  | { kind: 'host'; host: OrbitHost; info: Handshake }
  | { kind: 'refused'; reason: string };

type HostWindow = Window & { orbitHost?: OrbitHost };

/** The demo switch in the address, if any. */
export function demoRequested(win: Window = window): boolean {
  try {
    return new URLSearchParams(win.location.search).get('orbit-host') === 'demo';
  } catch {
    return false;
  }
}

/** `window.orbitHost`, else the parent frame's (guarded: reading a cross-origin parent throws). */
export function findHost(win: Window = window): OrbitHost | null {
  const own = (win as HostWindow).orbitHost;
  if (own) return own;
  try {
    const parent = win.parent as HostWindow | null;
    if (parent && parent !== win && parent.orbitHost) return parent.orbitHost;
  } catch {
    /* a cross-origin parent: no host */
  }
  return null;
}

/** Synchronous guess used before anything touches browser storage: a host is (or will be) attached. */
export function hostExpected(win: Window = window): boolean {
  return demoRequested(win) || !!findHost(win);
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`no answer within ${Math.round(ms / 1000)} s`)), ms))]);
}

const refused = (reason: string): Detection => ({ kind: 'refused', reason });
const describe = (v: unknown) => (typeof v === 'number' || typeof v === 'string' ? String(v) : 'no protocol number');

export async function detectHost(win: Window = window, opts: { timeoutMs?: number } = {}): Promise<Detection> {
  if (demoRequested(win) && !(win as HostWindow).orbitHost) {
    try {
      const { createFakeHost } = await import('./fakeHost');
      (win as HostWindow).orbitHost = createFakeHost();
    } catch (e) {
      return refused(`The demo host could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const host = findHost(win);
  if (!host) return { kind: 'none' };
  const wrong = (n: unknown) => refused(`This build of ORBIT speaks host protocol ${HOST_PROTOCOL}; the host offered ${describe(n)}.`);
  try {
    if (host.protocol !== undefined && host.protocol !== HOST_PROTOCOL) return wrong(host.protocol);
    if (typeof host.handshake !== 'function') return refused('The host offered no handshake.');
    const info = await timeout(Promise.resolve(host.handshake()), opts.timeoutMs ?? 8000);
    if (!info || info.protocol !== HOST_PROTOCOL) return wrong(info?.protocol);
    if (!info.host || typeof info.host.name !== 'string' || !Array.isArray(info.verses) || info.verses.length === 0)
      return refused('The host’s handshake is incomplete (it needs a host name and at least one verse).');
    if (typeof host.verse !== 'function' || !host.store || typeof host.store.load !== 'function')
      return refused('The host is missing part of protocol 1 (verse() or store).');
    return { kind: 'host', host, info };
  } catch (e) {
    return refused(`The host did not complete the handshake: ${e instanceof Error ? e.message : String(e)}`);
  }
}
