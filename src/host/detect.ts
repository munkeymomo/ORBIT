/**
 * Finding a host at start-up (PROTOCOL.md, "Finding a host"). ORBIT looks for `window.orbitHost`, then, inside
 * a same-origin frame, `window.parent.orbitHost`, and asks it for a handshake. Nothing here throws: a host that
 * speaks another protocol, or does not answer, is refused with a reason ORBIT shows on screen, and ORBIT then
 * runs on its own, in memory.
 *
 * `?orbit-host=demo` in the address installs the built-in demo host first (for demos, tests and e2e): an
 * editable one whose records and store last for the browser tab (sessionStorage, the demo host's own; ORBIT
 * itself still touches no browser storage). `?orbit-host=demo-readonly` installs the read-only one. With the
 * editable demo, `&refuse=<reason>` refuses the first change and `&locked=<text>` starts it locked; it keeps
 * ORBIT's own records as well (`&personal=0` turns that off), and `&adopt=all|some|cancel|fail` decides what its
 * "take these tasks" dialog does; `&at=planet:<id>` (or `system:`, `galaxy:`) sets where ORBIT goes first.
 */
import { HOST_PROTOCOL, type Handshake, type OrbitHost, type StartAt } from './types';

export type Detection =
  | { kind: 'none' }
  | { kind: 'host'; host: OrbitHost; info: Handshake }
  | { kind: 'refused'; reason: string };

type HostWindow = Window & { orbitHost?: OrbitHost };

const params = (win: Window) => {
  try {
    return new URLSearchParams(win.location.search);
  } catch {
    return new URLSearchParams();
  }
};

/** The demo switch in the address, if any. */
export function demoMode(win: Window = window): 'editable' | 'readonly' | null {
  const v = params(win).get('orbit-host');
  return v === 'demo' ? 'editable' : v === 'demo-readonly' ? 'readonly' : null;
}

export function demoRequested(win: Window = window): boolean {
  return demoMode(win) !== null;
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

function startAtParam(v: string | null): StartAt | undefined {
  const m = v?.match(/^(galaxy|system|planet):(.+)$/);
  return m ? { [m[1]]: m[2] } : undefined;
}

const refused = (reason: string): Detection => ({ kind: 'refused', reason });
const describe = (v: unknown) => (typeof v === 'number' || typeof v === 'string' ? String(v) : 'no protocol number');

export async function detectHost(win: Window = window, opts: { timeoutMs?: number } = {}): Promise<Detection> {
  if (demoRequested(win) && !(win as HostWindow).orbitHost) {
    try {
      const { createFakeHost } = await import('./fakeHost');
      const editable = demoMode(win) === 'editable';
      const p = params(win);
      let storage: Storage | null = null;
      try {
        storage = editable ? win.sessionStorage : null;
      } catch {
        /* blocked: the demo forgets on reload */
      }
      const adopt = p.get('adopt');
      (win as HostWindow).orbitHost = createFakeHost({
        editable,
        storage,
        refuse: p.get('refuse') ?? undefined,
        locked: p.get('locked') ?? undefined,
        // the editable demo keeps ORBIT's own records too, unless `&personal=0`
        personal: editable && p.get('personal') !== '0',
        adopt: adopt === 'some' || adopt === 'cancel' || adopt === 'fail' ? adopt : 'all',
        // `&at=galaxy:<id>`, `system:<id>` or `planet:<id>`: where to go first (host.at)
        at: startAtParam(p.get('at')),
        // `&name=<words>`: the host's name (to see how long names fit)
        name: p.get('name')?.trim() || undefined,
      });
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
