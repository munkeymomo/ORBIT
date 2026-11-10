import { expect, test, type Page } from '@playwright/test';

/*
 * ORBIT embedded in a host application (src/host). The demo host (?orbit-host=demo) is read-only: every
 * capability is false. A second test proves detection of a host defined on the PARENT frame.
 */

/** Counts IndexedDB opens and localStorage use in every frame: a hosted ORBIT must do neither. */
const STORAGE_SPY = () => {
  const w = window as unknown as { __idbOpens: number; __lsUses: number };
  w.__idbOpens = 0;
  w.__lsUses = 0;
  try {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((...a: Parameters<IDBFactory['open']>) => {
      w.__idbOpens++;
      return open(...a);
    }) as IDBFactory['open'];
  } catch {
    /* no IndexedDB here */
  }
  for (const k of ['getItem', 'setItem', 'removeItem'] as const) {
    const orig = Storage.prototype[k] as (...a: unknown[]) => unknown;
    (Storage.prototype as unknown as Record<string, unknown>)[k] = function (this: Storage, ...a: unknown[]) {
      if (this === window.localStorage) w.__lsUses++;
      return orig.apply(this, a);
    };
  }
};

type HostWindow = Window & {
  orbitHost: {
    opened: { kind: string; id: string }[];
    store: { load(): Promise<{ placements: { id: string; x: number; y: number }[]; prefs: { layers: { moons: boolean } } }> };
    change(fn: (v: { planets: { id: string; title: string }[] }) => void): void;
    calls: { verse: number; unchanged: number };
  };
  __idbOpens: number;
  __lsUses: number;
};

async function center(page: Page, name: RegExp) {
  const box = (await page.getByRole('button', { name }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('demo host: read-only sky, linked items, layers, and positions kept across a refresh', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.addInitScript(STORAGE_SPY);
  await page.goto('/?orbit-host=demo#universe');

  // the host's galaxies, without the finished one
  await expect(page.getByRole('button', { name: /^Garden galaxy/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^House move galaxy/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bakery galaxy/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Old flat galaxy/ })).toHaveCount(0);
  await expect(page.getByText('Outdoor · in season')).toBeVisible();

  // no top bar, no creation controls, no capture
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New system or galaxy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Capture/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Today/ })).toHaveCount(0);

  // fly into a system: planets, but no "add a task" slot
  await page.getByRole('button', { name: /^Garden galaxy/ }).click();
  await page.getByRole('button', { name: /^Vegetable beds\./ }).click();
  const planet = page.getByRole('button', { name: /^Build the raised bed/ });
  await expect(planet).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a task to this system' })).toHaveCount(0);

  // select a task: where it is kept, its linked items, and no editing or focus controls
  await planet.click();
  const panel = page.getByRole('complementary', { name: 'Task details' });
  await expect(panel.getByText('Linked items')).toBeVisible();
  await expect(panel.getByText('Mitre saw')).toBeVisible();
  await expect(panel.getByText('+3 more in Demo host')).toBeVisible();
  await expect(panel.getByText('Kept by Demo host')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Start focus/ })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Complete' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'More actions' })).toHaveCount(0);
  await expect(panel.getByLabel('Task title')).toHaveAttribute('readonly', '');
  await panel.getByRole('button', { name: 'Open in Demo host' }).click();
  expect(await page.evaluate(() => (window as unknown as HostWindow).orbitHost.opened)).toContainEqual({ kind: 'task', id: 't-raised-bed' });

  // close up, the selected planet's moons are named; the Moons layer switch hides them (and is remembered)
  const chips = page.getByRole('list', { name: 'What this task uses' });
  await expect(chips).toBeVisible();
  const moons = page.getByRole('group', { name: 'Layers' }).getByRole('button', { name: 'Moons' });
  await expect(moons).toHaveAttribute('aria-pressed', 'true');
  await moons.click();
  await expect(moons).toHaveAttribute('aria-pressed', 'false');
  await expect(chips).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as HostWindow).orbitHost.store.load()).prefs.layers.moons)).toBe(false);
  await moons.click();
  await expect(chips).toBeVisible();

  // drag a galaxy; its new place is a placement in the host's store and survives a refresh with changes
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Whole universe (0)' }).click();
  await page.waitForTimeout(900);
  const before = await center(page, /^Workshop galaxy/);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(before.x - i * 15, before.y + i * 6);
  await page.mouse.up();
  const moved = await center(page, /^Workshop galaxy/);
  expect(Math.hypot(moved.x - before.x, moved.y - before.y)).toBeGreaterThan(60);
  await expect
    .poll(() => page.evaluate(async () => (await (window as unknown as HostWindow).orbitHost.store.load()).placements.map((p) => p.id)))
    .toContain('g|g-workshop');

  // the host changes something; ORBIT refreshes on focus (no reload) and the galaxy stays where it was put
  await page.evaluate(() => {
    const w = window as unknown as HostWindow;
    w.orbitHost.change((v) => {
      v.planets.find((p) => p.id === 't-brackets')!.title = 'Buy shelf brackets and screws';
    });
    window.dispatchEvent(new Event('focus'));
  });
  // a full verse came back (not "unchanged"): the first load and this refresh
  await expect.poll(() => page.evaluate(() => { const c = (window as unknown as HostWindow).orbitHost.calls; return c.verse - c.unchanged; })).toBe(2);
  await page.waitForTimeout(200);
  const after = await center(page, /^Workshop galaxy/);
  expect(Math.abs(after.x - moved.x)).toBeLessThan(2);
  expect(Math.abs(after.y - moved.y)).toBeLessThan(2);
  await page.getByRole('button', { name: /^Workshop galaxy/ }).click();
  await page.getByRole('button', { name: /^Shelves\./ }).click();
  await expect(page.getByRole('button', { name: /^Buy shelf brackets and screws/ })).toBeVisible();

  // hosted: never IndexedDB, never localStorage
  expect(await page.evaluate(() => (window as unknown as HostWindow).__idbOpens)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as HostWindow).__lsUses)).toBe(0);
});

test('a host defined on the parent frame is found from a same-origin iframe', async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await context.addInitScript(STORAGE_SPY);
  const parentUrl = `${baseURL}/host-parent.html`;
  await page.route(parentUrl, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><title>Parent</title><script>
        window.writes = [];
        window.orbitHost = {
          protocol: 1,
          async handshake() {
            return { protocol: 1, host: { name: 'Parent page' }, caps: {}, verses: [{ id: 'v', name: 'All', plain: 'tasks', legend: '', editable: false }] };
          },
          async verse(id, since) {
            if (since === '1') return { verse: 'v', rev: '1', unchanged: true };
            return {
              verse: 'v', rev: '1', families: {},
              galaxies: [{ id: 'g1', name: 'Allotment', chip: 'Plot · rented' }],
              systems: [{ id: 's1', galaxy: 'g1', name: 'Plot seven' }],
              planets: [{ id: 'p1', system: 's1', type: 'task', title: 'Water the beans', status: 'todo', priority: 2 }],
            };
          },
          open(t) { window.opened = t; },
          store: {
            kind: 'memory',
            async load() { return { projects: [], groups: [], tasks: [], checkpoints: [], sessions: [], captures: [], dayItems: [], placements: [], taskWork: [], prefs: {}, focus: null }; },
            async put(t) { window.writes.push(t); },
            async bulkPut(t) { window.writes.push(t); },
            async remove(t) { window.writes.push(t); },
            async setPrefs() { window.writes.push('prefs'); },
            async setFocus() { window.writes.push('focus'); },
            async replaceAll() { window.writes.push('replaceAll'); },
          },
        };
      </script></head><body style="margin:0"><iframe src="/#universe" style="border:0;width:100vw;height:100vh"></iframe></body></html>`,
    }),
  );
  await page.goto(parentUrl);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('button', { name: /^Allotment galaxy/ })).toBeVisible();
  await expect(frame.getByText('Plot · rented')).toBeVisible();
  await expect(frame.getByRole('heading', { level: 1 })).toHaveCount(0);
  const child = page.frames().find((f) => f !== page.mainFrame())!;
  expect(await child.evaluate(() => (window as unknown as HostWindow).__idbOpens)).toBe(0);
  expect(await child.evaluate(() => (window as unknown as HostWindow).__lsUses)).toBe(0);
  // nothing of the host's was written to its store
  expect(await page.evaluate(() => (window as unknown as { writes: string[] }).writes.filter((w) => w !== 'prefs' && w !== 'placements'))).toEqual([]);
});

test('a host speaking another protocol is refused with a reason, and ORBIT runs on its own', async ({ page, baseURL }, info) => {
  test.skip(info.project.name === 'phone', 'covered on desktop');
  await page.addInitScript(STORAGE_SPY);
  await page.addInitScript(() => {
    (window as unknown as { orbitHost: unknown }).orbitHost = { protocol: 2, handshake: async () => ({ protocol: 2 }) };
  });
  await page.goto(`${baseURL}/#universe`);
  await expect(page.getByText('This build of ORBIT speaks host protocol 1; the host offered 2.')).toBeVisible();
  await expect(page.getByPlaceholder('e.g. Thesis, Website, House move')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as HostWindow).__idbOpens)).toBe(0);
});
