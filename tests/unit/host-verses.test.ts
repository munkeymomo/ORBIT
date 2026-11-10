import { describe, expect, it } from 'vitest';
import { createFakeHost } from '../../src/host/fakeHost';
import { createOrbitStore } from '../../src/store/store';
import { MemoryAdapter } from '../../src/data/storage';
import { errorMessage } from '../../src/lib/errors';

/*
 * Stage 5: planets that are records (items), several verses, wormholes, portals and host actions.
 */

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);

/** An error made in another realm (a host living in the parent frame): not an `instanceof Error` here. */
function foreignError(message: string) {
  const e = Object.create(null) as { message: string; name: string };
  e.message = message;
  e.name = 'Error';
  return e;
}

async function editable() {
  const host = createFakeHost({ now: NOW, editable: true });
  const info = await host.handshake();
  const store = createOrbitStore({ now: () => NOW });
  await store.getState().init(new MemoryAdapter(), null, { host: { host, info } });
  const s = () => store.getState();
  await s().hostSettled();
  const settle = async () => {
    await s().hostSettled();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { host, store, s, settle, toasts: () => s().toasts.map((t) => t.text) };
}

describe('errors from another realm keep their words', () => {
  it('errorMessage reads .message whatever realm made the error', () => {
    const e = foreignError('The parent frame said no.');
    expect(e instanceof Error).toBe(false);
    expect(errorMessage(e)).toBe('The parent frame said no.');
    expect(errorMessage('plain words')).toBe('plain words');
    expect(errorMessage({}, 'fallback')).toBe('fallback');
    expect(errorMessage(new Error('  spaced  '))).toBe('spaced');
    expect(errorMessage(null, 'nothing')).toBe('nothing');
  });

  it('a refusal from a host in the parent frame is shown in its words', async () => {
    const h = await editable();
    const api = h.host.tasks!;
    api.update = () => Promise.reject(foreignError('Frozen by the other frame.'));
    h.s().updateTask('t-compost', { title: 'Nope' });
    await h.settle();
    expect(h.s().tasks.find((t) => t.id === 't-compost')!.title).toBe('Turn the compost');
    expect(h.toasts()).toContain('Frozen by the other frame.');
  });

  it('a host action rejected from another realm says why', async () => {
    const h = await editable();
    h.host.action = () => Promise.reject(foreignError('No dialog today.'));
    await h.s().hostAction('anything', {});
    expect(h.toasts().some((t) => t.includes('No dialog today.'))).toBe(true);
  });
});
